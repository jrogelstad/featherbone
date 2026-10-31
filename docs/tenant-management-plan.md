# Tenant Management and Identity — Rework Plan

Started 2026-10-07. The design this implements is `adr-001-identity-and-tenancy.md`.
When this plan is done, work returns to `featherbone-improvement-plan.md`,
whose Tier 1 is gated by it. Section 7 lists what that plan loses to this one.

> **Settled and built, 2026-10-11.** The direction change proposed on
> 2026-10-10 — multi-instance as the *only* supported shape, an instance
> manager database plus one or more application instances — is the shape the
> code now has (`feat/one-mode`, section 9). It retired part of A.1, replaced
> A.5's backfill and made D.4 mandatory, all of which is reflected below.

Sizes are rough relative weights, not estimates: **S** a sitting, **M** a few
days, **L** a week or more of focused work.

## Where this stands — 2026-10-16

Every item carries its own state: `[x]` done with a *Done …* note naming the
branch and date, `[~]` part done, `[ ]` not started. The tally:

| Tier | Done | Part done | Open |
| --- | --- | --- | --- |
| A Foundations | A.1–A.5 | — | — |
| B Identity cutover | B.1-B.8 | — | — |
| C Credentials and SSO | C.1–C.4 | — | — |
| D Tenant lifecycle | D.1–D.5 | — | — |
| E Multi-node readiness | E.2, E.3, E.4 | E.1, E.5 | — |
| F Verification | F.1–F.4 | — | — |
| G Platform administration | G.1–G.5 | — | — |

**2026-10-16, the second half of the day: John answered every open
question in this plan and in ADR-002, and the answers are built.** The
decisions are recorded where they belong -- D.5 under its own item,
E.3 under its own, C.3/C.4 under theirs, the demo question under D.4 --
and the branches are in `featherbone-fix-branches.md`. In short:

| Question | John's answer | Where it went |
| --- | --- | --- |
| Platform administration (new, G) | "make the global platform administration an option for a global admin" | `feat/g1-instance-picker`, `feat/g2-platform-console` |
| E.3, where `$session` lives | the picker settles it: one sign-in against the manager | sessions stay in the manager; (b) and (c) are closed |
| D.5, are edition limits a boundary | "helps it determine what workbooks to show... I would like the edition setting to only be set or changed by the platform administrator" | `feat/d5-edition-platform-only` |
| C.3/C.4, SSO and against what | "Azure AD is the most common. Let's start with that" | `feat/c3-azure-ad-sso` |
| ADR-002, the combined zip install | "I'm going to abandon the admin_console package" | nothing to build; recorded in ADR-002 §10 |
| ADR-002, fleet upgrade as one action | "one by one or in a group... likely patches I would want to deploy to a fleet" | `feat/fleet-group-deploy` |
| ADR-002, customer extension | "mainly just an implementation methodology and note" | recorded in ADR-002 §10, nothing to build |
| D.4, dropping an expired demo | "after more time has passed... if nobody says anything after, say, a month, we'll just completely drop it" | `feat/demo-drop-after-grace` |

**What that means in practice.** Sign-in is by identity and nothing else
(**B.8**): passwords verified in Node, `access_grant` as the entry boundary,
no Postgres login roles anywhere, no `authStrategy` to set, and user
administration and the registry both on screen (Users and Instances).
`install.js --instance` starts a fresh installation on identities in one
step — it creates the organization, the first identity, its grant and its
administrator flags — and `migrate-identities.js` brings an older
installation across, one way, rehearsed against a copy of `demo` (**B.6**).
Isolation between organizations is demonstrated rather than asserted, with a
mutation check (**F.1**, the "done when" of improvement-plan item 1.1).
**Tier B is complete and closed.**

The lifecycle is on screen too (**D.1–D.4**, 2026-10-16): a platform
administrator builds an instance from a template as a resumable state
machine, drops one, copies an instance into a template, and the expired-demo
sweep runs on the server's own clock. Passkeys and the second factor belong
to the identity and the organization (**C.1, C.2**), multi-node has its
claims primitive, bounded pools and `resave: false` (**E**), and the
isolation, mirror and two-node claims are run rather than asserted
(**F.1–F.3**), with F.4's rehearsal recorded under B.6.

**What is left is not code to write here; it is John's to run or other
repositories' to change:**

1. **Run the migration on each real installation** (improvement-plan 1.1's
   remainder). Since B.8 an unmigrated installation has nobody who can sign
   in. Then `node install.js --instance <name>` on every instance so the
   installed scripts match the server, and `node install.js --manager`
   once, which is also what builds the C.3 federation tables.
2. **Prove the single sign-on round trip against a real directory.**
   Everything that decides *who a subject is* is tested
   (`test/api/federation.test.js`); discovery, PKCE, the state and nonce
   round trip, the id-token signature, issuer and audience checks and the
   userinfo fallback are `openid-client`'s and have never been run here
   against Entra ID. One organization pointed at a real directory is the
   done-when C.3 already asks for. **Punted for 3.0.0-alpha.1 (John,
   2026-10-18):** "I have to punt on SSO. Have no way to prove that now."
   Carried as a known gap in the 3.0.0-alpha.1 release notes instead.
3. **Highly-available topology for the manager** and **API/identity
   tokens** are both still unmodelled (ADR §9). **Punted for 3.0.0-alpha.1
   (John, 2026-10-18):** "HA and identity tokens are out of scope for now.
   Mark those as punt for now." Carried as a known gap in the release
   notes.
