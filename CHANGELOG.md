# Changelog

Notable changes to Featherbone. Dates are the day the work landed on
`master`.

## 3.0.0-alpha.1 — unreleased

The first alpha of 3.0. Everything an installation is made of changed
shape: who a user is, where a server's code comes from, and what a
deployment does. **An installation cannot be moved to 3.0 by copying
files over 2.2.0** — see *Upgrading* below, and take a backup first,
because the identity migration is one way.

### Identity and tenancy (ADR-001)

* **Manager and instances is the only shape.** Every installation is one
  **manager** database — the registry of instances, the identities and
  the sessions — plus any number of **instance** databases holding
  application data. The manager is never routable; there is no URL for
  it. Each database carries a one row `"$db"` marker recording its kind,
  schema version and mode, and says for itself which banner to show.
* **Sign-in is by identity, and nothing else.** Passwords are verified in
  Node against the manager's `identity` table (scrypt), and
  `access_grant` is the boundary for entering an instance. No user is a
  Postgres login role any more, the service account no longer needs
  `CREATEROLE`, and the `authStrategy` setting is gone. Imported md5 and
  SCRAM verifiers are re-hashed on first sign-in, so existing passwords
  keep working.
* **An identity belongs to an organization.** The same username in two
  organizations is two people with two passwords, proved by test rather
  than asserted. Accounts lock after the fourth failed attempt, and every
  privileged change is written to `admin_audit`.
* **Three administrative tiers:** platform, organization and instance
  (a tenant super user, limited to the instance they signed in to).
* **Sign in without naming a database.** The root URL is an instance
  picker: authenticate against the manager, then choose from the
  instances your grants allow. Access to an instance is proven on entry,
  so a revoked grant shuts the door at the next one rather than at
  session expiry.
* **A platform console at `/platform`,** the one screen that crosses
  organizations: create and rename organizations, appoint their first
  administrator, open and close them, and see every instance on the
  installation with its owner, state and connection.
* **Users and Instances screens** inside each instance, for identities,
  grants, the audit trail, and registering, attaching, opening and
  closing instances.
* **Passkeys and the second factor belong to the identity** and to the
  organization: credentials and single-use challenges live in the
  manager, the signature counter is enforced, and
  `organization.isTwoFactorRequired` decides the envelope per
  organization.
* **Single sign-on through Microsoft Entra ID** (OIDC via
  `openid-client`): a provider per organization, `(issuer, subject) →
  identity` federation, and just-in-time provisioning from group claims.
  Platform administration is never a claim. *The round trip has not yet
  been run against a real directory — see Known gaps.*
* **The instance lifecycle is on screen:** resumable provisioning from a
  template, drop, and copying a quiet instance into a template. Expired
  demos are closed by the server's own hourly sweep and dropped once
  they have been expired longer than `demoGraceDays` (30 by default; 0
  never drops).
* **Multi-node:** `datasource.claimWork(key, seconds)` is the
  once-across-nodes primitive, sessions no longer resave, and tenant
  pools are bounded by `pgTenantPoolSize` and `pgTenantIdleTimeout`.

### Packages on disk (ADR-002)

* **Install and Deploy are two acts.** `install.js --package <dir|tarball>`
  registers a package on the server and touches no database;
  `--deploy <module>[@version] --instance <db>` holds that instance,
  applies the manifest, records the version and lets it go. `--packages`
  lists what the server holds. A failed deployment leaves the instance
  held, deliberately.
* **Module code comes from disk,** server services and the client script
  both, for the version that database deployed, with the old table rows
  as the fallback. A database's own catalog, routes and service registry
  are its own.
* **`ModuleNpm` is retired:** a module declares its libraries in its own
  `package.json` and they are loaded from its own version directory.
* **Maintenance is a state on the registry row.** A held instance answers
  503 with an explanation for everything but its own pages, sign-in and
  the administration routes, and only a platform administrator may sign
  in to it. Both ends audited.
* **A fleet view** on the Instances screen: what each instance carries,
  how many of its modules are behind a package the server holds, and
  Deploy for the row. A group deployment applies one version to a named
  list of instances one after another, so the outage rolls rather than
  landing on everyone at once.
* **An instance says which half it is on** — `N behind`, `N from rows`,
  `N adrift` — and a write to a disk-served module's code is refused
  rather than silently overwritten on the next load.

### The interface

The application looks and navigates differently. This is the most
visible change in 3.0 and the one an existing user meets first.

