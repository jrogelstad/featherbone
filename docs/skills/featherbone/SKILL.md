---
name: featherbone
description: Orientation, working conventions and doc map for John's Featherbone project (the JS/Postgres feather-based framework, plus SupplyChain, Job Shop, Admin Console, CronJob). Use for ANY Featherbone work - code review, fix branches, the improvement plan, tenant/identity rework (ADR 001), UI refresh and ribbon, Job Shop help file, regression tests, the featherbone-postgres connector, or questions about how Featherbone or its apps work - even if the user just says "the framework" or "the refactor".
---

# Featherbone: project hub

Featherbone is a JavaScript persistence framework for object-relational database apps (Node + Postgres, Mithril client, GPLv3, essentially one maintainer: John Rogelstad). This skill is the map: what the pieces are, where the authoritative docs live, how John wants work done, and the traps that have already cost time. It deliberately does not copy the long plans; those are living docs and a copy would rot. Read the doc named for your task (section 3) before you act.

Featherbone is independent of the DCI web migration. Do not apply DCI conventions here and do not use the `dci-postgres` connector.

## 1. Architecture in one page

- **Feathers** are JSON class definitions that generate the schema. Every table inherits from an `object` base table (`_pk bigserial`, `id text UNIQUE`, `created`, `updated`, `is_deleted`, `lock`) via Postgres table inheritance. Each feather gets a generated read view `_<table>` plus insert/update/delete triggers.
- **Relation columns** are named `_<key>_<relation>_pk`. Views expand relations with correlated subqueries (to-one: scalar subselect; to-many: `ARRAY(SELECT ...)`). Consequences already measured: no indexes or FKs on relation columns, and view *planning* (75-150 ms) dominates execution (1-9 ms).
- **Natural keys** are meant to be unique but are only plain indexes; on inheritance hierarchies the index sits on the empty parent table only.
- **Authorization** is application logic: `$auth` rows plus `Role`/`RoleMembership`, checked in `tools.js`, `feathers.js`, `workbooks.js`. Today users are cluster-wide Postgres LOGIN roles and membership is answered by `pg_has_role()`; every real query runs as the tenant's service account (`TenantService.pgUser`). This is the root of the tenancy problem (section 5).
- **Multi-tenant**: one Node server, one database and one `pg.Pool` per tenant. The `Tenant`, `TenantService`, `Edition`, `ServerProcess`, `Notice` and `SendMail` feathers are Core and live in the system database (`config.pgDatabase`). `$session` also lives there.
- **Modules** (SupplyChain, Job Shop, Admin Console, CronJob) are zip packages with a `manifest.json`, installed through the client's Develop workbook or the server's `/module/install` route. `installer.js` accepts only `install`, `execute`, `module`, `service`, `feather`, `batch`, `workbook`, `settings`; anything else rolls back with "Unknown type". Module client code (Design, Plan, Make, Bill ...) is stored in the database and run with `new Function`, not read from the repo.
- **Client**: Mithril 2, Pure CSS, statechart library (`client/state.js`), components registered in a catalog (`f.catalog()`), shared via `catalog.register("global", ...)`. Component files do not import each other; follow the catalog pattern. `index_debug.html` loads unbundled source and `config.json` has `debug: true`, which makes `server.js` serve it. `client/clientmin.js` is a bundle that is not regenerated: never edit it.
- **Lint** is JSLint (`client/jslint.mjs`); keep touched files clean. Docs are YUIDoc comments.
- Large files: `crud.js`, `datasource.js`, `server.js`, `client/components/table-widget.js` (2.5-3k lines each).
- Money columns use the `mono` type. Installing SupplyChain via `node install.js --dir` creates them as `json` (plan defect 0.11); install through `/module/install` instead.

## 2. The landscape

