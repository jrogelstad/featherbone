> Copied from the Featherbone Claude project into the repo on 2026-10-06. The
> local checkout is now `Documents/featherbone` (the old `Documents/Featherbone`
> folder was deleted; the test suite, UI refresh and `fix/test-battery` are all
> on GitHub master). Other docs referenced below live alongside this one in
> `docs/`.

# Featherbone Review — Handover

Start here. This doc is the entry point for any conversation picking up the Featherbone work; it says what was done, where everything lives, and what is open.

## Where everything is

| What | Where |
| --- | --- |
| This handover (status, access, Phase 1 findings) | `docs/featherbone-review-handover.md` |
| Phase 2 findings: apps, local copy, `demo` database, evidence and priorities | `docs/featherbone-review-phase2.md` |
| Improvement plan: the work-through checklist, Tiers 0–6, ~50 items with file:line and done-when | Living doc, editable and tickable: https://claude.ai/code/artifact/0360df5d-d8ec-4a95-a4af-93d9d5dcbcbb. Markdown export as of 2026-09-27 (rev 12): `docs/featherbone-improvement-plan.md`. The living doc is the source of truth; refresh the export if it drifts. |
| **Architecture decision: identity, tenancy, tenant management database, multi-node** | `docs/adr-001-identity-and-tenancy.md` (rev 2, 2026-10-07). Reframes item 1.1. Settles the two administration tiers, organization-scoped identity, and the tenant management database as part of the framework. |
| **Rework plan for the above** | `docs/tenant-management-plan.md`. Tiers A–F. **Gates improvement-plan Tier 1**; Tiers 2 and 3 of that plan do not wait. |
| UI refresh thread (separate work: ddom styling, dark mode) | `docs/featherbone-ui-refresh-status.md` |
| Fix branches: delivery method and status | `docs/featherbone-fix-branches.md` |
| Regression test suite, 699 tests | `test/` in this repo; `test/README.md` and the Tests section of the repo `README.md` explain it. Merged to master (PR #125 and earlier). |

## Goal

Evaluate code quality and performance of the Featherbone framework. Then check how the real apps built on it extend or change those findings:

- **SupplyChain** (`Documents/SupplyChain`)
- **Job Shop** (`Documents/Featherbone-apps`): essentially Featherbone plus a navigation menu
- **Admin console** (`Documents/Featherbone-apps`): manages the multi-tenant setup. Each Featherbone instance has its own database, and one Node server serves all tenants.
- **Local Featherbone copy** (`Documents/featherbone`): check whether it differs from GitHub
- **Live data:** Postgres on port 5432, database `demo`

## Status

- **Phase 1, the public framework repo: done.** The findings are below.
- **Phase 2: done on 2026-09-27.** It covered SupplyChain, Job Shop, Admin Console, CronJob, the local copy, and the live `demo` database. The findings are in **`docs/featherbone-review-phase2.md`**, which also has the revised combined priority list.
- **Phase 3, regression test suite: done on 2026-09-27.** 699 tests under `test/` (unit, framework API, SupplyChain flows), 608 pass, 89 todo (known defects asserting the correct behavior), 2 skipped, 0 fail, about five minutes for a full run with `npm test`. `test/README.md` explains the runner and layout. The **Featherbone Improvement Plan** living doc (`https://claude.ai/code/artifact/0360df5d-d8ec-4a95-a4af-93d9d5dcbcbb`) is the work-through checklist; its Tier 0 lists the suite and the extra defects it found.
- **Still open:** timings with production-scale data, the Admin Console and CronJob flows (no tests yet), and the two-tenant role test on a real second tenant (the suite covers the role-clobbering half in `api/users.test.js`).
- **Current direction (2026-10-07):** item 1.1 became an architecture question. The design is `docs/adr-001-identity-and-tenancy.md` and the sequenced work is `docs/tenant-management-plan.md`. Improvement-plan Tiers 2 and 3 proceed in parallel.
- **Not yet done by anyone:** running the full `npm test` (integration) on John's own machine against his real `demo` and confirming it is green; starting on Tier 1 of the plan.

### Interaction with the UI refresh thread

A separate conversation (2026-09-28, see `docs/featherbone-ui-refresh-status.md`) rewrote client components in the same checkout: `button.js`, `table-widget.js`, `relation-widget.js`, a new `toolbar.js`, the CSS and `index.html`. The test suite's component golden files (`test/golden/unit-component-*.json`) were generated from upstream `867c146`, so `npm run test:unit` would report golden differences for the restyled components (button at least). That was fixed by `fix/test-battery` (merged). The API and SupplyChain tests don't touch the client and are unaffected. Also from that thread: GitHub pushes from the cloud are blocked and John doesn't want that chased; deliver by writing files into his checkout, using a fresh staged path per commit.

The Phase 2 headlines are:

- **Relation columns:** `demo` has 364 relation columns with 0 indexes and 0 foreign keys.
- **Natural-key indexes:** none are unique, and on inheritance hierarchies they exist only on the empty parent tables.
- **Planning cost:** view planning takes 75–150 ms per query, against 1–9 ms to execute.
- **Shared role namespace:** all tenants share one Postgres role namespace, which allows cross-tenant password resets.
- **Webhook:** it fails open when no secret is configured.
- **Logging:** the superuser password is logged by generic module routes.
- **SupplyChain money and inventory bugs:** tax is rounded to whole units, `COMMIT` is issued mid-transaction, and there are double-posting races.
- **Local Featherbone copy:** a fresh clone of `867c146` on an empty `refactor` branch. Only its config differs from GitHub.

### Test suite facts a future session needs

- The suite clones the source database (`FB_TEST_SOURCE_DB`, default `demo`) with `CREATE DATABASE ... TEMPLATE`, so it needs no live connections on `demo` (it falls back to `pg_dump | pg_restore` if there are). It creates cluster-wide login roles `fbtest_admin` and `fbtest_basic` and drops them afterwards.
- The suite was developed against a **cloud rebuild of `demo`** (Featherbone core + SupplyChain `17aabed`/2.1.9a + Job Shop 2.1.9, no business data), since the connector to John's `demo` is read-only. Every test builds its own `RT-` prefixed data, so it should pass on the real `demo` too; that is the first thing to confirm on his machine (`npm test`).
- Install SupplyChain into a fresh database through the server's `/module/install` route (zip upload), not `node install.js --dir`: the CLI path creates money columns as `json` instead of `mono` (defect 0.11 in the plan).
- Product POSTs need every child array present (`sites`, `conversions`, `documents`, `suppliers`, `billOfMaterialItems`, `operations`); `POST /data/user-account` is broken (defect 0.1), so the harness creates users in SQL (`test/harness/db.js createUser`).

### Access (set up in Phase 2)

- **`featherbone-postgres`:** a local MCP connector in the Claude desktop config (`@modelcontextprotocol/server-postgres`). It connects to `postgresql://admin:…@127.0.0.1:5432/demo` and is read-only (every query runs in a READ ONLY transaction). Other databases on that cluster are `ddom`, `demo_dci`, `featherbone_llc` and `scheduling`.
- **`dci-postgres`:** a separate connector for the DCI project (9.4 at `172.17.0.2`). Keep the two separate.
- **No shell on the laptop:** this session had no shell on John's machine. The repos were read by staging their `.git` pack files into the cloud workspace, and the apps by staging their zip files.

## Phase 1 context

- **Repo reviewed:** https://github.com/FeatherboneJS/Featherbone at `master`, commit `867c146` (Feb 1, 2025). Package version 2.2.0 (the log mentions 2.19).
- **Developer docs** (`jrogelstad/featherbone-docs`) are YUIDoc output generated from the same code comments, so they add nothing new.
- **featherbone.com docs** are end-user help for Job Shop, not framework or developer docs.

## Framework profile

- About 55k lines of first-party JavaScript. Essentially a single maintainer (John Rogelstad). GPLv3.
- No tests and no CI (at `867c146`; the regression suite was added afterwards). Linted with JSLint, with workarounds such as `fs["readFileSync"]` to satisfy it.
- Documented with YUIDoc comments throughout, which is a strength.
- Several very large files: `crud.js`, `datasource.js`, `server.js`, and `client/components/table-widget.js`, each about 2.5–3k lines.
- Mixes `async/await` with `afterX = async function` callback chains, which makes insert and update flow hard to follow.
- The README targets Node 16, which is end-of-life. `npm audit --package-lock-only` reports 20 vulnerabilities (11 high), including `ws`.
- Architecture: "feathers" (JSON class definitions) generate the schema. Every table inherits from an `object` base table (`_pk bigserial`, `id text UNIQUE`, `created`, `updated`, `is_deleted`, `lock`) via Postgres table inheritance. Each feather gets a generated read view named `_<table>`, plus insert, update, and delete triggers.

## Findings

### Correctness and security

1. **Failed logins leak Postgres connections** (`server/database.js`, `authenticate()`). Every sign-in creates two new `Pool`s (`login1` and `login2`). All failure paths return before `client2.release()` and `login2.end()`, so each bad password strands a connection. This is also a denial-of-service vector against `max_connections`. `client2` also uses `conf.pgHost` instead of the tenant's host. Fix: use `try/finally` and reuse the service pool.
2. **Natural keys are not unique in the database** (`server/services/feathers.js`, around line 2233). `isNaturalKey` produces a plain `CREATE INDEX`, and uniqueness is enforced by a check-then-insert in `crud.js` (`afterUniqueCheck`), so concurrent inserts can race. The Job Shop glossary defines natural keys as unique, which confirms the intent. Fix: a partial unique index `WHERE NOT is_deleted`. *Phase 2: confirmed in `demo`. On inheritance hierarchies the index exists only on the empty parent table.*
3. **`isIndexed` on relation properties targets the wrong column.** The index uses `key.toSnakeCase()`, but relation columns are named `_<key>_<relation>_pk` (`tools.relationColumn`). This was traced in the DDL path but not run. *Phase 2: SupplyChain never sets `isIndexed` on a relation, so the bug is latent.*
4. **Encryption key concatenated into SQL** (`crud.doSelect`): `pgp_sym_decrypt(col, '<key>')` is built as a string, so the key can appear in logs and `pg_stat_activity`. `settings.js` does the same operation correctly with `$2`. *Phase 2: role passwords (`ALTER ROLE … PASSWORD %L`) have the same problem.*
5. **Authorization defaults to open in `doSelect`:** `isSuperUser = isSuperUser !== false`. The HTTP path (`datasource.request`) coerces the flag to a Boolean, so normal requests are safe. Internal callers that omit the flag bypass authorization.
6. **Tenant pools** (`database.connect`) ignore `pgMaxConnections`. The author's own comment on the SSL config says "Doesn't look right."

### Performance

1. **No index and no foreign key on relation columns.** This is the biggest issue. Generated views use correlated subqueries per row: `ARRAY(SELECT … WHERE child._parent_pk = parent._pk)` for to-many relations and scalar subselects for to-one relations. Without an index on the child foreign-key column, every parent row sequentially scans the child table. The likely hot spots in Job Shop are order lines, inventory transactions, and work order materials. *Phase 2: confirmed. `demo` has 364 unindexed relation columns, and the apps add none.*
2. **Relations are over-fetched.** `doSelect` strips dot notation and returns the whole related object through nested views, recursively. Partly by design: forms show the relation's natural key plus label fields (for example the supplier name, site description, and contact phone and email). Better fix: fetch the key plus the label fields rather than full recursive expansion. *Phase 2: to-one relations must declare a `properties` list, so expansion is bounded per level but compounds through nesting.*
3. **Per-request overhead** (`server.js`):
   - Sessions use `resave: true` and `rolling: true` with a Postgres store, so the session row is written on every request.
   - `deserializeUser` runs a database query, with its own pool checkout, on every request.
   - `rawBodySaver` stringifies every JSON body (limit 5 MB), although only webhooks need the raw body.
   - `urlencoded` is registered twice.
   - The net cost is roughly three extra database round trips per API call, against a default pool of 10.
4. Smaller items:
   - No `compression` middleware (`clientmin.js` is about 260 KB).
   - The table widget makes three sequential 20-row fetches on load (`FETCH_MAX = 3`).
   - Pagination uses `OFFSET`.
   - `getFeather` rebuilds the inheritance merge on every call, and `appendParent` mutates shared property objects by reference.
   - PDF generation re-fetches the logo over HTTP on every render.
   - Table inheritance means unique constraints don't span a hierarchy, and queries on parent feathers scan every child table.
5. *(Phase 2)* **Query planning dominates.** Queries are unnamed, so every request replans the huge views: 75–150 ms of planning against 1–9 ms of execution in `demo`. See the Phase 2 doc.

### Strengths

- Mostly parameterized SQL through pg-format `%I`/`%L`.
- The client requests only visible columns and pages its results.
- Advisory locks are used for updates.
- Thorough inline documentation.

### Suggested priority

This is superseded by section 5 of `docs/featherbone-review-phase2.md`. The Phase 1 order was:

1. Fix the login connection leak.
2. Index relation columns.
3. Make natural keys truly unique.
4. Parameterize the crypto key.
5. Reduce session and `deserializeUser` overhead.

## Relation to the DCI migration

Featherbone owns its schema: the `object` base table, inheritance, generated views, and triggers. It targets Postgres 14. It is not built to sit on top of an existing schema, so it doesn't fit DCI's plan to run the web app side by side with the Cocoa app on the existing Postgres 9.4 database. It would fit only if data were migrated into Featherbone's model. It is still a useful reference for Mithril patterns such as metadata-driven forms and lists.
