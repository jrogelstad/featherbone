# Changelog

Notable changes to Featherbone. Dates are the day the work landed on
`master`.

## Unreleased

* **About, and a REST API reference.** An Info button beside the bell
  on every screen opens an About dialog: what Featherbone is, the
  framework version, each module the instance deployed (sub-modules
  under their package, collapsed until opened) and the software
  underneath (Node.js, PostgreSQL, Express, node-postgres, Mithril, the
  operating system).
  Its REST API button opens `/<db>/api`, where Redoc renders the
  instance's own OpenAPI document from `GET /<db>/openapi.json`. That
  document is assembled on request from core's `openapi.json` (which
  replaces the stale `server/api-base.json`), a path set and schema for
  every feather in the instance's catalog, and the `openapi.json` each
  deployed module carries beside its manifest, its paths prefixed the
  way module routes are. Each source is its own tag group. A unit test
  fails when a route the server mounts is missing from core's document,
  or the document names one it doesn't mount. This replaces the old
  plumbing: the installer no longer tries to write `api.json` into a
  sibling `featherbone-docs` checkout, and the server no longer offers a
  root `/api.json`.
  Adds `redoc` (3.0.1) as a dependency: run `npm install`.
* **`npm run build:client` builds the production client.** It bundles and
  minifies every module script `index_debug.html` names into
  `client/clientmin.js` and writes `index.html` to match, so the two pages
  can no longer drift. The bundle had not been rebuilt since 2.2.0 and was
  missing nine components (the ribbon, the toolbar, the dashboard, the Users
  and Instances screens, the connection banner and four more), so none of
  them appeared without `"debug": true`; `index.html` also lacked the print stylesheet. A unit
  test fails when `index.html` is not what the debug page produces, or a
  client file is left out of the bundle. Rebuild after changing anything
  under `client/` (`npm run build:client -- --check` says whether it is
  due). Adds `esbuild` as a dev dependency.
* **The dashboard can be drilled into.** Clicking a row on a measure
  tile opens the records that add up to it, in a modal list with a
  worksheet's manners: search (with a clear), sort, filter, export,
  print, and a totals footer that adds up to the figure that was
  clicked. The list is a copy of a worksheet's configuration, never a
  reference to one, so reconfiguring or deleting a worksheet cannot
  break drilling in. It is a view onto figures rather than a place to
  work: no edit mode, no import, and none of the inspiring worksheet's
  own actions. Double-clicking a row opens that record as its own page,
  with the back button; coming back to the board brings the list back
  with it. A source offers all this by answering `drillFor(tile, row)`;
  one that says nothing leaves its rows as they were. SupplyChain's
  revenue tiles answer it first, listing the invoice lines behind a
  figure by customer, product, product category, product group or site.
* **Tiles move and resize in steps half the size.** The board is 24
  columns by 16 rows rather than 12 by 8, so a tile that was a little
  too big or a little too small for its contents can be made to fit.
  Nothing on screen changes size: saved layouts, the working draft,
  the tiles a package ships and the defaults a module registers are all
  in the old units and are scaled on the way in, and a layout saved from
  now on records the board it was saved on.
* **Inventory joins the dashboard.** Value and quantity on hand, grouped
  by product, product category, product group or product source, and an
  Inventory Value metric with the balance a year earlier beside it and
  twelve month-end balances as its history. Inventory is a balance
  rather than a flow, so its tiles have no period to choose: they say
  what is on hand at the reporting date (SupplyChain).
* **A package can carry its own icon**, a sibling `icon.png`, `.jpg`,
  `.jpeg` or `.svg` beside its manifest, which replaces the Featherbone
  quill in the ribbon and in the browser tab. It travels with every
  export, the way a package's title does, because it says which
  application this is rather than being part of any one screen.
* **A package's wallpaper now blends across the whole dashboard**, title
  bar and As-Of line included, rather than stopping at the tile grid,
  and fills the page whatever shape the image is. The banner carrying
  the dashboard's name keeps a readable surface that fades out to the
  right, so the title is legible over a busy picture.
