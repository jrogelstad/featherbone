# Tenant Management and Identity — Rework Plan

Started 2026-10-07. The design this implements is `adr-001-identity-and-tenancy.md`.
When this plan is done, work returns to `featherbone-improvement-plan.md`,
whose Tier 1 is gated by it. Section 7 lists what that plan loses to this one.

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

- [ ] **A.1 Make the tenant management database explicit.** (M)
    - Today it is whatever `config.pgDatabase` names, reached by requests
      passing `tenant: false` and acting as `systemUser` (`server.js` ~293).
    - Add a `controlPlane` configuration block distinct from tenant service
      connections. Have the framework boot in a declared role: control plane,
      tenant server, or both.
    - Give it its own bootstrap and schema version, separate from a tenant
      database's, so one can never be mistaken for the other.
    - Done when: a tenant server starts with no control-plane tables of its
      own, and the control plane starts with no tenant application modules.
- [ ] **A.2 Per-process node identity, and scope the restart cleanup.** (S)
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
- [ ] **A.3 Control-plane feathers.** (M)
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
      Six call sites: `tools.js` ~200 and ~221, `workbooks.js` ~165 and ~255,
      `feathers.js` ~1016, `scripts/services.js` ~1350.
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
