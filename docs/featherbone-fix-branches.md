> Copied from the Featherbone Claude project into the repo on 2026-10-06.
> Update 2026-10-06: the local checkout is now `Documents/featherbone` (a fresh
> clone of `jrogelstad/featherbone`); the old `Documents/Featherbone` folder,
> including `claude-branches/`, was deleted. `fix/test-battery` is merged (PR
> #125), so nothing from that folder needed recovering.

# Featherbone fix branches: how they're delivered, and status

Read this together with `featherbone-review-handover.md`. Started 2026-10-01.

## Delivery

- **Update 2026-10-08: pushing from the cloud works now.** Attaching `FeatherboneJS/Featherbone` to the session with push access (the add-repo step) lets the session push branches directly. Clone it shallow, branch from `master`, commit as `jrogelstad <john@rogelstad.net>` with the Co-Authored-By trailer, push `fix/<item>`, and John opens the PR. One branch per plan item. The bundle workflow below is no longer needed.
- **Still true:** no git on John's laptop from a linked session, and writing into his `.git` is refused. `jrogelstad/SupplyChain` is private and was *not* reachable with the session's GitHub credential on 2026-10-08.
- **Old workflow (obsolete):** bundles plus `fetch-branches.sh --push`, written to `Documents/Featherbone/claude-branches/`.

## Cloud test environment (rebuild notes)

- **Postgres:** the cluster is Postgres 16 (`/usr/lib/postgresql/16/bin`). Run `initdb` as the `postgres` user, auth md5. Because of PG15+ public-schema permissions, before `node install.js` run `ALTER SCHEMA public OWNER TO admin; ALTER DATABASE demo OWNER TO admin; ALTER ROLE admin CREATEDB CREATEROLE`.
- **SupplyChain** is a private repo (`jrogelstad/SupplyChain`). Rebuild it by staging the `.git` pack from `Documents/SupplyChain`. Install `17aabed`, not HEAD `9de2417`: that commit fails with "Relation feather Product required by InventoryValueDetail not found". Install by zipping the folder and POSTing it to `/demo/module/install/x=1` as `admin`/`password`.
- **An ordinary test user no longer needs Job Shop.** `test/api/lib/access.js` `createUser` falls back to `Contact` where there is no `Employee` feather, so the settings, workbooks, authorization and security suites run against a framework-only database. The full battery there fails 503 tests (639 before the 0.4 branch); the rest need Job Shop and SupplyChain.
- **Cloud Postgres, 2026-10-09:** `admin` was given SUPERUSER so the harness's `pg_dump | pg_restore` fallback can replay `GRANT SELECT ON pg_authid`, which it hits whenever the server holds a connection to `demo` and `CREATE DATABASE ... TEMPLATE` is therefore refused. Local Postgres does not need this.
- **Driving the client headless:** Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with `playwright-core`; sign in at `http://localhost:3003/demo/` and collect console errors and failed requests. Two pre-existing console errors show up for every user on master: `TypeError: Cannot read properties of undefined (reading 'selected')` at `client/main.js:513`, and the Mithril `removeChild` `NotFoundError`.
- **These docs keep reverting on the laptop (twice on 2026-10-09).** They are tracked in the repo, so a pull, merge or checkout restores the committed version over edits made from a session. The Claude project copies under `claude/` are the ones to trust; commit the docs on the laptop if the local copy is to survive.
- **Job Shop:** without it, five snapshot tests fail (`catalog-routes`, `catalog-settings-definition`, `catalog-workbooks`, `settings-definitions`, `workbooks-catalog`). Never regenerate those from the cloud database.

- **Cloud Postgres, as rebuilt 2026-10-08:** the `postgres` user cannot traverse the scratchpad under `/tmp`, so put the cluster in `/var/lib/pgtest` (initdb with `--pwfile`, start with `pg_ctl`, use absolute paths because `su` resets PATH). Create `admin` (LOGIN CREATEDB CREATEROLE) and database `demo`, run `CREATE EXTENSION pgcrypto`, `ALTER SCHEMA public OWNER TO admin` and `GRANT SELECT ON pg_authid TO admin`, copy `server/config.template.json` to `server/config.json` (set `pgCryptoKey`, `secret`, `clientPort` 3003), then `node install.js`. `Kind`, `Category`, `Location` and `Contact` are framework feathers; `Terms`, `Employee` and the authorization and query suites' `before` hooks need SupplyChain and Job Shop.
- **Test runner:** `node test/run.js api/query` runs one file; adding the word `integration` first runs everything. Unit tests need only `server/config.json` and `npm ci --ignore-scripts`.
- **SupplyChain rebuild from the staged pack was blocked** by the session's permission classifier on 2026-10-08 (not retried). Needs John's go-ahead or repo access.

## Findings

- **John's `demo` grants `everyone` full CRUD** on `role`, `user_account`, `feather`, `script`, `module`, `route`, `form` and others. A fresh install gives read access on `role` only. Flagged to John; not changed.

## Status

| Branch | Plan item | State |
| --- | --- | --- |
| `fix/test-battery` (df4ec01) | Tier 0: battery green after UI refresh and on upgraded DBs | Merged (PR #125, 2026-10-06) |
| `fix/0.9-common-helpers` | 0.9 | Merged |
| `fix/0.8-client-statecharts` | 0.8 | Merged |
| `fix/0.7-null-handling` | 0.7 | Merged; the query and authorization suites could not run in the cloud (need Terms/Employee), so check them locally |
| `fix/0.5-currency-conversion` | 0.5 | Merged |
| `fix/0.6-profile-settings-workbooks` | 0.6 | Merged; settings and workbooks API suites could not run in the cloud, check locally |
| `fix/a2-node-identity` | Tenant plan A.2 | Merged |
| `fix/1.2-webhook-fail-closed` | 1.2 | Merged |
| `fix/1.3-no-body-logging` | 1.3 | Merged |
| `fix/1.7-default-secrets` | 1.7 | Merged; anyone with a template-copied `config.json` must set `secret` and `pgCryptoKey` |
| (reporter fix) | Test output | Merged; summary of failing tests now prints above the totals |
| (ribbon tests) | Unit tests | Merged; updated for the ribbon and Icon Park icons |
| (button label fix) | Bug | Merged; `button.js` builds fresh label vnodes (fixed the "Newew" label and dead Add button); regression tests added |
| `fix/0.2-bad-relation-id` | 0.2 | Merged |
| `fix/0.3-unauthenticated-endpoints` | 0.3 | Merged |
| `fix/1.8-crypto-key-param` | 1.8 | Merged |
| `fix/0.4-authorization-gaps` | 0.4 | Merged, two commits. **Reinstalling the Core module is part of the fix** -- it rewrites the `$auth` grants. Tightens permissions on an existing database; check ordinary users afterwards. The second commit adds per-settings-row authorization, set from a workbook's permissions (`canUpdateSettings`). Raised 0.12, 0.13 and 0.14 |
| `fix/bootstrap-authorizations` | — | Merged. `node install.js` against a brand new database fails on master ("Role \"everyone\" not found"): 0.4 declared the `everyone` grants in `feathers-bootstrap.json`, which installs before populate.js creates the role row. A declared grant whose role is missing is now skipped, and the manifest's second pass applies it |
| `feat/a1-control-plane` | Tenant plan A.1 | Merged (PRs #152–#154). Explicit control plane: `controlPlane` config block, `serverRole`, a `"$db"` marker, control-plane feathers in their own file, install targets, `mode` moved into the database, and README coverage. **Partly superseded the same week** by the single-mode decision in tenant-plan section 9: `serverRole`, `both`, the `controlPlane` block and `split-control-plane.js` are being removed again; the `"$db"` marker, the mode move and manifest `target` stay |
| `docs/branch-status` | — | Doc only: this table, brought up to date |
| `feat/a3-identity-model` | Tenant plan A.3 | Merged. `Organization`, `Identity`, `AccessGrant`, `AdminAudit`, an optional `organization` on `Tenant`, and the per-organization username constraint item 1.1 needs. `Tenant` to `Instance` deferred to D.4: the Admin Console module references it from another repository |
| `fix/catalog-golden-sentinels` | Test defect | Pushed 2026-10-10. The catalog signature rendered `numeric(-1,-1)` on every number or integer property with no declared precision, because the -1 sentinel was neutralised only for non-numeric types. Pre-dates A.3 -- the same 18 lines appear on master without it. **After merging, regenerate the catalog and workbooks goldens on a full install**, which also captures the `min=0 max=0` installer defaults the golden lacks for SupplyChain numerics |
| | Catalog data drift | `Container.container` and `SalesHistory.invoice` are relation properties carrying precision 18 scale 8, which is meaningless. Nothing declares them, so the feather editor wrote them -- probably on a type change that left the old numeric settings behind. Clean the rows and check `client/models/feather.js`; money is an `object` property that legitimately carries precision, so the test cannot simply ignore non-numeric precision |
| | Tenant plan, one mode | **Next.** Collapse `serverRole` and the `controlPlane` block into a single multi-instance mode with a `db_manager` default, per tenant-plan section 9. Blocked until `install` can build a manager plus a registered instance, because the integration harness clones one database and starts a server against it |
| | 0.1, 0.11 | After the above, one branch each (0.1 and the role-resolution part of 0.4 move to the tenant plan) |
| | 0.10 | SupplyChain repo; later |

## Notes from 2026-10-06 (checkout rebuilt)

- Fresh clone of `jrogelstad/featherbone` at master `920dee6`; `FeatherboneJS/Featherbone` master is the same plus one merge commit (#179). All branches on the org repo (`refactor`, `fresh_ui`, `test_suite`, `fix/test-battery`) are contained in master.
- `package.json` and `package-lock.json` were restored to master after an `npm audit fix --force` style update downgraded `pdfjs` to 0.5.4 (no `pdfjs/font/*`), which stopped the server starting. Do not use `--force` updates.
- `npm run test:unit`: 271 pass, 0 fail, 1 skipped, 16 todo (known defects, tests 0.8 and 0.9 in the plan).
- New default test reporter `test/harness/reporter.js` hides todo tests from the trailing "failing tests" block so the summary is last; `FB_TEST_REPORTER=spec` restores stock output.
- `server/config.json` is local and git-ignored: `clientPort` 3003 (browse `http://localhost:3003/demo/`), and `pgCryptoKey` must match the key `demo` was encrypted with.
