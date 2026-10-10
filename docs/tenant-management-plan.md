# Tenant Management and Identity — Rework Plan

Started 2026-10-07. The design this implements is `adr-001-identity-and-tenancy.md`.
When this plan is done, work returns to `featherbone-improvement-plan.md`,
whose Tier 1 is gated by it. Section 7 lists what that plan loses to this one.

> **Proposed direction change, 2026-10-10 — not settled.** Multi-instance
> would become the *only* supported shape: every installation gets an instance
> manager database plus one or more application instances, because even a
> single-company customer wants production, test and demo. It retires part of
> A.1, replaces A.5's backfill and makes D.4 mandatory. **Read section 9
> before starting A.3.**

Sizes are rough relative weights, not estimates: **S** a sitting, **M** a few
days, **L** a week or more of focused work.

## How to use this plan

Tiers A–F are ordered by dependency, not by value. Within a tier, items are
mostly independent.

| Tier | Theme | Items | Gate |
| --- | --- | --- | --- |
| A | Foundations | 5 | None — start here |
| B | Identity cutover | 6 | Needs A |
| C | Credentials and SSO | 4 | Needs B |
| D | Tenant lifecycle into the framework | 5 | Needs A; independent of B |
| E | Multi-node readiness | 5 | A.2 first; rest independent |
| F | Verification | 4 | Proves A–E |

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
- [ ] **A.4 Administration model.** (M)
    - Implement the three tiers in ADR §3: platform administrator,
      organization administrator, tenant roles.
    - A platform administrator is an identity with a flag — not a Postgres
      superuser, not `user_account.is_super`.
    - Write every privileged action taken on a customer's behalf to
      `admin_audit`: appointing an administrator, suspending an identity,
      transferring rights.
    - Rename `user_account.is_super` in docs and UI to **tenant super user**
      so it stops reading as a platform role. No behaviour change.
    - Done when: the break-glass path in requirement 3 — suspend a departed
      organization administrator, appoint a replacement — is doable in the UI
      by a platform administrator, and leaves an audit trail.
- [ ] **A.5 Ownership backfill, and the interim fix for 1.1.** (S)
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

- [ ] **B.1 Application-side password verification.** (M)
    - Hash with `node:crypto` `scrypt` or argon2id (ADR §9 open question).
    - Import existing `SCRAM-SHA-256` verifiers from `pg_authid` and verify
      against them, re-hashing on first successful sign-in. Proven in
      `docs/scram-verify.js`; needs a superuser connection once per cluster.
    - Treat exported verifiers as password-equivalent; drop them per identity
      once re-hashed.
    - Done when: every existing user signs in with their current password, with
      no Postgres role involved, and their stored verifier is gone afterwards.
- [ ] **B.2 Rewrite the sign-in path.** (M)
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
- [ ] **B.3 Replace `pg_has_role()` with membership resolution.** (L)
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
- [ ] **B.4 Stop creating Postgres login roles.** (M)
    - No `CREATE ROLE`, `ALTER ROLE`, `DROP ROLE`, `GRANT` or `REVOKE` for
      users. Remove `CREATEROLE` from the service account. Deprecate
      `Role.isLogin`.
    - **Deletes the role half of item 1.8** — no more
      `ALTER ROLE … PASSWORD %L`. The `pgp_sym_decrypt` half stays in the
      improvement plan.
    - Done when: a fresh install creates no login roles, and the service
      account has no `CREATEROLE`.
- [ ] **B.5 `user_account` becomes the local profile.** (M)
    - Keyed to an identity; holds preferences and contact; remains the target
      of existing relations and of `created_by` / `updated_by`.
    - Granting access provisions the local row; revoking deactivates it without
      destroying history.
    - **Fixes item 0.1** (`POST /data/user-account` always 500,
      `scripts/services.js` ~1357) on the new path.
    - Done when: a grant creates a usable local profile, and
      `POST /data/user-account` succeeds.
- [ ] **B.6 Migration tooling and rollback.** (M)
    - One command to migrate a cluster: backfill organizations, identities,
      grants and verifiers; report anything ambiguous rather than guessing.
    - A documented rollback for each phase, and a dry-run mode.
    - Done when: a copy of `demo` migrates cleanly, the full test suite passes
      against it, and the rollback restores role-based sign-in.

## Tier C: Credentials and SSO

Where requirements 1 and 7 finally hold for everything, not just passwords.

- [ ] **C.1 Move passkeys to the control plane.** (M)
    - `WebauthnCredential` → `identity_credential`. A passkey then works on
      every database the identity can reach, which it does not today.
    - Store challenges, which currently sit in process memory
      (`let challenges = {}` in `server/services/webauthn.js`) — this is also
      multi-node blocker E.2.
    - Done when: a passkey registered against one database signs the user in to
      another in the same organization, on a different node.
- [ ] **C.2 Identity-scoped MFA.** (S)
    - Keep the existing magic-link two-factor; move enrolment and the
      `twoFactorAuth` decision to the identity and the organization policy.
    - Scope email flows by organization: two organizations may each have
      `alice@consult.com`, so a reset or magic link must name its organization.
    - Done when: MFA follows the user across their organization's databases.
- [ ] **C.3 Per-organization authentication policy and SSO.** (L)
    - `identity_federation`: `(provider, issuer, subject) → identity`, plus
      per-organization IdP configuration. OIDC first; Azure AD as the
      reference target.
    - Policy per organization: local password, SSO only, or both; MFA required
      or not.
    - Done when: one organization signs in through Azure AD while another uses
      local passwords, on the same installation.