* **Exporting a module carries the dashboard layouts people built.**
  Save Layout records no module, so every layout built on the Home tab
  had a blank one and belonged to no export: a package shipped the
  wallpaper and none of the boards.
* **Lists keep their totals on screen.** The interface is drawn at a
  zoom, and a list measured the room it had in real pixels but then
  claimed it in zoomed ones, so every list was about 13% too tall for
  its window and the totals footer sat below the bottom of the screen.
* **The due-date histogram starts where the data does.** Its lookback is
  a fixed number of periods, so a report whose data began part way
  through the window opened on a run of empty columns.

* **The Users screen says what an administrator's badge reaches.** A
  platform administrator wore "platform" and "admin" at once, which said
  the same thing twice now that the tiers are a hierarchy. There is now
  one badge for the highest authority the person holds, and hovering it
  says what that authority covers -- every organization, or the named
  organization and every instance it owns. Needs `"debug": true` until
  `clientmin.js` is rebuilt.
* **A platform administrator administers every instance.** Being a super
  user inside an instance was raised from the owning organization's own
  appointments, and a platform administrator is appointed over no
  organization, so one could create, clone and drop an instance and still
  not read a row in it. Sign-in and profile creation now recognise the
  platform tier as well. A suspended platform administrator inherits
  nothing, and anyone already marked a super user keeps it. ADR-001
  revision 5.
* **An organization administrator's profile is corrected at sign-in.**
  Being made a super user of the organization's instances happened only
  when someone was appointed or granted, so an administrator whose
  profile predates that (or who was appointed before it) still saw few
  workbooks. Signing in now raises the profile when the manager says the
  person administers the organization. It never lowers anything, and
  asks the manager at most once a minute for anyone who is not one.

* **A sign-in link that no longer works lands on the sign-in screen.**
  An emailed link (new account, invitation, password reset) that is two
  days old, or that the server can no longer honour after a restart, used
  to end on the server's own error page. It now goes to the instance's
  sign-in screen with the user name already filled in and a line saying
  the link has expired; a password or Forgot password is all that is
  left. The reason is in the server log. A two-factor confirmation code
  is unchanged. The client part needs `"debug": true` until
  `clientmin.js` is rebuilt.
* **Sign-in links no longer carry secrets.** The link mailed for a new
  account, a password reset, an invitation or a second factor is signed
  but readable by whoever holds it, and it used to carry the whole
  request behind it: a new account's password, the password just typed
  at sign-in, and the instance's Postgres credentials. It now says only
  who it is for and which database, and the instance is looked up again
  when it is used. A second-factor code travels as a keyed hash, so the
  code can no longer be read out of the link it guards. Anyone who was
  mailed one of the earlier links should treat the password it carried,
  and the database password, as exposed.
* **Install tells you how it went.** The Modules page's Install answers
  what it installed and where, and a deployment that fails says which
  package, which database, why, and that the instance is still held in
  maintenance. The page shows both as a dialog (the bundled
  `clientmin.js` is not rebuilt, so that needs `"debug": true` until it is).
* **An organization administrator is a super user in the organization's
  instances.** The platform is administered from its own console, but
  an instance is administered by the people its organization appointed,
  and who may open a workbook is set on the workbook, so they have to
  see them all. Appointing somebody raises the flag on their profile in
  every instance they reach, a profile made for them (on a grant or a
  first sign-in) has it, and standing them down lowers it. Whoever was
  made a super user some other way loses it when stood down, because the
  flag cannot say which reason put it there. Appoint again, or grant the
  instance again, to repair a profile made before this.
* **The ribbon shows a category only when you have a workbook in it.**
  Somebody who may open one workbook of a dozen categories sees one tab,
  not eleven empty ones.
