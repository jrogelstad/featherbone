# ADR 001 — Identity, tenancy and the control plane

Status: **proposed**, 2026-10-06. Author: John Rogelstad with Claude.
Supersedes the framing of plan item 1.1. Read with
`featherbone-improvement-plan.md` and `featherbone-review-phase2.md`.

This decision gates Tier 1. Items 1.1, 1.6, 1.8 and 0.1 are all symptoms of
the problem described here, and three of them disappear rather than get fixed.

## 1. Context

### What the design is actually trying to do

Requirements, as stated by John (2026-10-06):

1. One company may have several databases — typically a test and a production
   instance — and **the same user, with the same password, must work on all of
   them.** A user and their password are deliberately global.
2. **An administrator must be able to reset a user's password across all the
   databases that user can reach.**
3. One instance of Node must serve many databases, and spin up demos and new
   instances quickly.
4. A person may legitimately belong to **more than one customer** (a
   consultant, a reseller).
5. A customer's databases **may live on different Postgres instances**
   (`TenantService` already models host, port and credentials per service).
6. **SSO is on the roadmap.** Two-factor by email is already implemented.
7. Eventually, **several Node servers against the same databases** for load.
   Not near-term, but the design must not preclude it.

### What is actually implemented

Identity is the Postgres cluster's role namespace. A `UserAccount` is a
Postgres `LOGIN` role; sign-in works by opening a connection to the tenant
database as that role (`server/database.js` `authenticate()`); group
membership is answered by `pg_has_role()` against the per-database `$auth`
table.

Two facts make this much more tractable than it appears:

- **Postgres roles are not load-bearing for privileges.** Every real query
  runs as the service account from `TenantService.pgUser`. The doc comment on
  `authenticate()` says so outright: *"All actual client connections are
  handled by the service account."* No table or column privilege enforces
  anything. Authorization is already application logic — `$auth` plus
  `tools.js`, `feathers.js` and `workbooks.js`. Postgres roles do exactly two
  jobs: **store the password**, and **store group membership**.
- **The right model already exists, one level too low.** `Role`,
  `RoleMembership` and `UserAccount` are feathers in every tenant database
  (`scripts/feathers-bootstrap.json`). The schema is per-database; the
  identity behind it is per-cluster. Every bug in this class comes from that
  mismatch.

### Why item 1.1 has no quick fix

The audit's suggested quick fix — refuse to create a user whose role already
exists — **breaks requirement 1.** It is precisely the test-and-production
case. Conversely, today's behaviour (`server/services/role.js` ~205–232: if
the role exists, `ALTER ROLE … PASSWORD`) is what allows a Globex
administrator to set the password of an Acme user and then sign in as them.

The system cannot distinguish "the same Alice in acme_test and acme_prod" from
"two unrelated Alices at two customers", because **nothing records who owns a
username.** Both readings are identical in the data. So the smallest correct
fix for 1.1 already requires an ownership record above the database — there is
no band-aid, and that is the real reason this ADR exists.

### Consequences of the current design, beyond 1.1

- A passkey is a `WebauthnCredential` row **inside one tenant database**
  (`server/services/webauthn.js`), so a passkey registered in acme_prod does
  not work in acme_test. The same will be true of any MFA enrolment and of any
  SSO binding. Requirement 1 is already broken for everything except the
  password.
- Identity cannot span Postgres instances, because a cluster role cannot.
  Requirement 5 is unsatisfiable as built.
- The service account needs `CREATEROLE`, and role passwords are interpolated
  into SQL text (`ALTER ROLE %I PASSWORD %L`), which is the role half of item
  1.8.
- Every failed sign-in creates two connection pools and strands a connection
  (item 1.6).
- `everyone` is a single cluster-wide role shared by all customers
  (`scripts/populate.js`).

## 2. Decision

Introduce an explicit **control plane** and move authentication into the
application. Keep authorization where it already is.

> **Control plane answers "who are you, and may you enter this database?"
> The tenant database answers "what may you do once inside?"**