- [ ] **C.4 Just-in-time provisioning from IdP claims.** (M, optional)
    - Create the identity and its grants on first SSO sign-in, from group
      claims mapped to tenant roles.
    - Done when: a new employee at an SSO organization gets access without an
      administrator creating the account by hand.

## Tier D: Tenant lifecycle into the framework

Independent of Tier B; can run in parallel. Absorbs most of improvement-plan
Tier 5.

- [ ] **D.1 Provisioning as a resumable state machine.** (L)
    - States: requested, database created, configured, administrator seeded,
      notified, active. Idempotent steps, each retryable.
    - `CREATE DATABASE` and `DROP DATABASE` move to `onCommit`, out of AFTER
      triggers and out of the admin transaction.
    - **Absorbs improvement-plan 5.3.** Mandatory before multi-node, because
      two nodes must not provision the same tenant twice.
    - Done when: killing the process at any step leaves a resumable record, and
      re-running completes without orphaning a database.
- [ ] **D.2 A guarded database create, clone and delete API.** (M)
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
- [ ] **D.3 Fix the tenant registry.** (M)
    - `deleteDatabase` calls `tenants.splice(idx, 0)`, which removes nothing
      (`datasource.js` ~438). `loadTenants()` only ever adds. Deleted tenants
      keep their pool, their listener connection and their `pools[db]` entry.
    - **Absorbs 5.2.** Route re-registration duplicating Express handlers is
      part of this.
    - Done when: creating and deleting a tenant returns the process to its
      starting pool and listener count.
- [ ] **D.4 Redraw the Admin Console seam.** (M)
    - Move the generic parts into the framework: tenant registry UI,
      provisioning, template management, expired-demo sweep.
    - Leave only business policy in the module: the WooCommerce webhook and
      the edition and pricing rules. Fix its bugs there —
      `if (!items.length > 1)`, the `PATCH Tenant` with no `id`, the `<db>_demo`
      collision check, the array comparison in `triggers-tenant.js`.
      **Absorbs 5.5.**
    - Done when: a new installation can create and manage tenants with no
      module installed, and the module only adds commerce.
- [ ] **D.5 Decide whether edition limits are a real boundary.** (S)
    - Every feather and route is installed in every edition, so a Standard
      tenant can call Professional routes directly. **Absorbs 5.6.**
    - Decide: enforce server-side, or document editions as cosmetic.
    - Done when: the decision is recorded, and enforced if that is the answer.

## Tier E: Multi-node readiness

The pub/sub design is already sound: `$subscription` is a table and the
triggers run `pg_notify(node.nodeid, …)` (`scripts/tables.js` ~20–135), so the
database fans each change out to exactly the nodes that care. Sessions, record
locks and advisory locks are all already database-backed. These are the gaps.

- [ ] **E.1 Claim scheduled jobs.** (M)
    - Cron runs in process per node (`f.cronJobs` in
      `cron-job/initialize-cron-job.js`) with no leader election, so N nodes
      fire every job N times.
    - Claim with `FOR UPDATE SKIP LOCKED`, or hold a leader lease.
    - Done when: two nodes run the same schedule and each job executes once.
- [ ] **E.2 Store WebAuthn challenges.** (S)
    - Covered by C.1; listed here because it is a multi-node blocker in its own
      right. A registration begun on one node and finished on another fails today.
- [ ] **E.3 Session strategy.** (M)
    - `$session` is in the control-plane database with `resave: true` and
      `rolling: true` (`server.js` ~2349), so **every request on every tenant
      writes a row in the control plane.**
    - Do `resave: false` immediately — it is improvement-plan 4.4 and strictly
      better. Then choose: move `$session` into the tenant database keyed by
      identity, or go to a stateless signed cookie. ADR §5 recommends the
      former, for the better failure mode: no new sign-ins, rather than
      everything down.
    - Done when: a control-plane outage leaves signed-in users working.
- [ ] **E.4 Pool sizing and a connection proxy.** (M)
    - `pgMaxConnections` is ignored; each tenant gets 10, one held permanently
      for LISTEN; each `f.datasource.lock` takes 2 more. Per node it is
      (tenants + 1) × 10, so the budget multiplies by node count.
    - Honor the setting, lower the per-tenant maximum, set `idleTimeoutMillis`,
      end pools for idle tenants, put PgBouncer in front. Fix the SSL config
      the code comment flags. **Absorbs 5.1.**
    - Done when: a documented tenant count per node fits inside
      `max_connections` with headroom.
- [ ] **E.5 Survive a rejected promise, and drop per-process guards.** (M)
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

- [ ] **F.1 Two-organization isolation test.** (M)
    - Create a user in organization B with an organization A username; confirm
      B cannot set A's password, cannot sign in to A's databases, and gains no
      authorization in them. This is the test item 1.1 always needed.
- [ ] **F.2 Consultant test.** (S)
    - One person with identities in two organizations. Confirm separate
      credentials, that each organization's administrator sees and controls
      only their own, and that revoking one leaves the other working.
- [ ] **F.3 Multi-node test.** (M)
    - Two Node processes against the same databases. Confirm locks and
      subscriptions survive a restart of either, each cron job fires once, a
      passkey flow completes across nodes, and provisioning cannot run twice.
- [ ] **F.4 Migration rehearsal.** (M)
    - Migrate a copy of `demo`, run the full 699-test suite against it, confirm
      every existing password still works, then exercise the rollback.

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

## 9. Proposed: one mode, and the instance manager

*Proposed 2026-10-10. Not settled — the open questions at the end need
answers, and no tier above has been renumbered yet.*

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