* **A package's mail no longer fails for people who may not change
  Settings.** The organization's mail account is now read as the
  installation's service account, not as whoever's action sent the
  mail. Read as an ordinary user (the reporter of a ticket), the
  encrypted password comes back blank and the send failed with
  `Missing credentials for "PLAIN"`. A refused sign-in with no user
  name or password now says what to enter and where.
* **A package's mail uses the organization's account.** `sendMail`
  called from inside an instance with no server named now sends through
  the account entered under Settings, falling back to `config.json`
  only when the organization has none. Before, Tracker's notice of a
  new issue went through `config.json` alone and, on a server without
  SMTP set there, failed on "connect ECONNREFUSED 127.0.0.1:465" and
  took the save with it.
* **A package's triggers and routes work as soon as it is deployed.** A
  deployment ended without telling the database its registered code had
  changed, so a package installed on a running server did nothing until
  the server restarted (Tracker's mail on a new issue, for one).
* **A person you add is in the instance's lists straight away.** Adding
  a user, or granting an existing one an instance, now makes their
  profile (`user_account`) there at once. Before, it appeared at their
  first sign-in, so until then they were missing from the "user account"
  field on a record and every other list of people. Granting again
  repairs an account that was granted before this.
* **Routes come from the package on disk.** A module's `routes.json` is
  read per database, from the version that database deployed, instead of
  one process-wide mount per path. A package without one keeps using the
  database's `_route` rows. ADR-002 section 11.

## 3.0.0-alpha.1 — 2026-10-18

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
  an upgrade. Two switches, `selfUpgradeManager` and
  `selfUpgradeInstances`, run `install.js --manager` and
  `install.js --instance <name>` themselves before anything reads a
  database, for the manager and for every registered instance whose Core
  version is behind this checkout's. Off by default; a restart of a
  current installation runs nothing. See the README.
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
  on its own **Logo** tab between Address and SMTP Credentials. The
  box is a drop zone in the style of the Import / Export screens: drag
  an image onto it or use the **Choose File** control inside it, and
  the image replaces the prompt so you can see what is in use. Until
  one is set it shows the bundled Featherbone logo, which is also what
  printed forms fall back to; **Clear** returns to that, and a web
  address can still be pasted instead. Uploading is behind the
  existing `fileUpload` flag. A definition change, so run
  `node install.js --instance <name>` after upgrading or the tab shows
  a plain text box.
* **Upgrade, on demand, from the screen.** A restart is not the only
  way to bring Core current: the Instances screen and the platform
  console's fleet view each carry an **Upgrade** button beside
  **Deploy**, applying the checkout's own manifest to one instance (or,
  ticked on the fleet view, several in a row). The instance is held
  while it runs and let go after, audited both ways; a failure leaves
  it held rather than retrying. The fleet view's own **Core** column
  says which version each instance carries and whether it is behind,
  separately from **Carries**, which is the modules'.
* **Upgrade and Deploy show real progress.** Both screens poll a percent
  complete while the install runs, against a process id the caller
  chooses up front, so a long upgrade or deploy — fleet-wide ones
  especially — doesn't sit there looking stalled.
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
was applied before being refused; a failed install exited 0; a
package's own record now wins over a colliding one on natural key; and
the Instances screen's **Upgrade** button, though fully wired up
underneath, was never added to its toolbar or context menu, so it
could not be reached; and uploaded files could not be fetched back at
all -- `/files/upload/<name>` answered 500 ("Deserialize user function
requires a tenant") because the session middleware read `files` as the
name of an instance, which also broke `ResourceLink` attachments. They
now answer 200 to a signed-in session and 401 to anyone else.

### Upgrading from 2.2.0

Moving an installation from before identities needed
`scripts/migrate-identities.js`, which has since been removed because every
installation in use has been moved. To upgrade one that has not, run that
script from the `v3.0.0-alpha.1` tag first (take a backup: there is no way
back), then upgrade this version with `node install.js --manager` and
`node install.js --instance <name>`, or the self upgrade switches.

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
