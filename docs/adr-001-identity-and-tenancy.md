# ADR 001 — Identity, tenancy and the tenant management database

Status: **proposed**, revised 2026-10-07 (rev 2). Author: John Rogelstad with Claude.
Supersedes the framing of plan item 1.1. The work it implies is sequenced in
`tenant-management-plan.md`. Read with `featherbone-improvement-plan.md` and
`featherbone-review-phase2.md`.

**Revision note (rev 2).** Rev 1 proposed a single global identity per person
and a rule restricting when an administrator could reset a password. John's
feedback established a two-tier administration model, which dissolves that
problem instead of managing it. Identity is now **scoped to an organization**
(§4), and the reset rule is gone. §3 and §5 are new.

## 1. Context

### What the design is trying to do

1. A company may have several databases — typically test and production — and
   **the same user, same password, must work on all of them.**
2. **An organization's own administrator must be able to set and reset
   passwords for users in their organization**, and is also the person who
   assigns authorization at the database level.
3. **A platform administrator** — Featherbone LLC — sits above all of it and
   can do anything an organization administrator can, so a customer who loses
   their administrator can have rights transferred and the old account
   blocked.
4. One Node instance must serve many databases, and spin up demos and new
   instances quickly.
5. A person may work for **more than one customer** (a consultant, a reseller).
6. A customer's databases **may live on different Postgres instances**.
7. **SSO is on the roadmap**, possibly per customer (Azure AD and similar).
   Two-factor by email already exists.
8. Eventually **several Node servers against the same databases.** Not
   near-term, but the design must not preclude it.

### What is actually implemented

Identity is the Postgres cluster's role namespace. A `UserAccount` is a
Postgres `LOGIN` role; sign-in opens a connection to the tenant database as
that role (`server/database.js` `authenticate()`); group membership is
answered by `pg_has_role()` against the per-database `$auth` table.

Three findings matter:

- **Postgres roles are not load-bearing for privileges.** Every real query
  runs as the service account from `TenantService.pgUser` — the doc comment on
  `authenticate()` says so: *"All actual client connections are handled by the
  service account."* No table or column privilege enforces anything;
  authorization is already application logic in `$auth`, `tools.js`,
  `feathers.js` and `workbooks.js`. Postgres roles do exactly two jobs: **store
  the password** and **store group membership**.
- **The right model already exists, one level too low.** `Role`,
  `RoleMembership` and `UserAccount` are feathers in every tenant database
  (`scripts/feathers-bootstrap.json`). The schema is per-database; the identity
  behind it is per-cluster. Every bug in this class comes from that mismatch.
- **There is no platform administrator today.** `isSuper` is read with
  `SELECT is_super FROM user_account` (`server/services/tools.js` ~631) — it is
  **per tenant database**. Requirement 3 has no representation in the model at
  all; in practice the platform administrator is whoever holds the Postgres
  superuser or `TenantService` credentials. That is the break-glass path, and
  it is unauditable.

### Why item 1.1 has no quick fix

The audit's suggested quick fix — refuse to create a user whose role already
exists — **breaks requirement 1.** It is exactly the test-and-production case.
Today's behaviour (`server/services/role.js` ~205–232: if the role exists,
`ALTER ROLE … PASSWORD`) is what lets one customer's administrator set another
customer's user password and then sign in as them.

Nothing records **who owns a username**, so "the same Alice in acme_test and
acme_prod" and "two unrelated Alices at two customers" are identical in the
data. The smallest correct fix already requires an ownership record above the
database. There is no band-aid, and that is why this ADR exists.

### Other consequences of the current design

- A passkey is a `WebauthnCredential` row **inside one tenant database**
  (`server/services/webauthn.js`), so a passkey registered in acme_prod does
  not work in acme_test. Requirement 1 is already broken for everything except
  the password, and will be for MFA enrolment and SSO bindings too.
- Identity cannot span Postgres instances, because a cluster role cannot.
  Requirement 6 is unsatisfiable as built.
- The service account needs `CREATEROLE`, and role passwords are interpolated
  into SQL text (`ALTER ROLE %I PASSWORD %L`) — the role half of item 1.8.
- Every failed sign-in creates two connection pools and strands a connection
  (item 1.6).
- `everyone` is one cluster-wide role shared by all customers
  (`scripts/populate.js`).