That split is the whole design. It keeps `$auth`, `Role` and `RoleMembership`
per tenant — which is correct and already works — and lifts only identity and
reachability to a single place that can span Postgres instances.

Postgres `LOGIN` roles stop being identity. Since they enforce no privileges
today, nothing about query behaviour changes.

### Why not the alternatives

- **Keep roles as identity, prefix group roles per organization.** Preserves
  SCRAM and the existing `pg_has_role()` queries, and is less work. Rejected:
  it still cannot span Postgres instances (requirement 5), still requires the
  ownership record, keeps the role-password SQL exposure, keeps the
  `CREATEROLE` grant, and leaves passkeys and SSO stuck per database.
- **One Postgres cluster per customer.** Clean isolation, but defeats
  requirement 3 and multiplies operations. Rejected.

## 3. The model

New tables, in the control-plane database. Today that database is implicit —
whatever `config.pgDatabase` names. It should become an explicit concept.

| Table | Holds | Notes |
| --- | --- | --- |
| `organization` | The customer or account | Owns tenants, edition, billing. New. |
| `identity` | **The person** | Globally unique username (email), `password_hash` (argon2id), status, lock state, sign-in attempts, `home_organization` (nullable). Deliberately *not* owned by an organization — see requirement 4. |
| `identity_credential` | WebAuthn passkeys | Moves up from the per-tenant `WebauthnCredential`. |
| `identity_federation` | SSO bindings | `(provider, issuer, subject) → identity`, plus per-organization IdP config. Serves requirement 6. |
| `access_grant` | **(identity, tenant) + status** | The reachability boundary. Per *tenant*, not per organization, so a consultant gets explicit grants to the specific databases they work in. |
| `tenant` | Existing Core feather | Gains an `organization` relation. |
| `tenant_service` | Existing Core feather | Already supports many hosts. |

In each tenant database, unchanged except as noted:

- `$auth` — unchanged. Authorization stays here.
- `role`, `role_membership` — kept, but as **application groups**. `isLogin`
  is deprecated and no Postgres role is created.
- `user_account` — becomes the **local profile** for a granted identity:
  preferences, contact, and a stable key for `created_by` / `updated_by` and
  for relations that already point at it. It no longer owns the password.

### Authentication flow, after

1. `POST /:db/signin` with username and password.
2. Resolve the tenant; look up `identity` by username in the control plane.
3. Verify the password **in Node** (argon2id). No Postgres connection is
   opened as the user, so item 1.6 ceases to exist.
4. Require an active `access_grant` for (identity, this tenant), and an active
   tenant. **This is the cross-customer boundary.**
5. If two-factor is on, run the existing magic-link flow, or a passkey from
   `identity_credential`, or SSO via `identity_federation`.
6. Session into `$session` as today, carrying the same `database` claim, so
   `maxSessions` and everything downstream keep working unchanged.

### Password reset: resolving requirements 2 and 4

These two requirements conflict, and the resolution is the most important
judgement in this document. A global password plus "any admin may reset it"
means an Acme administrator can take over a consultant's Globex access.

The rule:

- An administrator **may set or reset** the password of an identity whose
  grants are **all within that administrator's own organization**. This is the
  ordinary case and satisfies requirement 2 exactly: one `UPDATE` on
  `identity`, effective across that company's test and production databases at
  once.
- If the identity holds **any grant outside** that organization, the
  administrator **may not set a password.** They may suspend or revoke their
  own organization's grants, and may trigger a self-service reset link sent to
  the identity's verified address. The administrator never sets or learns the
  credential.
- `identity.home_organization` records the common case explicitly, so the
  check is cheap and the intent is auditable.

### Authorization change

Replace `pg_has_role($user, pg_authid.oid, 'member')` with a recursive CTE
over `role` and `role_membership` in the tenant database. Call sites:

- `server/services/tools.js` ~200 and ~221
- `server/services/workbooks.js` ~165 and ~255
- `server/services/feathers.js` ~1016
- `scripts/services.js` ~1350 (`SELECT rolname FROM pg_roles WHERE NOT rolcanlogin`)