4. **The modules.** Both live in their own repositories, and neither was
   reachable from the session that did the rest of this work:
    - The **CronJob** module's `initialize-cron-job.js` should claim the
      job before firing it (E.1's last line), so one node runs each job
      and not every node:

      ```js
      // Before firing, where `name` is the job and `interval` its
      // period in seconds
      if (!await f.datasource.claimWork(name, interval)) {
          return;   // another node has this one
      }
      ```

      `claimWork` is in the framework and tested (`test/api/multinode.js`,
      F.3); nothing else is needed on this side.
    - **SupplyChain**'s module-level `pending` guards should become
      database locks (E.5's second half).
5. **Whether SupplyChain's five print services are ported** off `pdfjs`
   and `table-layout`, which master left behind for `pdfmake`.

**Added and built 2026-10-16 (John's find):** platform administration
had no front door. The four items are Tier G below; all four are done.

**ADR-002's own remainder, answered the same day.** The
packages-on-disk work was already implemented (that ADR's section 10 is
its tally): Install and Deploy are separate acts, the maintenance state
exists, the fleet view says which instance is behind, both halves of
"source code in a table" come from packages, `ModuleNpm` is retired and
module-less service rows are reported. What was left there was John's,
and he answered it:

* **The Admin Console's combined zip install** -- "I'm going to abandon
  the admin_console package." Nothing to build: Install then Deploy on
  the command line and the screen is the path, and the combined one
  goes with the package.
* **A fleet upgrade as one action** -- "I'd like the option to upgrade
  the fleet one by one or in a group. For example, if I want to test in
  a test database before going to production, I would need to do that
  individually. But likely patches I would want to deploy to a fleet,
  especially if urgent." Built on `feat/fleet-group-deploy`: a group is
  a sequence of single deployments, each instance held and let go in
  turn, named rather than implied.
* **Customer extension by package and spare user columns** -- "either
  way I don't think that fundamentally changes anything we've done or
  are going to do here. It's mainly just an implementation methodology
  and note." Recorded as such; improvement item 0.14 still gates the
  user-column half.

## How to use this plan

Tiers A–F are ordered by dependency, not by value. Within a tier, items are
mostly independent.

| Tier | Theme | Items | Gate |
| --- | --- | --- | --- |
| A | Foundations | 5 | None — start here |
| B | Identity cutover | 8 | Needs A |
| C | Credentials and SSO | 4 | Needs B |
| D | Tenant lifecycle into the framework | 5 | Needs A; independent of B |
| E | Multi-node readiness | 5 | A.2 first; rest independent |
| F | Verification | 4 | Proves A–E |
| G | Platform administration | 4 | Needs B and D |

**Two things do not wait for any of this.** Improvement-plan Tier 2
(SupplyChain money and inventory: tax rounding, mid-transaction `COMMIT`s,
double-posting races) and Tier 3 (indexes) touch neither identity nor the
control plane. They are live money and scaling defects and should proceed in
parallel. A.2 below is also worth doing immediately — it is a latent
single-node bug today.

## Tier A: Foundations

No user-visible behaviour change. Everything downstream depends on A.1 and A.3.

- [x] **A.1 Make the tenant management database explicit.** (M)
    - *Done 2026-10-09 on `feat/a1-control-plane`, two commits.*
    - *A `controlPlane` configuration block names its connection; anything it
      leaves out falls back to the ordinary `pg*` settings, and with no block
      at all the control plane is `pgDatabase`, as before. Each setting also
      takes an environment variable (`controlPlanePgDatabase` and friends),
      which works whether or not the file carries the block.*
    - *`serverRole` declares what the process serves: `controlPlane`,
      `tenant` or `both`, defaulting to `both`. A tenant server does not
      serve the control plane; a control plane serves only itself.*
    - *A `"$db"` table records each database's kind, framework schema version
      and mode. The bootstrap writes it and a mismatch is refused at install
      time and at boot. A database installed before it existed has no marker
      and is taken at its word, so upgrades are not blocked.*
    - *`Tenant` and `TenantService` moved to
      `scripts/feathers-control-plane.json`, installed only where they
      belong. Manifest entries take a `target`, and a package declares which
      kind of database it installs into, defaulting to `tenant` -- which is
      what keeps application modules off a control plane. Core declares
      `both`. **The Admin Console's manifest will need
      `"target": "controlPlane"`** to install on a dedicated control plane.*
    - *`install.js` takes `--control-plane`, `--tenant`, `--target` and
      `--mode`, and installs into the control plane's own database when asked
      for one. The connection used when no tenant is named is now the control
      plane, which is where `tenant: false` requests were always going.*
    - *`scripts/split-control-plane.js` helps an existing combined install:
      it copies `tenant_service` rows across (their encrypted passwords
      travel as they are, since both databases share the installation's
      `pgCryptoKey`) and lists the tenants to re-enter. It does not copy
      `tenant` rows -- a tenant points at a contact and an edition by primary
      key, so moving one means moving application data, and a tenant will
      also belong to an organization. **A.5 is where tenant rows move, with
      their ownership.** Dry run by default, idempotent, deletes nothing.*
    - *Also moved: `mode` (dev, test, prod) now lives in each database's
      `"$db"` row rather than on each server process, so one server serving a
      test and a production database says the right thing for each. Resolved
      at sign-in and kept on the session. `mode` in configuration seeds the
      install and stands in for a database whose row predates it.*
    - *The README documents the database kinds, the install flags, the
      `controlPlane` block, manifest `target` and the split script.*
    - *Verified against three live servers on one cluster: a dedicated
      control plane, a `--tenant` database with no `tenant` or
      `tenant_service` tables in it, and `demo` as before. A tenant-role
      server answers 404 for the control plane; a control-plane-role server
      serves only itself; signing in to the tenant database writes its
      session row in the control plane and none in the tenant. Pointing
      `controlPlane` at a tenant database refuses to start, installing a
      tenant database as a control plane is refused, and an application
      package is refused on a control plane.*
    - *Not done here: `both` remains supported rather than being removed,
      because dropping it would break every running deployment on the next
      pull. It is transitional; B or F can take it out.*
    - ***Partly superseded by section 9.*** *If one mode is the only mode,
      `serverRole`, `both` and the `controlPlane` block go away, and
      `split-control-plane.js` is replaced by attaching an existing database.
      The `"$db"` marker, the mode move and manifest `target` survive.*
    - Today it is whatever `config.pgDatabase` names, reached by requests
      passing `tenant: false` and acting as `systemUser` (`server.js` ~293).
    - Add a `controlPlane` configuration block distinct from tenant service
      connections. Have the framework boot in a declared role: control plane,
      tenant server, or both.
    - Give it its own bootstrap and schema version, separate from a tenant
      database's, so one can never be mistaken for the other.
    - Done when: a tenant server starts with no control-plane tables of its
      own, and the control plane starts with no tenant application modules.
- [x] **A.2 Per-process node identity, and scope the restart cleanup.** (S)
    - *Done 2026-10-08 on `fix/a2-node-identity`.* Node id is now
      `node_<pid>_<random>` (the `nodeId` config key was dropped); the listener
      holds an advisory lock, and startup cleans only locks/subscriptions of
      nodes whose lock is free. Process cleanup stops only rows whose Postgres
      backend is gone and covers every tenant. Test:
      `test/api/node-identity.test.js`. Mixed-version caveat: an old-version
      node (no advisory lock) looks dead to a new one.
    - `nodeId` is a static config value (`"node1"`). Startup runs
      `datasource.unlock()` and `datasource.unsubscribe()` scoped by it
      (`server.js` ~311–314), so a second node booting wipes the first node's
      live record locks and subscriptions.
    - `cleanupProcesses()` (`server/datasource.js` ~512) has **no `nodeId`
      filter at all**: any restart marks every in-flight `server_process` row
      on every tenant as "Stopped by server restart". It also loops on
      `tenants[0]`, so it only ever touches the first tenant.
    - Replace the constant with an identity registered at startup (host plus
      pid, or a `node` row with a lease). Scope all three cleanups by it. Fix
      the `tenants[0]` loop.
    - Done when: two processes started from one config file do not disturb each
      other's locks, subscriptions or process rows.
- [x] **A.3 Control-plane feathers.** (M)
    - *Done 2026-10-10 on `feat/a3-identity-model`.*
    - *`Organization`, `Identity`, `AccessGrant` and `AdminAudit` added to
      `scripts/feathers-control-plane.json`, and `Tenant` gains an optional
      `organization` relation. Pure addition: nothing reads them yet, so
      behaviour is unchanged. `Contact`, which `Tenant` requires, comes from
      the bootstrap and so is present in a manager database too.*
    - ***The uniqueness that item 1.1 is about is now a database
      constraint.*** *A feather's `isNaturalKey` builds an ordinary index,
      not a unique one, and a feather cannot declare a constraint spanning
      two columns -- so `username` was left off the natural key (making it
      one would have recreated the cluster-wide collision in a new place)
      and `scripts/control-plane-constraints.js` adds the real constraints:
      unique `(organization, lower(username))` on `identity`, unique
      `lower(name)` on `organization`, and one grant per identity and
      instance. All partial on `NOT is_deleted`, since rows here are
      soft-deleted and a deleted identity must not reserve its name for
      ever. It runs from the manifest after the control-plane feathers, on a
      control plane only, and is idempotent.*
    - *Proven: two organizations may each employ an `alice`; one
      organization may not hold `bob` and `BOB`; deleting an identity frees
      its username. `test/api/identity-model.test.js`, 10 tests. Full API
      suite 256 tests, 178 pass, 23 fail -- the identical failure set to
      `john/master` on the same cluster, so no regressions. Unit suite 302
      pass.*
    - ***The `Tenant` to `Instance` rename is deferred to D.4, correcting
      what I said on 2026-10-10.*** *`Tenant` is referenced by the Admin
      Console module, which lives in a separate repository, so renaming the
      feather here would break it. A.3 therefore adds a relation **to**
      `Tenant`, which survives the rename; section 9's open question 2 keeps
      its answer and only the timing changes.*
    - *Goldens updated by hand rather than regenerated: this cluster has
      neither SupplyChain nor Job Shop, so `FB_UPDATE_GOLDEN=1` would strip
      114 feathers out of `catalog-feathers.json`. Only the four new
      feathers, `Tenant.organization` and the twelve new index rows were
      added, taken verbatim from the live catalog. **The catalog golden test
      cannot pass on a cluster missing those modules, so confirm it on a
      full install.***
    - *Not done here: `identity_credential` and `identity_federation`, which
      belong with C.1 and C.3; and service accounts and API tokens, still
      unmodelled (ADR §9).*
    - `organization`, `identity`, `access_grant`, `admin_audit`, and the
      `organization` relation on `tenant`. Schema per ADR §4.
    - Built into the framework, not an installable module. The control plane is
      itself a Featherbone application, so it ships core feathers, forms and
      workbooks for the administration UI.
    - Done when: an organization, an identity and a grant can be created
      through the framework with no module installed.
- [x] **A.4 Administration model.** (M) *Partly done 2026-10-11 on
  `feat/identity-cutover`: `admin_audit` is written by everything that
  changes privileged state -- the backfill's creations and grants, and the
  automatic lock after failed sign-ins. Finished 2026-10-15 on
  `feat/a4-admin-model`: the break-glass reach and the rename. Sign-in is
  organization-scoped, so a platform administrator can never be signed in
  to another organization's instance; the admin routes now let them name
  the organization to act on (`?organization=` on reads, `organization` in
  the body on writes), everything downstream keys on it, audit rows record
  the organization acted on, and anyone else naming another organization
  is refused. The Users screen gets an organization picker only a platform
  administrator sees. Proven end to end in `identity.test.js`
  ("break-glass"): suspend the departed administrator, appoint the
  replacement, read the trail, and the refusals. The User Account form
  labels `isSuper` "Tenant Super User" and the feather description says
  what it is (and stops misspelling "administrator"); README and ADR
  already used the name.*
    - Implement the three tiers in ADR §3: platform administrator,
      organization administrator, tenant roles.
    - A platform administrator is an identity with a flag — not a Postgres
      superuser, not `user_account.is_super`.
    - Write every privileged action taken on a customer's behalf to
      `admin_audit`: appointing an administrator, suspending an identity,
      transferring rights.
    - Rename `user_account.is_super` in docs and UI to **tenant super user**
      so it stops reading as a platform role. No behaviour change.
    - *Found 2026-10-15: nothing appoints the first organization
      administrator. The Users screen lets one promote another, and the
      Instances screen needs one, but `migrate-identities.js` creates every
      identity with both flags false, so the first `is_org_admin` can only be
      set in SQL. Give the backfill an `--org-admin <username>` flag, audited
      like the rest.*
    - Done when: the break-glass path in requirement 3 — suspend a departed
      organization administrator, appoint a replacement — is doable in the UI
      by a platform administrator, and leaves an audit trail.
- [x] **A.5 Ownership backfill.** (S) *Done 2026-10-11:
  `scripts/migrate-identities.js` -- dry run by default, `--apply` to
  write; builds the organization, attaches instances, creates one identity
  per username across instances with the pg_authid verifier when superuser
  credentials are given, and grants per instance; idempotent, audited. The
  interim POST UserAccount fix is superseded: creation goes to B.5.*
    - Backfill one organization per existing customer; attach existing tenants;
      record which organization owns each existing username.
    - With ownership known, make `POST UserAccount` reject an existing role
      that belongs to another organization, and allow it when the organization
      matches. **This is a correct partial fix for item 1.1 that preserves the
      test-and-production case**, and it ships before the full cutover.
    - Done when: a second organization cannot create a user whose name exists
      in the first, and the same organization still can.

## Tier B: Identity cutover

The real work. B.1–B.2 are reversible by configuration; B.3–B.4 are the
one-way door.

**What moving off Postgres roles does and does not cost.** It is tempting to
think the current design gets defense in depth from the database — that even
a SQL injection is contained by Postgres's own permissions. Checked on
2026-10-10, it does not:

* Pools are keyed by database only (`database.js` ~352), and the connection
  user is always the tenant service account, never the end user.
* There is no `SET ROLE` or `SET SESSION AUTHORIZATION` anywhere in the
  codebase.
* Every `GRANT` in the repository is role-to-role membership
  (`GRANT everyone TO <user>`, `role.js` ~279). No table or column privileges
  are granted to user roles, and row-level security is not used — "row
  authorization" in `crud.js` and `tools.js` is Featherbone's own `$auth`
  check, not Postgres RLS.

So `pg_authid` is a *membership store* that `pg_has_role()` queries, not an
enforcement boundary. Every statement already runs with the service account's
full privileges, and an injection on that connection bypasses `$auth` today
exactly as it would with membership in an ordinary table. B.3 is therefore
security-neutral, and B.4 is a net gain: it takes `CREATEROLE` away from the
service account, which is currently an escalation path.

Real database-enforced authorization remains *available* and is not closed off
by this plan — it would mean per-request `SET ROLE`, table grants and RLS,
which is an additive project of its own. Note that it pulls against E.4's
connection pooling and PgBouncer.

**Why Tier B is not about multiple Postgres clusters.** Its drivers are all
single-cluster problems: role names are cluster-wide, so two customers cannot
both have an `alice` (item 1.1); one consultant cannot hold separate
credentials in two organizations (F.2); Postgres cannot verify an Azure AD
token, so SSO is impossible without application-side identity (C.3); and the
two-pool login path exists only because signing in means connecting as the
user's role (item 1.6). Clustering is a side effect of this work, not its
purpose.

- [x] **B.1 Application-side password verification.** (M) *Done
  2026-10-11: `server/services/identities.js`, scrypt (node:crypto, zero
  dependencies). Imports both pg_authid forms -- SCRAM-SHA-256 and md5 --
  and re-hashes to scrypt on the first successful sign-in, so the
  password-equivalent export does not stay at rest.*
    - Hash with `node:crypto` `scrypt` or argon2id (ADR §9 open question).
    - Import existing `SCRAM-SHA-256` verifiers from `pg_authid` and verify
      against them, re-hashing on first successful sign-in. Proven in
      `docs/scram-verify.js`; needs a superuser connection once per cluster.
    - Treat exported verifiers as password-equivalent; drop them per identity
      once re-hashed.
    - Done when: every existing user signs in with their current password, with
      no Postgres role involved, and their stored verifier is gone afterwards.
- [x] **B.2 Rewrite the sign-in path.** (M) *Done 2026-10-11 behind
  `authStrategy` in config.json: "role" (default) keeps today's path
  byte-for-byte; "identity" runs database -> tenant -> organization ->
  identity -> verify in Node -> access_grant -> local profile, opens no
  connection as the user, and matches the role path's lock escalation and
  client messages. The two-pool path is deleted at B.4, when the flag
  goes.*
    - Flow per ADR §4: database → tenant → organization → identity → policy →
      verify → `access_grant` → MFA → session.
    - Delete the two-pool login path in `server/database.js` `authenticate()`.
      **This deletes item 1.6 rather than fixing it.**
    - Fix the error-message leaks from item 0.3 here: stop returning raw
      Postgres errors, and stop naming the database in the unknown-user message.
    - Keep a configuration flag to fall back to the role-connect path until
      B.4, so the cutover is reversible.
    - Done when: sign-in works with the fallback disabled, and a failed sign-in
      strands no connection.
- [x] **B.3 Replace `pg_has_role()` with membership resolution.** (L)
  *Done 2026-10-11, unconditionally (not behind the flag): the GRANTs only
  ever mirrored role_membership rows, so resolving against the
  application's own tables answers identically for existing databases.
  `tools.memberNames()` is the one CTE all six call sites share, and
  "everyone" is implicit for every active user account. Authorization
  suite passes unchanged; test user fbt_norole proves a user with no
  Postgres role at all signs in and reads data.*
    - A recursive CTE over `role` and `role_membership` in the tenant database.
      Seven call sites: `tools.js` ~200 and ~221, `workbooks.js` ~165 and
      ~255, `feathers.js` ~1016, `scripts/services.js` ~1350, and
      `settings.js` `settingIsAuthorized` (added by improvement-plan 0.4,
      which lets a role granted `canUpdate` on a settings row change it).
    - `$auth` rows and semantics do not change.
    - Add a per-tenant `everyone` equivalent: an implicit group every granted
      identity belongs to, replacing the cluster-wide role.
    - Done when: the authorization tests in `test/api/authorization.test.js`
      pass unchanged, with no Postgres role membership in the database.
- [x] **B.4 Stop creating Postgres login roles.** (M) *Done 2026-10-12
  under `authStrategy` "identity": `server/services/role.js` is the one
  seam, so the triggers in `scripts/services.js` are unchanged and no
  module reinstall is needed. `createRole` writes an identity and a
  grant for a user and does nothing at all for a group role;
  `changeRolePassword` writes `identity.password_hash`;
  `changeRoleLogin` flips the instance's `access_grant`;
  `changeRoleCreateDb`, `grantMembership` and `revokeMembership` are
  no-ops, because B.3 reads `role_membership` directly; `dropRole`
  clears `$auth` and deactivates the grant. Proven by pg_roles
  assertions in `test/api/identity.test.js`: creating a user, setting
  its password and making it a member of a group leaves the cluster
  without a single role. `CREATEROLE` on the service account and
  `Role.isLogin` are the remainder -- see the note under B.5.*
    - No `CREATE ROLE`, `ALTER ROLE`, `DROP ROLE`, `GRANT` or `REVOKE` for
      users. Remove `CREATEROLE` from the service account. Deprecate
      `Role.isLogin`.
    - **Deletes the role half of item 1.8** — no more
      `ALTER ROLE … PASSWORD %L`. The `pgp_sym_decrypt` half stays in the
      improvement plan.
    - Done when: a fresh install creates no login roles, and the service
      account has no `CREATEROLE`.
- [x] **B.5 `user_account` becomes the local profile.** (M) *Done
  2026-10-12. `POST /data/user-account` under "identity" creates the
  identity in the instance's organization, grants it that instance and
  leaves the local row as the profile; the account keeps its name as the
  key history points at. A user who already exists in the organization
  is granted access and keeps the password they have, so creating the
  same person in a second instance is not a password reset -- the
  takeover item 1.1 described cannot be reached this way either, because
  identities are organization-scoped. Deactivating or deleting the local
  account deactivates the grant and keeps the identity and the grant
  row, so the record of who could reach what survives. Every one of
  these writes an `admin_audit` row.*
    - Keyed to an identity; holds preferences and contact; remains the target
      of existing relations and of `created_by` / `updated_by`.
    - Granting access provisions the local row; revoking deactivates it without
      destroying history.
    - **Fixes item 0.1** (`POST /data/user-account` always 500,
      `scripts/services.js` ~1357) on the new path.
    - Done when: a grant creates a usable local profile, and
      `POST /data/user-account` succeeds.
    - **What B.4 and B.5 deliberately left.** Two one-way steps wait for
      the flag to become the default, because taking them now would
      break the "role" path they share a build with:
        - `CREATEROLE` stays on the service account, since the role path
          still needs it. Revoking it is an operator's step once
          `authStrategy` is "identity" everywhere, and it is what turns
          B.4 from a code change into the privilege reduction this tier
          promised.
        - `Role.isLogin` still exists on the feather and still decides
          whether `createRole` means a user or a group. Removing a
          property means a migration, so it is deprecated in
          documentation first.
        - A write to the manager is not in the instance's transaction:
          two databases cannot share one. The order is chosen so a
          failure leaves something inert rather than something wrong --
          an identity with no grant cannot sign in anywhere, and a grant
          whose local profile was rolled back is refused at
          `deserializeUser`. A sweep for identities with no grant
          belongs with B.6.
- [x] **B.6 Migration tooling, one way.** (M) *Done 2026-10-15 on
  `feat/b6-migration-tooling`. The item asked for a rollback as well, and
  that was dropped on 2026-10-15 after John put the question: once an
  installation is on identities there is no reason to go back, and keeping a
  way back keeps the role path alive -- which is what B.8 now exists to
  delete. A rollback script was written and then removed; what it was really
  for was establishing the facts below.*
    - *`migrate-identities.js` was already the one command; it now takes
      `--org-admin <username>` and appoints the organization's first
      administrator, audited. Nothing else could: the Users screen lets one
      administrator promote another, which is no use when there is not one
      yet, and the backfill created every identity with no flags.*
    - *`authStrategy` is now in `config.template.json` as `"role"`, which is
      also what the code assumes when it is absent. It was undiscoverable
      before, which is how it came up.*
    - *The README says the migration is one way, that a backup is the safety
      net, and **why setting the flag back is not a rollback**: it works only
      until the first password is changed or the first user is created on the
      identity path, because neither reaches Postgres -- a password set
      through an identity leaves the cluster role holding what it held
      before, and a user created there has no cluster role at all. After
      either, flipping the flag locks those people out with nothing in the
      database to explain it.*
    - *A brand new installation could not start on `"identity"` at the
      time: `install.js` created the first administrator as a Postgres
      role and nothing created the organization. B.8 fixed that the same
      day.*
    - *Rehearsed against a copy of `demo`: registered it, backfilled it,
      switched to identity, created a user that exists only as an identity
      and changed another's password. The api suite run with that copy as its
      source has the same failure set as the baseline, 66 either way in this
      sandbox for want of Job Shop and SupplyChain.*
- [x] **B.7 Provision the local profile when access is granted.** (S)
  *Done 2026-10-15 on `feat/b7-local-profile`. The profile is made on the
  first sign-in, in `deserializeUser`, on the strength of a live grant:
  active identity, same organization as the instance, active grant to it. It
  joins `everyone` and nothing else, is idempotent against a concurrent
  second sign-in, and is audited as `user_account.provisioned`. Identity path
  only -- on the role path a cluster-wide login role plus an on-demand
  profile would be a way into any database, which is item 1.1 again.*
  *The second half was in `server.js`: `doSignIn` looked the local profile up
  and answered 401 before authenticating at all, silently, which is why a
  granted identity could not get in and why nothing appeared in the log. On
  the identity path that question now belongs to authentication; a wrong
  username still gets the same generic refusal, from there. A
  B.5-era test that asserted the old behaviour -- create an identity from the
  screen, be refused until a profile is made by hand -- now asserts the new
  one.*
    *Found 2026-10-15, in use.* `user_account` is the local profile (B.5) and
    `deserializeUser` requires a row in **every** instance the person reaches:
    without one, `server/database.js` rejects with "User account <name> not
    found", which is what a person sees when they switch to an instance they
    were granted but never had an account in. Nothing creates it. B.5 built
    the inside-out direction — creating a user in an instance creates the
    identity — and the outside-in direction was never specified: granting an
    instance from the Users screen, the backfill, or `--instance` registering
    a database whose people already exist elsewhere.
    - Create the profile wherever a grant is created, or create it on first
      sign-in from the identity (name, contact, `is_active`), and decide which
      roles it joins — `everyone` at least, nothing else by default.
    - Until then the manual step is a `user_account` row plus an `everyone`
      membership in that database, or creating the user through the normal
      user screen from inside it.
    - Done when: granting someone an instance is enough for them to sign in to
      it, with no SQL and no second screen.
- [x] **B.8 Retire the role path.** (M) *Added 2026-10-15, John's call: by
  the end of this there is no `authStrategy`, and identities are simply how
  users work -- the same collapse section 9 made for modes. Two ways to be a
  user is the problem ADR-001 set out to remove, and a flag keeps both. Done
  2026-10-15 on `feat/harness-identities` (prerequisite 3) and
  `feat/b8-retire-role-path`.*
    - *Deleted: the `role` branch of `database.js` `authenticate` (it is
      `authenticateIdentity`, full stop), the `authStrategy` setting,
      `config.authStrategy` and its unit test, the template key, every
      `usesIdentities()` branch in `server/services/role.js` along with
      `changeRoleCreateDb`, `grantMembership` and `revokeMembership` (no-ops
      once membership is rows), the matching calls in the Role and
      UserAccount triggers, the local profile pre-check in `doSignIn`, the
      identity gate on `provisionProfile`, the role branch of
      `databaseActor`, and the strategy banner on the Users screen. The
      server functions the triggers call keep their old names
      (`createRole`, `dropRole`, `changeRoleLogin`, `changeRolePassword`);
      the bodies write identities and grants.*
    - *`Role.isLogin` stays. It was slated to go, but it is the one thing
      that tells a user account from a group role inside an instance, and
      the triggers and the Users screen read it as such. It no longer has
      anything to do with Postgres; the name is the only legacy.*
    - *`install.js` is identity-native: no `CREATEROLE`, no `pg_authid`
      grant for the service account; `--instance` finds or creates the
      organization (`--organization`, default "Default", or whichever one
      the instance already belongs to), attaches the instance, makes the
      service account an identity with the password in config.json, grants
      it the instance, appoints it organization administrator and -- when it
      is the first identity on the platform -- platform administrator.
      Idempotent; re-running on `demo` changed nothing. Unknown flags are
      now fatal: `--my_database` used to reinstall the manager silently.*
    - *Installations carry `scripts/services.js` as the installed
      core-services script, so an existing instance needs `node install.js
      --instance <name>` after this lands or its user triggers still call
      `grantMembership`. Found the hard way: the harness clones `demo`.*
    - *The harness no longer makes Postgres roles for test users
      (`access.createUser`, `data-api.createSuperUser`); only the two
      bootstrap users keep one, so `identity.test.js` can copy a `pg_authid`
      verifier the way the migration does. `identity.test.js` and
      `isolation.test.js` run against the harness server instead of
      spawning their own.*
    - *One real defect surfaced by the oracle change: `cannot set another
      user's password` passed before because it checked the cluster role,
      which the identity path never touched. The UserAccount before-trigger
      wrote the new password before `crud` refused the update, so an
      unauthorized PATCH changed the password anyway. It now asks
      `isAuthorized` first.*
    - *Kept, as the item said: the `pg_authid` verifier import in the
      backfill.*
    - *Not done here: prerequisite 4, the passkey decision, is Tier C's
      first item and does not block this; prerequisite 1 is John's to run
      per installation.*
    - Done when: there is no way to sign in as a Postgres role, the suite
      runs green with no `authStrategy` anywhere, and the service account
      cannot create roles. *All three hold: api suite at the 66 baseline,
      `grep authStrategy` finds nothing outside this document and the ADR.*

## Tier C: Credentials and SSO

Where requirements 1 and 7 finally hold for everything, not just passwords.

- [x] **C.1 Move passkeys to the control plane.** (M) *Done 2026-10-16 on
  `feat/c1-c2-identity-credentials`. Credentials live in the manager's
  "$identity_credential" keyed by identity (bare table: no reinstall, and no
  generic data route ever serves key material); the assertion lookup joins
  the access grant, so a passkey follows the identity everywhere it can go
  and nowhere it cannot. Challenges are "$identity_challenge" rows, one per
  identity and kind, two minutes, consumed on use (E.2). The signature
  counter is finally checked against the stored value and written back; it
  was compared with a hard zero before, which waved cloned authenticators
  through. Registration is audited. `migrate-identities.js` copies old
  per-instance WebauthnCredential rows across. The done-when is proven to
  the edge of the signature check in `test/api/credentials.test.js` and
  across processes in `test/api/multinode.test.js` -- a real authenticator
  cannot run in the harness.*
- [x] **C.2 Identity-scoped MFA.** (S) *Done 2026-10-16 on the same
  branch. The second factor is the organization's decision:
  `authenticateIdentity` reads organization.isTwoFactorRequired alongside
  the tenant row, doSignIn honors it per signed-in user, and the config
  `twoFactorAuth` flag stays as the installation-wide override -- so the
  policy follows the user across every database of their organization,
  which is the done-when. Email flows were already organization-scoped by
  construction: a magic link lands on one instance's URL and the instance
  names its organization. Fixed on the way: a failed magic-link send turned
  the two-factor envelope into a 500, because the response stand-in handed
  to the strategy only had json().*
- [x] **C.3 Per-organization authentication policy and SSO.** (L) *Done
  2026-10-16 on `feat/c3-azure-ad-sso`, after John's answer: "Sure. Azure
  AD is the most common. Let's start with that."*
    - `identity_federation`: `(issuer, subject) → identity`, unique, plus
      `identity_provider` per organization (issuer, client id, client
      secret encrypted with the installation's key, and what to do with
      claims). Both arrive with `node install.js --manager`.
    - The protocol is `openid-client` 6.8.8, not hand-rolled: discovery,
      PKCE, state, nonce, signature, issuer and audience are its. What is
      ours is in `server/services/federation.js`, and the seam exists so
      the deciding half can be tested without a directory.
    - Policy per organization: `organization.authentication` is finally
      read. `sso` refuses a local password **without checking it** --
      there is nothing to learn from the answer, and a password that
      still works is a way round the policy. MFA is the provider's: it
      applied its own policy before it vouched for anyone.
    - Done when: one organization signs in through Azure AD while another
      uses local passwords, on the same installation. *The code is there
      and the deciding half is tested; the round trip itself is John's to
      prove against a real directory, which is item 2 of the status
      block's list.*
- [x] **C.4 Just-in-time provisioning from IdP claims.** (M, optional)
  *Done on the same branch.*
    - A subject nobody has seen is one of three things: already linked;
      a user name that is already an identity here, which is linked
      rather than duplicated (the person who was here before the
      organization moved to single sign-on keeps their account and its
      grants); or somebody to make an account for, if the provider is
      set to make them. A made account is granted the databases the
      provider names **and nothing else** -- an account that reaches
      nothing is a safer default than one that reaches everything.
    - A group claim carries the organization-administrator flag and is
      applied on **every** sign-in, so a group taken away at the
      provider is taken away here. Platform administration is never a
      claim: a provider speaks for one organization, and that flag
      crosses all of them.
    - Done when: a new employee at an SSO organization gets access
      without an administrator creating the account by hand. *Proven in
      `test/api/federation.test.js` from the claims inward.*

## Tier D: Tenant lifecycle into the framework

Independent of Tier B; can run in parallel. Absorbs most of improvement-plan
Tier 5.

- [x] **D.1 Provisioning as a resumable state machine.** (L) *Done
  2026-10-16 on `feat/d1-provisioning`. States requested -> created ->
  configured -> seeded -> active, one row per build in the manager's
  "$provision" table (bare, made on first use, so no reinstall), each step
  claimed with FOR UPDATE SKIP LOCKED and committed on its own; "notified"
  folded into activation, since notifying anyone is commerce. Create, Resume
  and Drop are on the Instances screen, platform administrators only; a new
  instance is registered closed and `authenticateIdentity` now refuses a
  closed instance, which "Close" never actually did. Registering an existing
  database checks its "$db" marker. The databases go through the guarded D.2
  API rather than onCommit triggers -- there is no trigger left in the path
  at all. Two defects fixed on the way: createDatabase read the new
  registration through the caller's client (only worked pre-split, and the
  lent client's uncommitted PATCH deadlocked the activating step), and a
  served instance was never a legal clone source because this process's own
  pool held a LISTEN connection; it lets go first now, and anyone else's
  connections still refuse the clone, which is the honest answer on a second
  node. `test/api/provision.test.js` runs the done-when: a genuinely failed
  step (busy template) leaves a resumable record and no orphan, resume
  finishes the build, the seeded administrator signs in to it, drop retires
  everything. F.3 proves the two-node claim.*
- [x] **D.2 A guarded database create, clone and delete API.** (M) *Done
  2026-10-13 on `fix/d2-database-api`. Every name goes through
  `datasource.databaseName`, which folds it the way Postgres folds an
  unquoted identifier and refuses anything that is not a plain name, so
  it can be compared with `pg_database` before use; the cluster's own
  databases and the manager are refused whatever the caller asks.
  `createDatabase` refuses a name already taken and rolls back only a
  database the call created, and reads the new database's module list
  from the new database (it passed the whole result array to
  `db.connect`, which carries no `pgDatabase`, so the list came from
  the default connection). `createTemplateDatabase` builds under a
  working name and swaps, keeping the old template until the new one is
  in place, marks templates with `ALTER DATABASE`, refuses a source
  another session holds instead of taking it away, and no longer sends
  port 80. The check is inside the three functions rather than in a new
  service, so the Admin Console's calls keep working: a platform
  administrator (since B.8 the only answer; before it a super user of the
  calling database on the role path), with every call audited. Verified against
  a live cluster (duplicate name, rollback, refusals, busy source,
  completed build, failed build).*
    - One framework entry point with the platform-administrator check inside
      it, so module code cannot reach the raw primitives.
    - Fix drop-on-failure in `createDatabase` (`server/datasource.js` ~332–400):
      only drop what this call created; normalize the name before checking
      `pg_database`; guard `conn2` in `finally`. **Absorbs 1.4.**
    - Fix `createTemplateDatabase`: build under a temporary name then swap;
      `ALTER DATABASE … IS_TEMPLATE` instead of writing `pg_database`; do not
      end the source tenant's pool mid-session; fix `port: conf.pgPort || 80`.
      **Absorbs 5.4.**
    - Done when: a duplicate tenant name cannot destroy an existing database,
      and a failed template build leaves the old template intact.
- [x] **D.3 Fix the tenant registry.** (M) *Done 2026-10-13 on
  `fix/d3-tenant-registry`. The splice passed a delete count of 0, so
  nothing was removed; `loadTenants` only ever added. An instance
  leaving the registry now gives up its pool and its LISTEN
  connection, in both paths, and `registryChanges` (unit-tested) is the
  decision of what leaves. `endPool` no longer builds a pool just to
  tear it down, and `registeredTenants` reports the registry without
  handing out the connections hanging off it. The other two bullets of
  5.2 were already fixed: `cleanupProcesses` walks every instance
  through `eachTenant`, and routes mount once through `mountedRoutes`
  (ADR-002). Verified in-process: registering an instance and then
  removing its Tenant row returns the registry, the pool and the
  listener to their starting state.*
    - `deleteDatabase` calls `tenants.splice(idx, 0)`, which removes nothing
      (`datasource.js` ~438). `loadTenants()` only ever adds. Deleted tenants
      keep their pool, their listener connection and their `pools[db]` entry.
    - **Absorbs 5.2.** Route re-registration duplicating Express handlers is
      part of this.
    - Done when: creating and deleting a tenant returns the process to its
      starting pool and listener count.
- [x] **D.4 Redraw the Admin Console seam.** (M) *Finished 2026-10-16 on
  `feat/d4-lifecycle`: template management ("Template" on an instance row
  copies a quiet instance into the frozen database new instances provision
  from, in place, audited; the service account does it, since only the
  pg_database mark needs a superuser and that mark is best effort) and the
  expired-demo sweep (an is_demo instance past its expiration is closed to
  sign-in and audited, hourly and on demand).
  **Dropping settled 2026-10-16** on `feat/demo-drop-after-grace`, John's
  answer: "I would eventually like demos to be dropped, but after more
  time has passed because somebody might notice and say 'hey, I want to
  turn that back on', but if nobody says anything after, say, a month,
  we'll just completely drop it." So the sweep closes at the expiration
  and drops once it has been expired longer than `demoGraceDays`
  (config.json, 30 by default, 0 never). Keeping one is moving its
  expiration forward -- reopening without moving it is closed again on
  the next pass. The database and its data go; the registry row stays,
  marked deleted, so what was there and when it went outlives the
  instance. The drop is given no actor and needs none: it reads the
  registry and refuses anything that is not a demo, closed and past the
  grace, so the policy is the authority rather than a caller. With D.1 the "generic parts" list is done:
  registry UI, provisioning, templates, sweep. The module keeps commerce --
  the WooCommerce webhook and edition pricing -- and its bugs are its own
  repository's. `test/api/lifecycle.test.js`. Earlier progress below.*
  *Partly done
  2026-10-12: identity administration is in the framework.
  `server/services/admin.js` serves `/:db/admin/...` from inside an
  instance -- the manager is not routable, so there is no database to
  point a browser at -- and acts on that instance's organization only.
  The three tiers of ADR-001 decide what a caller may do: platform
  (`identity.is_platform_admin`), organization
  (`identity.is_org_admin`), and instance (a tenant super user, limited
  to the instance they are signed in to). It reads under either
  strategy and reports which one is in force, so an administrator can
  see what identity sign-in would do before turning it on. The tenant
  registry, provisioning and template management are still the module's.*
  *More done 2026-10-13 on `feat/admin-instances`: the registry UI, as
  a second screen next to Users (`client/components/admin-instances-page.js`,
  route `/instances`, `GET /:db/admin/instances` and three writes).
  It lists the organization's instances with their database,
  connection, user count, whether this server has them loaded and
  listening, and whether sign-in is open; an organization administrator
  can register a database that exists, attach an instance that belongs
  to no organization, and close or open one. An instance write reads
  the registry again, so a registration is served without a restart.
  Closing the instance you are signed in to is refused. Still the
  module's or the command line's: building and dropping databases
  (D.1), template management, the expired-demo sweep. Nothing checks
  the `"$db"` marker before registering, so a database registered by
  mistake shows as loaded and answers nothing -- worth doing with D.1.*
    - Move the generic parts into the framework: tenant registry UI,
      provisioning, template management, expired-demo sweep.
    - Leave only business policy in the module: the WooCommerce webhook and
      the edition and pricing rules. Fix its bugs there —
      `if (!items.length > 1)`, the `PATCH Tenant` with no `id`, the `<db>_demo`
      collision check, the array comparison in `triggers-tenant.js`.
      **Absorbs 5.5.**
    - Done when: a new installation can create and manage tenants with no
      module installed, and the module only adds commerce.
- [x] **D.5 Decide whether edition limits are a real boundary.** (S)
  *Settled and built 2026-10-16 on `feat/d5-edition-platform-only`.*
    - Every feather and route is installed in every edition, so a Standard
      tenant can call Professional routes directly. **Absorbs 5.6.**
    - **John's answer:** an edition "helps it determine what workbooks to
      show without having to create a proliferation of packages for each
      of those options", and "eventually in this new structure I would
      like the edition setting to only be set or changed by the platform
      administrator". So an edition is **not** a security boundary: it
      decides what is offered, not what is possible, and a package per
      edition is exactly what it exists to avoid. **Who may change it
      is** a boundary, and that is the platform administrator -- not the
      instance's super user, who is the customer's own administrator.
    - How it works today, for the record (JobShop 2.3.0-alpha2, read out
      of the installed package): the edition is a module settings row
      (`jobShopSettings.edition`, "Standard"/"Professional"/
      "Enterprise"); worksheets are hidden by `f.hiddenFeathers()` in the
      browser, which the server never consults; whole workbooks are
      hidden for real by stripping their `$auth` rows, since
      `getWorkbooks` filters on `can_read`.
    - **Built:** a settings row is the platform's when its definition says
      `isPlatformOnly` or when `config.json`'s `platformOnlySettings`
      names it -- the second so `jobShopSettings` can be locked down
      without touching that repository. The check runs before the
      instance's own authorization, because an instance super user passes
      that one. Reading is unchanged.
    - **Left to the module:** JobShop's own `/job-shop/do-configure/`
      route has no role check (the Develop workbook having no `$auth`
      rows is all that keeps the button out of reach) and its service
      passes the super-user bypass to every inner request. The settings
      write is now refused, which is what the edition actually is, but
      the route should refuse too.
    - Done when: the decision is recorded, and enforced if that is the
      answer. *Both hold.*

## Tier E: Multi-node readiness

The pub/sub design is already sound: `$subscription` is a table and the
triggers run `pg_notify(node.nodeid, …)` (`scripts/tables.js` ~20–135), so the
database fans each change out to exactly the nodes that care. Sessions, record
locks and advisory locks are all already database-backed. These are the gaps.

- [~] **E.1 Claim scheduled jobs.** (M) *Framework half done 2026-10-16 on
  `feat/e-multinode-readiness`: `f.datasource.claimWork(key, seconds)`
  claims named work in a manager "$claim" row -- first caller wins, the rest
  are told no until the window passes, a dead claimant's claim expires
  rather than leaks. Two processes contending is proven in
  `test/api/multinode.test.js`. What remains is one call in the CronJob
  module's `initialize-cron-job.js` -- claim the job's name for its interval
  before firing -- which lives in the module's repository, so the done-when
  (two nodes, each job once) closes there.*
- [x] **E.2 Store WebAuthn challenges.** (S) *Done 2026-10-16 with C.1:
  challenges are manager rows, single use with expiry, and a ceremony begun
  on one node finishing on another is run in `test/api/multinode.test.js`.*
- [x] **E.3 Session strategy.** (M) *The unambiguous half done 2026-10-16
  on `feat/e-multinode-readiness`: `resave: false` (improvement plan 4.4),
  so a request no longer rewrites its whole session row; rolling stays and
  slides the expiry with the store's cheap touch.*

  ***Settled 2026-10-16 by the picker (G.1), which John asked for: the
  session stays in the manager.*** The picker is a sign-in that happens
  before any instance is chosen, so there is no instance to read a
  session from; moving `$session` into the tenant database (option b)
  would make the front door impossible, and a stateless cookie (option
  c) would buy the same outage tolerance at the price of revocation.
  What the manager's outage costs is therefore accepted on the record:
  **no new sign-ins, and sessions already established keep working**
  only so far as the instance does not need the manager -- which it
  does, for the session store itself. The compensation is that one
  sign-in reaches every instance and a sign-out ends it everywhere,
  which is what the README advertises.
    - `$session` is in the control-plane database with `resave: true` and
      `rolling: true` (`server.js` ~2349), so **every request on every tenant
      writes a row in the control plane.**
    - Do `resave: false` immediately — it is improvement-plan 4.4 and strictly
      better. Then choose: move `$session` into the tenant database keyed by
      identity, or go to a stateless signed cookie. ADR §5 recommends the
      former, for the better failure mode: no new sign-ins, rather than
      everything down.
    - Done when: a control-plane outage leaves signed-in users working.
      *Not met, and deliberately so: the picker needs the manager, and
      the trade was made the other way.*
- [x] **E.4 Pool sizing and a connection proxy.** (M) *Done 2026-10-16 on
  the same branch: instance pools are capped by `pgTenantPoolSize` (default
  10) with `pgTenantIdleTimeout` (default 60s) closing idle clients, so a
  quiet instance holds only its LISTEN connection; `pgMaxConnections` keeps
  governing the manager pool. The README documents the budget -- worst case
  instances x (cap + 1) + manager, practical floor instances + manager --
  which is the done-when. The flagged SSL comments are settled with the
  reason the server's own TLS settings stand in (every TenantService row
  points at the cluster this server already trusts; the service carries no
  TLS material of its own yet). PgBouncer remains an operations choice, not
  code.*
    - `pgMaxConnections` is ignored; each tenant gets 10, one held permanently
      for LISTEN; each `f.datasource.lock` takes 2 more. Per node it is
      (tenants + 1) × 10, so the budget multiplies by node count.
    - Honor the setting, lower the per-tenant maximum, set `idleTimeoutMillis`,
      end pools for idle tenants, put PgBouncer in front. Fix the SSL config
      the code comment flags. **Absorbs 5.1.**
    - Done when: a documented tenant count per node fits inside
      `max_connections` with headroom.
- [~] **E.5 Survive a rejected promise, and drop per-process guards.** (M)
  *The framework half was done earlier (`fix/6.1-unhandled-rejection`,
  merged: the unhandledRejection handler logs instead of dying). The second
  half -- replacing SupplyChain's module-level `pending` guards with
  database locks (6.2) -- lives in the SupplyChain repository.*
    - No `unhandledRejection` handler exists, so on Node 15+ one floating
      rejection kills the process — and with it every tenant that node serves.
      **Absorbs 6.1**, and it belongs here because the blast radius grows with
      consolidation.
    - Replace the module-level `pending` guards in SupplyChain ship and issue
      code with database locks; the `splice(-1, 1)` path can remove another
      request's id. **Absorbs 6.2.**
    - Done when: a deliberate floating rejection is logged and alerted without
      taking the server down.

## Tier F: Verification

The isolation claims in the audit were traced in code but never proven by
running them. These are the tests that close that out. All need a writable
scratch cluster, not `demo`.

- [x] **F.1 Two-organization isolation test.** (M) *Done 2026-10-15 on
  `feat/f1-isolation-test`: `test/api/isolation.test.js`, 14 tests (since
  B.8 against the harness server). A second organization is seeded
  carrying the same two usernames as the harness's own, with different
  passwords and no grant to anything. It proves the other organization's
  password does not open this instance, that its administrator is refused
  outright, that a name existing only there is refused, and that a refused
  sign-in leaves no session; then that an organization administrator's every
  write -- password, status, grant, org-admin -- answers 404 against an
  identity over there, and that the hash over there is untouched afterwards.
  **Checked by mutation:** dropping the organization from the sign-in lookup
  (`server/database.js`) fails the sign-in tests, and dropping it from
  `manager.identity` fails all seven administration tests, so the suite is not
  passing vacuously. This is the test item 1.1 always needed.*
- [x] **F.2 Consultant test.** (S) *Mostly done 2026-10-15 in the same file:
  one username with an identity in each organization, separate credentials
  proven both ways, an organization administrator seeing and controlling only
  their own, and disabling the identity over there leaving this one signing
  in. Finished 2026-10-16 on `feat/f3-multinode-test`: the second
  organization now owns an instance of its own -- provisioned through D.1,
  handed over, the builder's grants removed -- so the mirror holds from both
  sides, including that neither administrator can close the other's instance
  (404: the registry does not admit theirs exists).*
- [x] **F.3 Multi-node test.** (M) *Done 2026-10-16 on
  `feat/f3-multinode-test`: `test/api/multinode.test.js` starts a second
  server against the same databases. Run, not asserted: a session opened on
  one node works on the other and one sign-out ends both; a WebAuthn
  ceremony begun on node A is consumed on node B; a provisioning run claimed
  by one node answers busy on the other; two bare processes contending for
  one claim produce exactly one winner, and an expired claim is anyone's
  again. Said plainly in the file: cron end to end waits on the CronJob
  module calling claimWork, and record locks surviving a restart is not
  covered.*
- [x] **F.4 Migration rehearsal.** (M) *Recorded done 2026-10-16: B.6
  rehearsed exactly this -- a copy of `demo` registered, backfilled and cut
  over, users created and passwords changed on the identity path, the api
  suite at its baseline against the copy -- and the rollback half of the
  item was removed by John's decision that the migration is one way (B.6's
  note). What remains is the real run per installation, which is operations,
  not rehearsal.*

## Tier G: Platform administration

*Added 2026-10-16. John: "I don't see the option yet to log in without
a db in our url where, after authentication, I am prompted to pick
one", and "Managing orgs is obviously essential". The plan described
the picker in section 9 and never made it an item; organizations were
the command line's alone. All four are done.*

*G.5 added 2026-10-24, after John read back the administration model:
the tiers were described as a hierarchy and were not one inside an
instance.*

- [x] **G.1 The instance picker.** (M) *Done 2026-10-16 on
  `feat/g1-instance-picker`.* A URL with no database answers with a
  sign-in against the manager alone and the instances the identity's
  grants reach; choosing one redirects there. Its own page rather than
  part of the application bundle, which is built rather than read.
    - **Entering an instance is where access to it is proven.** One
      sign-in now reaches several instances, which it never did when a
      session belonged to one instance from the start, so the grant is
      read again at the door and recorded on the session. A revoked
      grant shuts the door at the next entry rather than at expiry.
    - (Superseded by ADR-001 revision 4, 2026-10-21: a user name is now
      unique across the installation and nothing is ambiguous.)
      A user name is unique within its organization, so an ambiguous
      one is asked which organization it means -- without the
      organizations being listed to someone who has not signed in, and
      without trying the password against each, which would count a
      failure against every one of them and lock them all.
    - An organization that requires a second factor picks here and
      signs in at the instance: the code is sent by the instance's own
      mail service, which the manager has none of. No passport session
      is made, so nothing is admitted on a half-proved identity.
    - Done when: a bare URL signs somebody in and lands them in an
      instance they are granted, and refuses one they are not.
      *`test/api/picker.test.js`, 12 claims.*
- [x] **G.2 Organizations on screen.** (M) *Done 2026-10-16 on
  `feat/g2-platform-console`.* `/platform`, reached from the picker:
  the organization list with what each owns, and the actions --
  create, rename or change its sign-in, appoint its first
  administrator, close or open it, build it an instance. Onboarding is
  those in order, where it used to be `install.js --instance <name>
  --organization "<name>"` leaving the service account as the
  organization's administrator.
    - The console runs with no instance of its own, so `contextFor`
      works without one: the actor comes from the session identity and
      must be a platform administrator, and every method names what it
      acts on. **The authority is read from the identity each time,
      never taken from the session.**
    - Done when: a new organization is created, given an administrator
      and given an instance, without a command line.
      *`test/api/platform.test.js`, 13 claims.*
- [x] **G.3 The fleet across organizations.** (S) *Done on the same
  branch.* Every instance on the installation with its owner, state,
  what it carries and how much of that is behind -- the Instances
  screen without the organization boundary, which only a platform
  administrator is given.
- [x] **G.4 Platform administration as its own place.** (S) *Done on
  the same branch, answering John's "make the global platform
  administration an option for a global admin".* The manager stays
  unrouted; the console is served where no database is named and the
  picker is its door, so a platform administrator administers from
  there rather than borrowing an instance's session.
    - *Not done: an entry from inside an instance, for a platform
      administrator already signed in to one. It is a button in
      `client/components/admin-page.js` and would only appear in debug
      mode until `client/clientmin.js` is rebuilt, which is why it was
      left out rather than shipped half-visible.*

- [x] **G.5 A platform administrator administers every instance.** (S)
  *Done 2026-10-24 on `fix/platform-admin-instance-authority`.* The two
  places that decide instance authority -- `administersInstance` in
  `server/services/admin.js` (was `orgAdminOf`, used when a profile is
  made) and `administersInstance` in `server/database.js` (was
  `isOrgAdminHere`, used by `healSuper` at sign-in) -- asked the
  `organization_admin` appointment table alone, and a platform
  administrator is appointed over no organization. Both now answer for
  `identity.is_platform_admin` too, keeping the status gate so a suspended
  platform administrator inherits nothing. Code only: no feather, property
  or schema change. Recorded as ADR-001 revision 5.*
    - *Changes nothing in John's own installation, checked read-only
      against the manager on 2026-10-24: old and new logic agree on every
      identity-instance pair there, because the one platform administrator
      (`ncuser_12161`) is appointed over all three organizations and the
      appointment leg already covered it. The loophole is latent, and
      bites the first platform administrator who is not appointed -- a
      Featherbone staff account, or revision 4's reseller.*
    - Done when: a platform administrator with no appointment over an
      organization signs in to one of that organization's instances and is
      a super user there.
    - **Follow-on, not done.** `is_super` carries no provenance, so
      standing an organization administrator down still clears an instance
      administrator named by hand. Recording the cause needs a
      `$`-prefixed framework table; no feather change either way.

- [x] **G.6 Move an instance to another organization.** (S) *Done
  2026-10-31 on `feat/move-instance`.* Move on the platform console's
  Instances list (`POST /platform/instance/move`, platform administrators
  only) re-points `tenant._organization_organization_pk`; the database is
  not touched. John's answers: revoke every grant held by someone the new
  organization does not answer for (platform administrators and anyone
  appointed over it keep theirs), lower their `is_super` in the instance,
  warn on sign-in policy differences rather than block, copy no
  settings, record a `instance.moved_out` / `instance.moved_in` entry in
  each trail (earlier history is not copied: `admin_audit` has no
  instance column, so most of it cannot be told apart), close an
  organization left with no instance, and appoint nobody -- the platform
  administrator does that afterwards. Revoked people's sessions in the
  instance are deleted too.
    - An organization that is home to an active platform administrator
      is not closed even when emptied: closing it would lock them out.
    - `dryRun` returns the same plan and changes nothing; the console
      shows it before the Move button enables.
    - Refused while held for maintenance or while a build is unfinished.
    - Done when: `test/api/move-instance.test.js` (6 claims) passes.

- [x] **G.7 The instance trail is the organization's.** (S) *Done
  2026-10-31 on `fix/audit-trail-scope`.* `manager.systemAudit` read every
  `instance.*` and `database.*` row in the manager, so the Instances
  screen showed an organization administrator other customers' instance
  names and the cluster's database names. It now takes the organization
  and an organization administrator sees only rows recorded on its
  behalf; the `database.*` rows record none, so they are the platform's
  alone. A platform administrator still sees everything. Found while
  building G.6.
    - Done when: `test/api/instance-audit-scope.test.js` (2 claims) passes,
      and fails without the fix.
    - *Not done, noticed:* the same screen also hands an organization
      administrator the cluster's unregistered database names and the
      connection list (host, port, user), because registering an instance
      needs them. Whether that is theirs to see is a decision, not a bug.

## 7. What the improvement plan loses to this plan

Update `featherbone-improvement-plan.md` to mark these. Nothing is dropped;
items either move here or are deleted by the design.

| Improvement-plan item | Disposition |
| --- | --- |
| 1.1 Isolate tenant users | **Superseded** — this whole plan. Partial fix at A.5. |
| 1.6 Login connection leak | **Deleted** by B.2. |
| 1.8 Secrets in SQL | **Split** — role half deleted by B.4; `pgp_sym_decrypt` half stays. |
| 0.1 `POST /data/user-account` | **Moved** to B.5. |
| 0.3 Unauthenticated endpoints | **Split** — sign-in leaks to B.2; the rest stays. |
| 0.4 Authorization gaps | **Split** — role resolution to B.3; `$auth` gaps stay. |
| 1.4 `createDatabase` drop-on-failure | **Moved** to D.2. |
| 5.1 Pool sizing | **Moved** to E.4. |
| 5.2 Registry leaks | **Moved** to D.3. |
| 5.3 Atomic provisioning | **Moved** to D.1. |
| 5.4 Template creation | **Moved** to D.2. |
| 5.5 WooCommerce bugs | **Moved** to D.4. |
| 5.6 Edition enforcement | **Moved** to D.5. |
| 6.1 Unhandled rejections | **Moved** to E.5. |
| 6.2 Multi-tenant shortcuts | **Moved** to E.5. |
| 4.4 Per-request overhead | **Overlaps** E.3 for the session half; the rest stays. |
| 1.2, 1.3, 1.5, 1.7 | **Stay.** Independent security fixes; do them now. |
| Tier 2 (money and inventory) | **Stays, and does not wait.** |
| Tier 3 (indexes) | **Stays, and does not wait.** |
| Tier 4 (query performance) | **Stays**, except the session item. |
| 6.3–6.6 | **Stay.** |

## 8. Suggested order

1. **A.2** and improvement-plan **2.1, 2.2, 2.3** — in parallel, now. Small,
   independent, and all four are live defects.
2. **A.1, A.3, A.4, A.5** — the foundation, ending with a correct partial fix
   for 1.1.
3. **B.1–B.6** — the cutover. **F.4** rehearses it before it is real.
4. **D.1–D.5** — can start as soon as A is done, in parallel with B.
5. **C.1–C.3**, then **E.1–E.5**, then **F.1–F.3**.
6. Return to `featherbone-improvement-plan.md`.

## 9. One mode, and the instance manager

*Proposed 2026-10-10; open questions settled the same day. **Implemented
2026-10-11 on `feat/one-mode`**, rebuilt on ADR-002 after the first attempt
(`wip/one-instance-mode`) hit the catalog question in section 10. What
shipped: `managerDatabase` (default `db_manager`) replaces `serverRole`,
`both` and the `controlPlane` block; `"$db"` schema 2 with kinds `manager`
and `instance`, converting older markers in place so `node install.js
--instance <name>` upgrades an existing database; `--manager` builds the
manager; the manager holds the registry and the sessions and is never
routable; the harness builds a manager plus two instances. Still open here:
the Tenant → Instance rename (question 2, lands with D.4) and the admin
console requirements below, which are D.1/D.2 work.*

### Why

Even the smallest customer — one job shop inside four walls — wants more than
one database: a production system, a test system for trying a change before
it is live, and often a demo kept as a reference for what a fully configured
system looks like. Multiple instances are not an enterprise feature; they are
how every customer runs. So there is no single-database deployment worth
keeping a second code path for.

This is a better justification for the control plane than multi-company
tenancy was. It applies to every install, which means the manager gets
exercised everywhere instead of rotting in a corner of the codebase.

### The shape

* Multi-instance is the only supported mode. No `serverRole`, no `both`, no
  single-database install.
* `server/config.json` names one Postgres connection and nothing more.
  `pgDatabase` goes away.
* The manager database is `db_manager`. `node install` creates it if absent
  and upgrades it if present.
* Every application database is an **instance**, registered in the manager.
  Identity and sessions live in the manager; application data never does.

### What this retires from A.1

| A.1 work | Disposition |
| --- | --- |
| `"$db"` marker (kind, schema version, mode) | **Survives.** Kinds reduce to `manager` and `instance`. |
| `mode` in the database | **Survives, and matters more.** Prod/test/demo per instance is the whole point of this section. |
| Manifest `target` | **Survives.** The manager runs its own packages. |
| `serverRole`, `both` | **Retired.** One shape, nothing to declare. |
| `controlPlane` block and its environment overrides | **Retired.** One connection, one known database name. |
| `install.js --control-plane/--tenant/--target` | **Mostly retired.** Install always builds the manager; `--mode` stays, for the first instance. |
| `scripts/split-control-plane.js` | **Retired**, superseded by attach-an-existing-database below. |

### What the administration console must do

Requirements, not a design. Items 2–5 are largely D.1/D.2 work already;
item 1 is new and it replaces A.5's backfill script.

1. **Attach an existing database.** Register a database that already exists,
   after checking it carries a `"$db"` marker with a schema version this
   release understands. This is how an existing installation upgrades — the
   old database becomes its first instance — so it replaces the migration
   script rather than adding to it.
2. **Copy a registered instance.** Production to test, most often.
3. **Turn a registered instance into a template.**
4. **Create an instance from a template.**
5. **Create an empty instance** — what `node install` used to do.

Not on the list, and needed:

6. **Drop an instance**, guarded, and **rename** one.
7. **Upgrade the fleet.** With N instances per customer, a release upgrade is
   N schema upgrades; today that is one `node install` per database, by hand.
   The manager should hold each instance's schema version, show which are
   behind and upgrade them. This is new work that did not exist when a
   customer had one database, and it is the operational cost of this section.

Three constraints to record before any of it is designed:

* `CREATE DATABASE … TEMPLATE` **requires no active connections to the
  source.** Copying a live production instance therefore needs either a
  maintenance state on that instance or `pg_dump`/`pg_restore` instead. (2)
  cannot be one click on a database people are working in.
* `createTemplateDatabase` (`datasource.js` ~468) sets `datistemplate` with a
  direct `UPDATE pg_database`, which needs a Postgres superuser. A Featherbone
  template is better as a flag on the registry row — an instance offered as a
  starting point — than as Postgres's template flag, which buys nothing here.
  D.2 already lists this function's other bugs.
* A template should be **inert**: never connected to, so it cannot drift and
  so (4) always satisfies the no-active-connections rule.

### Sign-in and instance selection

The URL keeps the database as its first path element, as today. New: with no
database in the URL, the user is shown the instances they have access to, and
selecting one redirects there. No session means signing in first.

This settles an ADR §9 open question by implication, and the plan should say
so: **authentication happens once, against the manager; authorization is
resolved per instance.** The manager holds the credential of record and the
list of who may reach which instance; each instance still holds the `$auth`
grants that say what they may do once there.

Two consequences:

* **E.3 is constrained, not open.** The picker cannot work if `$session`
  lives in an instance — there is no instance to read it from before one is
  chosen. ADR §5's preference for moving sessions into the tenant database
  has to be reconciled with this, or dropped.
* **The manager must repair the gap it creates.** If the manager says a user
  may reach an instance but that instance has no account row or role for
  them, the user gets a confusing failure. Provisioning into the instance,
  and re-checking it, belongs to the manager. This is the same provisioning
  job A.4/B.5 describe, now with a UI that makes its absence visible.

### How much of this is new work

Most of it is already in this plan under other names:

| Requirement | Already |
| --- | --- |
| Guarded create, copy and delete | D.2 |
| Provisioning as a resumable state machine | D.1 |
| Template management in the framework, not the module | D.4 |
| Registry leaks on delete | D.3 |
| Where `$session` lives | E.3 |

Genuinely new: attach-an-existing-database, the instance picker, fleet
upgrade — and **D.4 stops being a tidy-up and becomes a gate.** A fresh
install would otherwise have a manager and no way to create its first
instance until the registry UI ships in the framework. So `node install`
should create the manager *and* a first instance, leaving a new installation
as usable as it is today.

### Open questions

1. **Settled 2026-10-10: default `db_manager`, overridable by one setting,
   not documented for ordinary use.** Hard-coding would mean one
   Featherbone installation per Postgres cluster. The integration harness
   clones the configured database into a throwaway copy, so with a fixed name
   parallel test runs collide, and a developer cannot keep two independent
   installations on one cluster — which is how this machine is set up today.
2. **Settled 2026-10-10: rename `Tenant` to `Instance`.** The registry row is
   an *instance* (a database); an *organization* owns instances; a
   single-company customer is one organization with three instances. The
   rename reaches into the Admin Console module (`triggers-tenant.js`, the
   WooCommerce webhook), so the cheapest moment is D.4, which redraws that
   seam anyway — but the feather and its relations must be settled before A.3
   builds on them. `TenantService` becomes part of the same rename.
3. **Settled 2026-10-10: multi-cluster stays out of scope**, and nothing is
   being traded away to keep it out. Tier B's own drivers are single-cluster
   (see the note at the head of Tier B), so it proceeds regardless; once it
   has, `pg_authid` stops being the identity boundary and a second cluster
   becomes an ordinary connection that `Instance`'s service row already
   describes. Revisit only if a deployment actually needs one.

## 10. The blocker the collapse ran into: one catalog, or one per instance?

> **Answered 2026-10-11 by `adr-002-packages-on-disk.md`, and the three
> options below are withdrawn.** None of them is right, because all three
> assume a database has to own the catalog. Module code and feather
> definitions move to versioned packages on the server's file system; a
> database records which versions are deployed into it. Read the ADR instead
> of this section; what follows is kept only for the diagnosis in "Why".


*Found 2026-10-10 while implementing section 9 on `wip/one-instance-mode`.
Needs a decision before that branch can be finished. Nothing else in this
plan is blocked by it.*

### What happened

The collapse itself went in cleanly: `serverRole`, `both` and the
`controlPlane` block gone, one `managerDatabase` setting, a schema 2 `"$db"`
marker that converts an older one in place, `node install --manager` and
`--instance`, a harness that builds both. A server boots, serves an instance,
reports that instance's own mode, keeps sessions in the manager and refuses
to serve the manager as an application.

Then sixteen authorization tests hang on *"Routes for feather ... never
appeared"*.

### Why

The server holds **one** catalog, **one** route table and **one** set of
services. It reads them through `tenant: false` -- the connection used when
no instance is named:

* `datasource.getCatalog`, `getRoutes`, `getServices` (`datasource.js` ~729,
  ~759, ~772)
* the Feather, catalog and Route subscriptions (`server.js` ~1981, ~2066,
  ~2086)

In a single-database install that connection *was* the application database,
so this worked by accident. Point it at a manager carrying no application
modules and the feathers a request creates are written to the instance and
looked for in the manager.

This is not a naming problem. `registerRoute` (`server.js` ~551) mounts every
module route at `/:db/<module><path>` on one shared router, so **every
database a process serves has always shared one catalog and one route
table**. That is the same finding as improvement item 5.6, which notes that a
Standard tenant can call Professional routes: there is no per-tenant boundary
because there is only one catalog.

So the question is not where to read the catalog from. It is whether two
instances may ever run different modules.

### The options

| | What it means | Cost | What it gives up |
| --- | --- | --- | --- |
| **A. A primary instance** | One instance is nominated; its catalog, routes and services are what the process serves, exactly as the configured database is today | Small. Re-point six call sites and move `loadTenants` ahead of `getCatalog` at boot | Nothing that works today -- but it fixes nothing either, and makes "they all share one catalog" an explicit design rather than an accident |
| **B. Per instance** | Catalog, routes and services become per-instance, cached per instance, subscribed per instance | Large. Route registration, the subscription machinery and every `tenant: false` reader change | Nothing. This is what editions, and D.5, actually need |
| **C. The manager carries the superset** | Every module's feathers install into the manager as well, so it holds the catalog | Medium, and it puts application schema in the manager, which section 9 exists to prevent | Coherence |

**A is the honest interim** and keeps parity with today; **B is where this has
to end up** if an edition is ever to mean anything. A does not block B.

Worth noting that B overlaps D.5 almost entirely: deciding that editions are a
real boundary *is* deciding for per-instance catalogs. If editions are
cosmetic, A is enough and should be written down as deliberate.

### What is waiting

`wip/one-instance-mode` carries the finished configuration, installer,
marker, boot and harness work and is pushed but **not mergeable**. Once this
is decided it needs the chosen option plus a re-run of the API suite, and it
can then be squashed into a branch worth merging.