## 2. Decision

Make the **tenant management database** an explicit, first-class part of the
framework, and move authentication into the application. Keep authorization
where it already is.

> **The tenant management database answers "who are you, which organization do
> you belong to, and may you enter this database?" The tenant database answers
> "what may you do once inside?"**

That split is the whole design. `$auth`, `Role` and `RoleMembership` stay per
tenant — correct today and unchanged. Only identity, organization and
reachability move up, to a place that can span Postgres instances.

Postgres `LOGIN` roles stop being identity. Since they enforce no privileges
today, no query behaviour changes.

"Control plane" is used below as shorthand for the tenant management database
plus the framework services that own it.

### Why not the alternatives

- **Keep roles as identity, prefix group roles per organization.** Preserves
  SCRAM and the existing `pg_has_role()` queries, and is less work. Rejected:
  cannot span Postgres instances (requirement 6), still needs the ownership
  record, keeps the role-password SQL exposure and the `CREATEROLE` grant, and
  leaves passkeys and SSO stuck per database.
- **One Postgres cluster per customer.** Clean isolation, but defeats
  requirement 4 and multiplies operations. Rejected.

## 3. Administration model

Three distinct tiers. Today only the third exists.

| Tier | Who | Scope | Capabilities |
| --- | --- | --- | --- |
| **Platform administrator** | Featherbone LLC | All organizations, all tenants, the control plane | Create, suspend and delete organizations; create, clone and delete tenant databases; register `TenantService` entries; appoint an organization's first administrator; **break-glass**: suspend an organization administrator's identity and transfer their rights; read the audit log. Can do anything an organization administrator can. |
| **Organization administrator** | The customer's own owner or IT | One organization: its tenants and its identities | Create, suspend and delete identities in their organization; **set and reset their passwords**; grant and revoke access to their organization's tenants; assign roles within those tenants; configure the organization's authentication policy (password, SSO, MFA requirements). |
| **Tenant roles** | End users | One database | Whatever `$auth` and role membership grant on feathers, workbooks and rows. Includes today's `user_account.is_super`, which means "unrestricted *within this database*". |

Three points this settles:

- A platform administrator is **an identity in the control plane with a
  platform flag** — not a Postgres superuser and not `is_super` in some
  database. Break-glass stops being "whoever has the cluster password".
- `user_account.is_super` keeps its current meaning but is renamed in
  documentation to **tenant super user**, to stop it reading as a platform
  role. It grants nothing outside its own database.
- Every platform-administrator action taken **on a customer's behalf** —
  appointing an administrator, suspending an identity, transferring rights —
  writes an audit record in the control plane. This is the power that replaces
  the cluster superuser, so it must be reviewable.

## 4. The identity model

### Identity is scoped to an organization

`identity.organization` is **required**. A username is unique *within* an
organization, not globally.

A person who works for two customers has **two identities**, one per
organization. That is the deliberate choice, and it is what makes §3 work: an
organization administrator has unambiguous, total authority over every
identity in their organization, because no identity is shared with anyone
else. Requirement 2 is satisfied in full, with no conditions, and no
cross-customer takeover is representable.

Requirement 1 still works exactly as intended: one identity in organization
Acme, holding grants to `acme_test` and `acme_prod`. One password. An
administrator reset is one `UPDATE`, effective on both databases at once.

**Sign-in is never ambiguous**, which falls out of the existing URL scheme:
sign-in is always to a named database (`/:db/signin`), the database resolves to
a tenant, and the tenant resolves to exactly one organization. So the
organization is known before the username is looked up.

The cost is that a consultant maintains one credential per customer. Where
that matters, SSO removes it: the organization's identity rows become bindings
to an external issuer, and the consultant authenticates once at their own
identity provider. A `person` table above `identity`, linking a human's
accounts across organizations for convenience, is a possible later addition
and is **explicitly out of scope** — it would reintroduce the shared-credential
question that scoping identity just removed.

### Tables

In the tenant management database:

| Table | Holds | Notes |
| --- | --- | --- |
| `organization` | The customer or account | Owns tenants, edition, billing, authentication policy. New. |
| `identity` | **A person within one organization** | Required `organization`; username unique per organization; `password_hash`; status; lock state; sign-in attempts; `is_platform_admin`; `is_org_admin`. |
| `identity_credential` | WebAuthn passkeys, TOTP secrets | Moves up from the per-tenant `WebauthnCredential`. Also stores short-lived challenges, which today sit in process memory. |
| `identity_federation` | SSO bindings | `(provider, issuer, subject) → identity`, plus per-organization IdP configuration. Serves requirement 7. |
| `access_grant` | **(identity, tenant) + status** | The reachability boundary. Per tenant, so an organization can give a user production but not test. |
| `admin_audit` | Privileged actions | Who did what, to whom, when, and on whose behalf. |
| `tenant` | Existing Core feather | Gains an `organization` relation. |
| `tenant_service` | Existing Core feather | Already supports many hosts. |

In each tenant database, unchanged except as noted:

- `$auth` — unchanged. Authorization stays here.
- `role`, `role_membership` — kept, as **application groups**. `isLogin` is
  deprecated; no Postgres role is created.
- `user_account` — becomes the **local profile** of a granted identity:
  preferences, contact, and a stable key for `created_by` / `updated_by` and
  the relations that already point at it. It no longer owns the password.

### Authentication flow, after

1. `POST /:db/signin` with username and password.
2. Resolve database → tenant → organization.
3. Look up `identity` by (organization, username) in the control plane.
4. Apply the organization's authentication policy: local password, or redirect
   to its identity provider.
5. For a local password, verify **in Node** (scrypt or argon2id). No Postgres
   connection is opened as the user, so item 1.6 ceases to exist.
6. Require an active `access_grant` for (identity, this tenant), and an active
   tenant. **This is the access boundary.**
7. If MFA is required, run the existing magic-link flow, a passkey from
   `identity_credential`, or the IdP's own second factor.
8. Establish the session, carrying the same `database` claim as today, so
   `maxSessions` and everything downstream keep working.

### Authorization change

Replace `pg_has_role($user, pg_authid.oid, 'member')` with a recursive CTE
over `role` and `role_membership` in the tenant database. Call sites:

- `server/services/tools.js` ~200 and ~221
- `server/services/workbooks.js` ~165 and ~255
- `server/services/feathers.js` ~1016
- `scripts/services.js` ~1350 (`SELECT rolname FROM pg_roles WHERE NOT rolcanlogin`)

This is the bulk of the mechanical work, and it is contained. `$auth` rows and
their semantics do not change.

## 5. The tenant management database

Confirmed design constraints:

- **Exactly one per installation.** It is the authority for organizations,
  identities, grants and the tenant registry. Two would mean two answers to
  "who is this".
- **It may share a Postgres server with tenant databases, or have its own.**
  Nothing in the design assumes co-location.
- **It may be served by the same Node process as tenants, or a dedicated
  one.** The framework should boot in a declared role: control plane, tenant
  server, or both.
- **It is part of the framework, not an installable package.** Today the
  concept exists but is implicit: it is whatever `config.pgDatabase` names,
  reached by requests that pass `tenant: false` and act as `systemUser`
  (`server.js` ~293 and throughout). Make that explicit with its own
  configuration block and its own bootstrap, so a tenant database can never
  be mistaken for it.
- **It stores credentials only when Featherbone is the authority.** Password
  hashes, passkeys and TOTP secrets when the organization uses local
  authentication; only issuer and subject bindings when an external provider
  such as Azure AD is the authority. This is per-organization policy, which is
  the main reason it belongs in the control plane.

### The single-point-of-failure question

Making it the authority for sign-in across all customers concentrates risk. It
is a small database — organizations, identities, grants, tenants — so
replication or a managed highly-available instance is inexpensive. But there
is a sharper problem that needs a decision:

**`$session` lives in the control-plane database today, with `resave: true`
and `rolling: true`** (`server.js` ~2349). That means **every request against
every tenant writes a session row in the control plane.** It is not just a
sign-in dependency; it is a hot path for all traffic on all customers, and it
couples every tenant's availability to one database.

Options:

- **(a) `resave: false`, write only on change.** Cheap, strictly better, and
  already plan item 4.4. Does not remove the coupling.
- **(b) Move `$session` into the tenant database**, keyed by identity. A tenant
  then keeps serving already-signed-in users while the control plane is
  unreachable; only new sign-ins fail. It also makes the `maxSessions` query
  local, since that query already filters by database.