This is the bulk of the mechanical work, and it is contained. `$auth` rows and
their semantics do not change.

## 4. Migration

**Existing passwords carry over with no reset.** Verified in this session
against a scratch Postgres 16 cluster: a `SCRAM-SHA-256` verifier read from
`pg_authid.rolpassword` can be checked offline in Node with
`crypto.pbkdf2Sync` plus two HMACs — derive `SaltedPassword`, then
`StoredKey = SHA256(HMAC(SaltedPassword, "Client Key"))` and compare. The
correct password matched and near-miss passwords did not.

So the plan is: copy each verifier into `identity`, verify against it at
sign-in, and transparently re-hash to argon2id on the first successful sign-in.
No user is forced to change a password.

Two constraints found while testing:

- The export **requires a superuser connection.** A `CREATEROLE` service
  account is refused on `pg_authid`, and `pg_roles` masks the column as
  `********`. The provisioning flow already prompts for superuser credentials,
  so this fits, but it must be a deliberate one-time step per cluster.
- Verifiers are password-equivalent at rest. Treat the export as a secret,
  and drop the column once an identity has been re-hashed.

Phases, each shippable on its own:

- **Phase 0 — ownership.** Add `organization`; give `tenant` an organization;
  backfill one organization per existing customer; record which organization
  owns each existing username. **This alone makes 1.1 fixable**: reject
  `ALTER ROLE` when the existing role is not owned by the caller's
  organization, and allow it when it is. Requirement 1 keeps working.
- **Phase 1 — identity, dual-run.** Add `identity`, `access_grant`, and the
  verifier import. Sign-in checks the application hash first and falls back to
  the role-connect path, so the change is reversible. Backfill identities and
  grants from existing `user_account` rows. Fix 0.1 here, on the new path.
- **Phase 2 — cut over.** Replace the `pg_has_role()` call sites. Stop
  creating `LOGIN` roles. Remove `CREATEROLE` from the service account. Delete
  the role-password SQL, closing the role half of 1.8. Delete the login-pool
  path, closing 1.6.
- **Phase 3 — credentials follow the person.** Move `WebauthnCredential` to
  `identity_credential`; add `identity_federation` and per-organization SSO.
  This is where requirement 6 lands.
- **Phase 4 — tidy.** Remove `isLogin` and the dead role-management code in
  `server/services/role.js`.

Phase 0 is small and unblocks Tier 1 immediately. Phases 1 and 2 are the real
work. Phases 3 and 4 can wait.

## 5. Where tenancy should live

**Finding: tenancy is already about 80% in the framework, and the seam is
drawn in the wrong place.**

`Tenant`, `TenantService`, `Edition`, `ServerProcess`, `Notice` and `SendMail`
are all **Core** feathers (`scripts/feathers.json`). `createDatabase`,
`createTemplateDatabase`, `loadTenants` and `deleteDatabase` are all
`f.datasource.*` in the framework. The Admin Console module defines **no
feathers at all** — it is forms, workbooks, `triggers-tenant.js`, the
WooCommerce flow, and two four-line services that call straight into core.

So the framework holds the dangerous primitives with no guardrails, while the
module holds orchestration that is entirely generic. Proposed seam:

- **Core owns the control plane:** identity, organizations, the tenant
  registry, provisioning as a resumable state machine (plan item 5.3), job
  scheduling, and a guarded API over database create/clone/delete. "Create a
  tenant" becomes one safe framework call rather than a trigger that runs
  `CREATE DATABASE` inside a transaction.
- **The module keeps only business policy:** the WooCommerce webhook, and the
  edition and pricing rules. Those are Featherbone LLC's commerce decisions,
  not framework concerns.

This also fixes a current hazard: provisioning primitives are callable from
module code with no guardrail, which is how item 1.4 (drop-on-failure in
`createDatabase`) became reachable.

## 6. Multiple Node servers

The data plane is closer to ready than expected, because most shared state is
already in Postgres.

**Already multi-node safe:**