* **A ribbon replaces the vertical navigator.** Navigation is two levels
  instead of three: a row of category tabs above a ribbon of labelled
  button groups, in the manner of Office. A tab only changes which
  buttons show; it does not navigate. **Home** is a tab of its own
  (Accounts and Workbooks groups); the other tabs are categories of
  workbooks, because a demo with seventeen of them has far too many for
  one row. Worksheets become buttons in a contextual group, and the
  worksheet actions — New, Edit, Save, Delete, Undo, and the Sort,
  Filter and Aggregate list tools — move out of the toolbar above the
  grid into groups at the right end of the ribbon. The toolbar above a
  list keeps only its title and the search box.
* **A fresh style throughout,** built on CSS custom properties and
  modelled on the palette and controls of the author's other
  application, so the two are consistent rather than merely tidy. Grids
  are one table in one scroll box with a sticky header and footer, which
  is what makes a long list behave; toolbars, buttons, dialogs and form
  layout were reworked to match.
* **Dark mode,** following the operating system's preference.
* **Icons are IconPark SVGs** served through `f.icon(name, class)` from a
  name map, rather than an icon font. A name the map does not know is a
  missing icon rather than the word itself rendered as text.
* **A connection banner** that says when the server cannot be reached and
  clears itself when it can, from a lightweight `GET /api/ping` probe. It
  replaced three stacking blocking dialogs.
* **Row actions follow one pattern.** Clicking a row selects it; the
  actions are toolbar buttons at the right, enabled according to the
  selection, and the same actions appear on right-click. A button that
  does not apply stays where it is and is disabled, so the toolbar does
  not jump.
* **A disabled button says why on hover,** which plain Pure CSS prevents
  and this does not.

### Operations

* **Self upgrade at startup** (new in this alpha). A hosted installation
  is deployed by restarting the process, and often has nowhere to type
  an upgrade. With `selfUpgrade` on, the server runs the same command
  line acts itself before anything reads a database: build or upgrade
  the manager, bring each instance behind this checkout's version
  current, and — separately asked for, because it is one way — backfill
  identities. Off by default; a restart of a current installation runs
  nothing. See the README.
* **Settings an organization owns travel with it, not with one
  database.** A customer's letterhead and mail account used to drift
  between production, test and demo; a property marked
  `isOrganization` in its definition now lives against the
  organization in the manager instead, read and written through the
  same `/settings/<name>` every caller already used, with the screen
  staying put in the Home tab's Global group. Nothing is migrated: an
  organization with no row yet is answered from the instance's own
  values, which it still keeps a full copy of. The mail password is
  encrypted at rest in the manager the same way it was in the
  instance. **The logo** is a pointer now, not a `ResourceLink`
  relation -- a URL, or the name of a file uploaded to this server --
  with its own **Upload** button beside the box, behind the existing
  `fileUpload` flag.
* **Every setting can come from the environment,** which is how a hosted
  installation is configured.
* **The edition is the platform's to set,** not the instance's. An
  edition decides what an instance offers, never what is possible.
* **Node 20 or newer** is required.

### Fixed

Among others: a tenant administrator could reset a user's password in
another tenant (the defect that started ADR-001); the instance registry
only ever grew, so a dropped instance kept its pool and its `LISTEN`
connection; eleven services each built their own pool for one database,
so "give up this database" could not work; two nodes creating the claim
table at the same instant raced; overlapping registry refreshes could
wait on a lock the same process held; an unauthorized password change
was applied before being refused; a failed install exited 0; and a
package's own record now wins over a colliding one on natural key.

### Upgrading from 2.2.0

```bash
pg_dump <each instance> > <name>-before-cutover.sql   # there is no way back
node install.js --manager
node install.js --instance <name>
node scripts/migrate-identities.js --apply \
    --username postgres --password <pw> \
    --organization "<your organization>" --org-admin <user>
```

Until the migration has run, nobody can sign in: there is no longer any
other way in. It is one way by design and there is no rollback tooling,
so the backup is the safety net. Where there is no command line, set
`selfUpgrade` (and `selfUpgradeIdentities`) and restart instead.

Afterwards the old Postgres login roles are still on the cluster; drop
them once you are satisfied, and revoke `CREATEROLE` from the service
account.

### Known gaps

* The single sign-on round trip has not been proved against a real
  directory. Everything that decides who a subject is, is tested;
  discovery, PKCE, the state and nonce round trip and the id-token
  checks are `openid-client`'s and have not been run here against Entra
  ID.
* API tokens are not modelled, and a highly-available topology for the
  manager is an open operations question. Both are out of scope for this
  alpha.
* Adding a feather property in the *middle* of its property list gives
  the new column the displaced property's type. Append new properties at
  the end.

## 2.2.0 and earlier

Not recorded here.