- **(c) Stateless signed session cookie** carrying identity, tenant and
  expiry, with a revocation list. Removes the per-request read entirely, at
  the cost of revocation complexity.

Recommendation: do (a) now regardless, and decide between (b) and (c) during
the rework. (b) is the smaller change and gives the better failure mode:
**degrade to "no new sign-ins" rather than "everything down".**

## 6. Where tenancy should live

**Tenancy is already about 80% in the framework, and the seam is drawn in the
wrong place.**

`Tenant`, `TenantService`, `Edition`, `ServerProcess`, `Notice` and `SendMail`
are all **Core** feathers (`scripts/feathers.json`). `createDatabase`,
`createTemplateDatabase`, `loadTenants` and `deleteDatabase` are all
`f.datasource.*` in the framework. The Admin Console module defines **no
feathers at all** — it is forms, workbooks, `triggers-tenant.js`, the
WooCommerce flow, and two four-line services that call straight into core.

So the framework holds the dangerous primitives with no guardrails, while the
module holds orchestration that is entirely generic. That is how item 1.4
(drop-on-failure in `createDatabase`) became reachable from module code.

- **Core owns the control plane:** organizations, identities, grants, the
  tenant registry, provisioning as a resumable state machine (plan item 5.3),
  job scheduling, and a guarded API over database create, clone and delete.
  Core also ships the administration UI, since the control plane is itself a
  Featherbone application — feathers, forms and workbooks — just a built-in
  one rather than an installed package.
- **The module keeps only business policy:** the WooCommerce webhook, and the
  edition and pricing rules. Those are Featherbone LLC commerce decisions, not
  framework concerns.

## 7. Migration

**Existing passwords carry over with no resets.** Verified in this session
against a scratch Postgres 16 cluster: a `SCRAM-SHA-256` verifier read from
`pg_authid.rolpassword` can be checked offline in Node with
`crypto.pbkdf2Sync` plus two HMACs — derive `SaltedPassword`, then
`StoredKey = SHA256(HMAC(SaltedPassword, "Client Key"))` and compare. The
correct password matched; near-miss passwords did not. The proof is
`docs/scram-verify.js`.

So: copy each verifier into `identity`, verify against it at sign-in, and
transparently re-hash to the application algorithm on the first successful
sign-in. Nobody is forced to change a password.

Two constraints found while testing:

- The export **requires a superuser connection.** A `CREATEROLE` service
  account is refused on `pg_authid`, and `pg_roles` masks the column as
  `********`. The provisioning flow already prompts for superuser credentials,
  so this fits, but it is a deliberate one-time step per cluster.
- Verifiers are password-equivalent at rest. Treat the export as a secret and
  drop the column once an identity has been re-hashed.

## 8. What this absorbs from the improvement plan

| Plan item | Effect |
| --- | --- |
| 1.1 tenant user isolation | Solved by the model. |
| 1.6 login connection leak | **Deleted.** No connection is opened as the user. |
| 1.8 secrets in SQL (role half) | **Deleted.** No `ALTER ROLE … PASSWORD`. The `pgp_sym_decrypt` half remains in the improvement plan. |
| 0.1 `POST /data/user-account` fails | Fixed on the new path. |
| 0.3 / 0.4 sign-in and authorization leaks | The new sign-in path is where the error-message leaks get fixed. |
| 1.4, 5.2, 5.3, 5.4 tenant lifecycle | Move into the control plane's provisioning work. |
| 4.4 per-request overhead | Overlaps the session decision in §5. |

## 9. Open questions

- **Highly-available topology for the control plane** — replication, or a
  managed instance.
- **Session strategy** — option (b) or (c) in §5.
- **Password hashing** — `node:crypto` `scrypt` keeps the dependency count at
  zero; argon2id needs a dependency. Decide deliberately.
- **`everyone`** needs a per-tenant equivalent once it is no longer a cluster
  role. Probably an implicit group every granted identity belongs to.
- **Service accounts and API tokens** are not modelled today. If they are
  coming, they belong next to `identity`.
- **Organization-scoped usernames and email collisions** — two organizations
  may each have `alice@consult.com`. Email-based flows (magic link, password
  reset) must therefore be scoped by organization, and a reset link must name
  the organization it applies to.