- **Sessions** — `$session` in the control-plane database, so `maxSessions`
  counts correctly across nodes (`server.js` ~2150–2200, ~2349).
- **Record locks** — the `object.lock` column, which carries `nodeid`.
- **Advisory locks** — Postgres-side, so cluster-wide by construction.
- **Change notification** — the good part of the design. `$subscription` is a
  table, and the insert/update/delete triggers run
  `SELECT DISTINCT nodeid FROM "$subscription" … PERFORM pg_notify(node.nodeid, payload)`
  (`scripts/tables.js` ~20–135), so the database fans each change out to
  exactly the nodes that care. Cache invalidation for feathers, catalog and
  routes rides on this.

**Blockers, in priority order:**

1. **`nodeId` is a static config value** (`"node1"` in `server/config.json`).
   Two nodes from one config share a NOTIFY channel, and startup runs
   `datasource.unlock()` and `datasource.unsubscribe()` scoped by `nodeId`
   (`server.js` ~311–314) — so **a second node booting wipes the first node's
   live record locks and subscriptions.** It needs a per-process identity
   registered at startup (host plus pid, or a row in a `node` table with a
   lease), not a configured constant.
2. **`cleanupProcesses()` has no `nodeId` filter at all**
   (`server/datasource.js` ~512): any restart marks every in-flight
   `server_process` row as "Stopped by server restart", on every tenant. It
   also loops on `tenants[0]`, so it only ever touches the first tenant.
3. **Cron runs in process, per node** (`f.cronJobs` in
   `cron-job/initialize-cron-job.js`), with no leader election or job claim.
   N nodes means every scheduled job fires N times. Needs claiming with
   `FOR UPDATE SKIP LOCKED`, or a leader lease.
4. **WebAuthn challenges are in process memory** (`let challenges = {}` in
   `server/services/webauthn.js`). A registration or authentication begun on
   one node and completed on another fails. Challenges must be stored, with a
   short expiry — naturally alongside `identity_credential` in the control
   plane.
5. **Connections multiply by node count** — (tenants + 1) × 10 per node, with
   `pgMaxConnections` currently ignored. PgBouncer becomes mandatory rather
   than advisable. See plan items 5.1 and 5.2.

Items 5.2 (registry leaks) and 6.2 (per-process `pending` guards in
SupplyChain) also get worse with more nodes.

Blockers 1 and 2 are small, and worth doing early regardless: both are latent
bugs on a single node after a restart.

## 7. What this absorbs from the plan

| Plan item | Effect |
| --- | --- |
| 1.1 tenant user isolation | Solved by the model. Phase 0 is a correct partial fix. |
| 1.6 login connection leak | **Deleted.** No connection is opened as the user. |
| 1.8 secrets in SQL (role half) | **Deleted.** No `ALTER ROLE … PASSWORD`. The `pgp_sym_decrypt` half remains. |
| 0.1 `POST /data/user-account` fails | Fixed on the new path in Phase 1. |
| 0.3 / 0.4 sign-in and authorization leaks | The new sign-in path is where the error-message leaks get fixed. |
| 5.3 provisioning state machine | Becomes part of the control plane, and mandatory before multi-node. |

## 8. Open questions

- **Where does the control-plane database live** when tenants span several
  Postgres instances? It is a single point of failure for sign-in across all
  customers. Options: its own small highly-available instance, or replication.
- **Argon2id adds a dependency.** `node:crypto` has `scrypt` built in, which
  is adequate and keeps the dependency count at zero. Worth deciding
  deliberately.
- **Does an organization admin ever need to see that an identity has grants
  elsewhere?** The password rule depends on that fact, so an admin will
  observe it indirectly when a reset is refused. Decide how that is worded,
  since it leaks the existence of another customer relationship.
- **`everyone`** needs a per-tenant equivalent once it is no longer a cluster
  role. Probably an implicit group every granted identity belongs to.
- **Service accounts and API tokens** are not modelled at all today. If they
  are coming, they belong in the control plane next to `identity`.