| Thing | Where |
| --- | --- |
| Framework checkout | `/home/john/Documents/featherbone` (**lowercase f**; the old `Documents/Featherbone` was deleted and a capital-F path silently resolves to nothing). Clone of `jrogelstad/featherbone`; org repo is `FeatherboneJS/Featherbone`, branch `master`. |
| SupplyChain | `/home/john/Documents/SupplyChain` (private repo `jrogelstad/SupplyChain`; not reachable with the session's GitHub credential on 2026-10-08). Install commit `17aabed`, not HEAD `9de2417` (fails: "Relation feather Product required by InventoryValueDetail not found"). 122 feathers; folders bill, buy, common, count, design, make, plan, project, sell, ship, ship-engine, stock. |
| Job Shop, Admin Console, CronJob | zips in `/home/john/Documents/Featherbone-apps` (Job Shop is essentially Featherbone plus a navigation menu and edition configuration; Admin Console manages tenants). Job Shop help work is in `Featherbone-apps/jobshop-help/`. |
| ddom | `/home/john/Documents/ddom`: John's other app, the **visual reference** for the Featherbone UI refresh. |
| Live data | Postgres on 5432. Database `demo` is the main one (also `ddom`, `demo_dci`, `featherbone_llc`, `scheduling`; `featherbone_llc` may be the Admin Console system database). Reach it only through the **`featherbone-postgres`** connector: read-only, every query in a READ ONLY transaction. Never write to `demo`. |
| Run it | `http://localhost:3003/demo/` (the trailing database name is required; bare `/` errors with "Deserialize user function requires a tenant"). Default login `admin`/`password`. |
| Config | `server/config.json` is local and git-ignored; copy from `config.template.json`. `secret` and `pgCryptoKey` must be set (blank refuses to start). `pgCryptoKey` must match the key `demo` was encrypted with; a wrong key shows as silent "Wrong key or corrupt data" at read time and there is no rotation path. |
| Versions | Framework 2.2.0, Postgres 14 target (the cloud test cluster is 16). The README still says Node 16, which is end of life; the test suite needs Node 18+. |

## 3. Which doc to read for which task

The repo's `docs/` folder is the **source of truth** and is newer than the Claude project copies under `claude/` (fix-branches, improvement plan, ADR, tenant plan and UI-refresh status in the project are all older). Read from the repo: stage `/home/john/Documents/featherbone/docs/<file>`.

| Task | Read |
| --- | --- |
| Starting cold, what has been done, access, Phase 1 findings | `docs/featherbone-review-handover.md` |
| Apps, `demo` evidence, SupplyChain and Admin Console findings, revised priorities | `docs/featherbone-review-phase2.md` |
| Picking the next fix; what is done; file:line and done-when per item | `docs/featherbone-improvement-plan.md` (Tiers 0-6). Living, tickable original: claude.ai artifact `0360df5d-d8ec-4a95-a4af-93d9d5dcbcbb` (the repo export is rev 12 with a 2026-10-09 progress note; confirm which is newer before relying on either). |
| Branch/PR delivery, cloud test-environment rebuild, branch status table | `docs/featherbone-fix-branches.md` |
| Anything touching identity, sign-in, users, roles, tenants, sessions | `docs/adr-001-identity-and-tenancy.md` then `docs/tenant-management-plan.md`; `docs/scram-verify.js` is the proof for password migration |
| Styling, dark mode, grids, toolbars | `docs/featherbone-ui-refresh-status.md` |
| Ribbon / horizontal menu, Home tab, connection banner | project doc `claude/featherbone-ribbon-experiment.md` (**not in the repo yet**) |
| Job Shop help file, help links, scraping featherbone.com | project doc `claude/jobshop-help-file.md` and `Featherbone-apps/jobshop-help/README.md` |
| Running or writing tests | `test/README.md` in the repo |

Line numbers in the review docs refer to framework commit `867c146`; master has since gained tests, the UI refresh and fixes, and server code moved a little. Re-locate before editing.

## 4. How John wants the work done

- **One branch per plan item, commit and push, so each becomes its own PR for John to review.** Branch names follow `fix/<item>` (for example `fix/1.8-crypto-key-param`). John opens the PRs.
- **Cloud push works (since 2026-10-08)** by attaching `FeatherboneJS/Featherbone` to the session with push access (the add-repo step). Clone shallow, branch from `master`, commit as `jrogelstad <john@rogelstad.net>` with the commit trailer the session's attribution instructions give, push. The older note "GitHub push is blocked, don't chase it" in the UI-refresh doc is obsolete.
- **Local checkout delivery** (UI work, anything not going through GitHub): John's machine has no git reachable from a linked session, and writes into his `.git` are refused. If an `mcp__remote-devices__device_bash` tool is present, edit in place. Otherwise stage fresh copies, edit in the cloud, copy finals to a **fresh unique path** under `/mnt/user-data/outputs/` (for example `.../v/<timestamp>/...`), then `device_commit_files` with `expectedMtimeMs`. Reusing a staged path re-sends the stale first copy and reports "written" while the disk is unchanged. Re-stage and byte-diff after every commit. John branches and commits himself in this mode.
- The session's `/mnt/user-data/uploads/featherbone` cache is only what past sessions happened to stage; it is not a mirror. Stage fresh before trusting any file, and stage John's current copy and compare before overwriting in case he edited it.
- Keep Featherbone separate from other projects (separate connector, separate folders).
- Never run `npm audit fix --force`: it downgraded `pdfjs` to 0.5.4 (no `pdfjs/font/*`) and the server stopped starting. Take dependency bumps one at a time with `npm test` after each.
- Never cache-bust static files with a query string (`featherbone.css?v=...`): John's dev server returns an HTML 500. Use `await fetch(path, {cache: "reload"})` then `location.reload()`.
- Say plainly what was and was not run. Several fixes had suites that could not run in the cloud (they need Terms/Employee from SupplyChain and Job Shop); record "check locally" on those, as the fix-branches table does.
- The repo `docs/` have been kept current by annotating finished items in the improvement plan (`*Done: branch, date. ...*`) and updating the fix-branches status table; follow that style when you finish an item.

## 5. Current state (snapshot 2026-10-09; verify against `fix-branches.md`)

**Merged to master:** regression suite and `fix/test-battery` (PR #125); UI refresh (PR #124, `fresh_ui`); plan items 0.5, 0.6, 0.7, 0.8, 0.9, 1.2, 1.3, 1.7; tenant plan A.2 (per-process node identity); test reporter fix; ribbon component tests; button label fix.
**Pushed, PR to open (2026-10-09):** `fix/0.2-bad-relation-id`, `fix/0.3-unauthenticated-endpoints`, `fix/1.8-crypto-key-param` (its `security` suite needs Job Shop, check locally).
**Next:** 0.1, 0.4, 0.11, one branch each (0.1 and parts of 0.3/0.4 move into the tenant plan). 0.10 is in the SupplyChain repo, later.
**Open from the review:** still-unfixed security items 1.4 (`createDatabase` drop-on-failure), 1.5 (zip2tax path traversal); all of Tier 2 (tax rounding, mid-transaction `COMMIT`s, double posting, cost totals, allocation drift, natural-key uniqueness, ShipEngine label voiding) and Tier 3 (index every relation column, item/site composites, child-table natural-key indexes, framework DDL). Tier 2 and 3 are live money and scaling defects and do **not** wait for the tenancy rework.
**Not yet done by anyone:** a full `npm test` run on John's own machine against his real `demo`; production-scale timings; Admin Console and CronJob tests; the two-organization isolation test (needs a writable scratch cluster, never `demo`).
**Standing finding:** John's `demo` grants `everyone` full CRUD on `role`, `user_account`, `feather`, `script`, `module`, `route`, `form` and more (a fresh install gives read on `role` only). Flagged, not changed.

### Tenancy and identity rework (ADR 001, status proposed, rev 2)

Item 1.1 (one tenant's admin can reset another tenant's user's password via shared cluster roles) has no band-aid; it gates improvement-plan Tier 1. The design: a first-class **tenant management database** ("control plane") answers who you are, which organization you belong to and whether you may enter a database; each tenant database answers what you may do inside (`$auth`, `Role`, `RoleMembership` stay per tenant). Identity is **scoped to an organization** (a consultant has one identity per customer). Three admin tiers: platform administrator (Featherbone LLC, an identity flag, audited break-glass), organization administrator (sets and resets passwords, grants tenant access), tenant roles (`user_account.is_super` is renamed "tenant super user" in docs: unrestricted only within its own database). Passwords move into Node (scrypt/argon2id); existing SCRAM verifiers are verified offline and re-hashed on first sign-in, so nobody resets (needs a superuser connection once per cluster). `pg_has_role()` is replaced by a recursive CTE at six call sites. Work is sequenced in `tenant-management-plan.md` Tiers A-F; A.5 is the correct interim fix for 1.1. Open questions: HA topology for the control plane, session strategy (`resave: false` now; then per-tenant `$session` or signed cookie), password hashing choice, a per-tenant `everyone` equivalent, service accounts/API tokens, org-scoped email flows.

## 6. Testing

- `npm test` (about 5 minutes) = unit then integration; `npm run test:unit` needs no database; `node test/run.js api/query` runs one file; `node test/run.js integration` runs only the HTTP suites. Layout: `test/unit`, `test/api`, `test/supplychain`, `test/golden`, `test/harness`.
- Integration clones `FB_TEST_SOURCE_DB` (default `demo`) with `CREATE DATABASE ... TEMPLATE`, starts a server on port 3990 against the copy, and drops it afterwards; falls back to `pg_dump | pg_restore` if `demo` has live connections. It creates and drops cluster-wide login roles `fbtest_admin` and `fbtest_basic`.
- **`todo` tests** assert the *correct* behavior of a known defect, tagged `plan N.N` or `defect:`. They do not fail the run and start passing when the defect is fixed; then remove the `todo` option. Skipped tests are ones that cannot run safely in a shared server. A plain failure means behavior changed.
- Unit golden files for components were generated from upstream `867c146`; legitimate UI changes mean `FB_UPDATE_GOLDEN=1 node test/run.js unit` after reviewing the diff. Never regenerate the five catalog/workbook snapshots (`catalog-routes`, `catalog-settings-definition`, `catalog-workbooks`, `settings-definitions`, `workbooks-catalog`) from a cloud database; they need Job Shop installed.
- Last recorded unit run: 271 pass, 0 fail, 1 skipped, 16 todo. Original full suite: 699 tests, 608 pass, 89 todo, 2 skipped.
- Product POSTs need every child array present (`sites`, `conversions`, `documents`, `suppliers`, `billOfMaterialItems`, `operations`). `POST /data/user-account` is broken (0.1), so the harness creates users in SQL.

### Rebuilding the cloud test environment (what worked on 2026-10-08)

Postgres 16 in `/var/lib/pgtest` (the `postgres` user cannot traverse the scratchpad under `/tmp`; `initdb --pwfile`, `pg_ctl`, absolute paths because `su` resets PATH). Create `admin` (LOGIN CREATEDB CREATEROLE) and database `demo`; `CREATE EXTENSION pgcrypto`; `ALTER SCHEMA public OWNER TO admin`; `ALTER DATABASE demo OWNER TO admin`; `GRANT SELECT ON pg_authid TO admin`; copy `config.template.json` to `config.json` (set `pgCryptoKey`, `secret`, `clientPort` 3003); `node install.js`. Install SupplyChain `17aabed` by zipping the folder and POSTing it to `/demo/module/install/x=1` as `admin`/`password`; rebuilding it needs the `.git` pack staged from John's machine, which the permission classifier blocked on 2026-10-08 (needs John's go-ahead or repo access). `Kind`, `Category`, `Location`, `Contact` are framework feathers; `Terms`, `Employee` and the authorization/query suites need SupplyChain and Job Shop.

## 7. UI work (refresh and ribbon)

- **ddom is the reference. Measure it, do not guess.** ddom runs at `http://localhost:8081`; its CSS is `Documents/ddom/public/css/app.css`. It calls `window.prompt()` on startup, which the built-in browser cannot do: set `localStorage.cp_display_name` first. Pull computed styles with `javascript_tool`. John's feedback after the big pass: "Much, much closer", then "Looks like you got it" - he wants consistency with ddom everywhere, not per-symptom patches.
- Fix things centrally in core components where possible; module screens come from database-stored code (find it with POST `/demo/data/modules`), so editing module records is a last resort. Example: white buttons in dark mode were fixed in `button.js` `buttonStyle()` instead of 17 module edits.
- Screenshot caveats: when the Claude app window is covered, screenshots time out and Mithril redraws stall (requestAnimationFrame stops); call `m.redraw.sync()` before measuring. For small details, clone elements into a fixed overlay with `zoom: 3`. html2canvas misdraws sticky headers, range inputs and input baselines; trust JS measurements for those.
- Do not toggle a workbook's edit mode casually: the Edit button saves the sheet profile. Test inline editing in child grids in forms, which are always in edit mode.
- Past root causes worth remembering: a global `* { box-sizing: border-box }` (upstream has none) ate ~26px per grid column; the grid is now one table in one scroll box with sticky `thead`/`tfoot`; the relation menu in `relation-widget.js` `positionMenu()` is measured against the grid's scroll box.
- **Ribbon (branch `ribbon`, cut from master)**: vertical navigator replaced by a horizontal ribbon (`client/components/ribbon.js`); worksheet tabs became ribbon buttons; Home is a hard-coded exclusive tab (Accounts, Workbooks groups); category tabs come from `WORKBOOK_CATEGORIES` in `ribbon.js` keyed by route spelling `name.toSpinalCase()`; contextual groups Worksheets, Actions, Manage, Workbook, Record, List. `homeRibbonGroups()` and `homeDialogs` are registered globally so workbook pages can build the Home tab. A ddom-style connection banner (`client/connection-monitor.js`, `GET /api/ping` in `server.js`) wraps `m.request` and replaced three stacking blocking dialogs. **Never screenshot-verified**: John tests live and reports in words; sign in once in the built-in browser pane and screenshot. Open: category assignments beyond John's two moves are a proposal, where Global Settings belongs, form-page tabs untouched.
- Open UI follow-ups: sheet tabs location, home-page right-hand order, CodeMirror dark theme.

## 8. Apps and review facts you will be asked about

- **SupplyChain**: money and inventory defects are real and ranked in Phase 2 section 3 and plan Tier 2 (tax rounded to whole units at `bill/do-create-shipment-invoice.js`, mid-transaction `COMMIT`s, status read before lock in posting functions, three divergent backflush/cost copies, allocation drift, paid labels orphaned on rollback, zip2tax path traversal, unhandled rejections that can crash the whole multi-tenant server). Request fan-out figures (300-500 statements to ship a 20-line order) are estimates from reading code, not measurements.
- **Admin Console**: tenant creation clones a template database and runs `doConfigureJobShop`; WooCommerce orders arrive as `Notice` records via a webhook (now fail-closed). Provisioning is not atomic (orphan databases), the tenant registry leaks pools, and default pools of 10 mean ~8 tenants can exhaust a 100-connection Postgres. Edition limits (Standard/Professional/Enterprise) are cosmetic: every feather and route is installed in every edition.
- **Job Shop 2.3.0 help**: 197 topics (159 documented, 38 stubs), all 82 worksheets wired via `HelpLink` records (`sheet.helpLink` relation; `workbook-page.js` opens `link.resource`). The HTML cannot ride in the module zip, so it deploys to `featherbone/public/help/` (served by `express.static("public")`, database-independent). 22 articles are unwritten on featherbone.com, so the Report and Settings workbooks open to stubs - writing them is the top follow-up. `navigationCategory` (a manifest type in 2.3.0) exists only in John's local work, not on GitHub `master` or `fresh_ui`. For scraping featherbone.com: `curl` is blocked and **WebFetch paraphrases (never use it for verbatim text)**; use the browser pane's `get_page_text` in a dedicated tab, check the returned URL against the slug, and take titles from the sidebar, not the `<h1>`.
- **Other threads John has stated**: a Featherbone Finance module is in design (GAAP, works with or without SupplyChain; segmented chart of accounts with reporting trees, GL plus AP/AR subledgers, transaction-plus-base currency with revaluation, multiple entities with consolidation). SaaS deployments are on NodeChef, which he wants to leave (Postgres support stops at 13, looks unmaintained) for an actively managed PaaS with no Docker/VM packaging and autoscaling for Node.js and Postgres.

## 9. Known drift between sources

- Project copies under `claude/` are older than the repo `docs/`; the repo wins. `claude/featherbone-ribbon-experiment.md` and `claude/jobshop-help-file.md` have no repo counterpart yet.
- Phase 2 describes the local checkout as an empty `refactor` branch at `867c146`; it is now a clone at master `920dee6` plus later work. Phase 1/2 "no tests, no CI" was true at `867c146` only.
- The UI-refresh doc says pushes are blocked and its paths say `Documents/Featherbone`; both are obsolete (section 4, section 2).
- The project copy of the handover says the test suite is "not yet committed or pushed"; it is merged (the repo copy is correct).
- Todo counts in the improvement plan's Tier 0 table were not recalculated after fixes.
- The ribbon doc says no `device_bash` existed in those sessions; check the current tool list rather than assuming either way.
