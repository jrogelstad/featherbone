> Copied from the Featherbone Claude project into the repo on 2026-10-06. This
> is a markdown export (rev 12, 2026-09-27); the living, tickable doc is the
> source of truth:
> https://claude.ai/code/artifact/0360df5d-d8ec-4a95-a4af-93d9d5dcbcbb
> Line numbers refer to framework `867c146`; master has since gained the
> regression suite, the UI refresh and test fixes (server code is unchanged).

# Featherbone Improvement Plan

> **2026-10-07 — Tier 1 is gated.** Item 1.1 turned out to be an architecture
> problem, not a bug: see `adr-001-identity-and-tenancy.md`. The rework has its
> own plan, `tenant-management-plan.md`, and absorbs or deletes 1.1, 1.4, 1.6,
> 1.8 (role half), 0.1, 5.1–5.6, 6.1 and 6.2. Items below are annotated
> **[→ tenant-management-plan]** where they moved.
>
> **Tier 2 and Tier 3 do not wait for that work.** They touch neither identity
> nor the control plane, and they are live money and scaling defects. Start
> there, alongside items 1.2, 1.3, 1.5 and 1.7, which also stand on their own.

**Progress 2026-10-09:** Tier 0 items 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8 and 0.9 and Tier 1 items 1.2, 1.3, 1.7 and 1.8 are fixed (all merged except 0.4, which is pushed). Also merged: tenant plan A.2, a test reporter fix, ribbon component tests and a button label fix (see `featherbone-fix-branches.md`). Todo counts in the table below are as of the suite's creation and are not recalculated.

As of 2026-09-27 · John · exported from the living doc (rev 12): https://claude.ai/code/artifact/0360df5d-d8ec-4a95-a4af-93d9d5dcbcbb

## Tier 0: Regression suite (done)

A regression suite now pins current behavior, so every item below can be checked as it is fixed. Run `npm test` in the Featherbone folder (about five minutes; `test/README.md` has the details).

| Area | Files | Tests | Pass | Todo (known defects) | Skipped |
| --- | --- | --- | --- | --- | --- |
| Unit: common helpers, statecharts, models, components | 9 | 288 | 271 | 16 | 1 |
| Framework API: auth, users, authorization, crud, query, locking, catalog, settings, workbooks, schema, security | 11 | 261 | 202 | 58 | 1 |
| SupplyChain flows: purchasing, inventory, count, design, manufacturing, sales, shipping, billing, planning | 9 | 150 | 135 | 15 | 0 |
| **Total** | 29 | 699 | 608 | 89 | 2 |

A todo test asserts the correct behavior for a known defect and is tagged with its plan item (`plan 2.3`) or `defect:`; it fails without failing the run, and starts passing when the defect is fixed. Items in this plan with a todo test: 1.2, 1.6, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 3.1.

Defects the suite found that are not in the tiers below (each has a todo test; file:line in the test's todo text):

- [ ] **0.1 `POST /data/user-account` always fails** **[→ tenant-management-plan B.5]** with 500 (`scripts/services.js:1357`, loop runs past the end of the roles list). Users can only be created in SQL today; also `POST /data/role` with an existing login role's name sets it NOLOGIN and blanks its password (`role.js:230`), the same class as 1.1.
- [x] **0.2 Server crash on a bad relation id:** a PATCH pointing a relation at a nonexistent id kills the server (`crud.js:2323`, unhandled promise). Skipped in the suite because it takes the shared server down; belongs with 6.1.
    - *Done: `fix/0.2-bad-relation-id`, 2026-10-09. `afterGetRelKey` in `crud.js` now throws instead of returning a rejected promise, so the request gets an error and the server stays up. The skipped test is enabled (uses Currency `displayUnit`).*
- [x] **0.3 Unauthenticated endpoints:** `GET /sessions` answers without sign-in and any user can disconnect any session; `/currency/base` without a session returns a 500 HTML stack trace; failed sign-in returns the raw Postgres error and the unknown-user message names the database.
    - *Done: `fix/0.3-unauthenticated-endpoints`, 2026-10-09. `currency` and `sessions` added to `check[]`; `/sessions` and `/do/disconnect` require a superuser (403) and disconnect is limited to the caller's database; sign-in errors use an allowlist with the generic "Invalid sign in credentials." for unknown users. Todo markers removed from `security.test.js` and `users.test.js`.*
- [x] **0.4 Authorization gaps:** any signed-in user can list all user accounts, read `smtpPassword` and `TenantService.pgPassword` decrypted, create or overwrite settings, and a read-only user can overwrite a workbook and its permissions (`workbooks.js:430`). Update and delete denials return 500 while create denials return 401.
    - *Done: `fix/0.4-authorization-gaps`, 2026-10-09. Six holes, each
      reachable by any signed-in user. `crud.js` update and delete denials
      now carry 401 like create. `settings.js` writes require a super user
      and encrypted properties are blanked on read for everyone else (the
      catalog saves itself through the same service, so those calls say
      `isInternal`). `workbooks.js` update requires `canUpdate`, and
      changing the permissions requires a super user; an unchanged
      authorization list is not treated as a change, because the client
      sends the whole workbook back when a user shares a layout.
      `scripts/services.js` no longer replaces an empty authorization list
      with everyone-everything on update -- the Core manifest installs the
      system feathers twice, so a plain install was granting every user
      full access to `user_account`, `role`, `script`, `feather` and
      `document`, and every module reinstall widened its feathers the same
      way. `server.js doQueryRequest` no longer runs Form, Module, Role and
      UserAccount queries as a super user; the install grants `everyone`
      read on them instead, which an administrator can revoke.
      TenantService and Tenant now declare no authorizations, closing the
      `pgPassword` read. Honorific, Contact and Role keep populate.js's
      grants, declared in the feather so a reinstall cannot drop them.*
    - *Follow-up in the same branch, 2026-10-09: super user turned out to be
      the right floor but too coarse a ceiling, so a settings row can now
      grant `canUpdate` to a role. Settings rows inherit `object`, so the
      grant is an ordinary `$auth` row like a workbook's, and
      `settings.settingIsAuthorized` answers for both the save and the
      encrypted-property mask -- whoever may change a secret may read it. A
      row nobody has been granted stays super users only, so nothing
      existing changes. The grant is set from a workbook's permissions as a
      third box, `canUpdateSettings`, beside Read and Update, and is stored
      against the settings row named by `launchConfig.settings` rather than
      against the workbook, so one settings row has one answer however many
      workbooks open it. New route `GET /settings/is-authorized/:name`; the
      settings page uses it to go read-only rather than letting an
      unauthorized user type and then fail. `settingIsAuthorized` is a
      seventh `pg_has_role` call site for tenant-plan B.3.*
    - *Existing databases converge on the next install of the module,
      which tightens permissions: check afterwards that ordinary users can
      still reach what they need.*
    - *Verified: full battery before and after, 639 failing tests on master
      against 503 on the branch, with no test failing that master passed
      (the rest need Job Shop and SupplyChain). Unit suite 293 pass. The
      client was driven headless as an ordinary user and a super user: same
      requests, no failures, same pre-existing console errors. The settings
      grant was exercised end to end against a live server: granted through
      a workbook, an ordinary user read the decrypted smtpPassword and
      saved globalSettings; cleared, the grant row was gone, the secret
      blanked and the save refused with 401.*
- [x] **0.5 Currency conversion inverts the rate** (`currency.js:331`, 10 becomes 40 instead of 2.5); same-currency conversion returns a string; the first `/currency/base` after start returns 500.
    - *Done: `fix/0.5-currency-conversion`, 2026-10-08. Conversion divides only when the from-currency is the base currency, otherwise multiplies; same-currency returns the amount; base-currency cache listener fixed (`events.js` tenant copy, receiver filter).*
- [x] **0.6 `PUT /profile` always 409** (`profile.js:111`); stale settings etags are accepted (`settings.js:228`); workbook update without module/isTemplate clears them; deleting a workbook leaves its permission rows.
    - *Done: `fix/0.6-profile-settings-workbooks`, 2026-10-08. Profile PUT accepts the etag envelope; stale settings etags rejected (client refreshes etag after PUT); workbook update keeps module/isTemplate and deleteWorkbook removes `$auth` rows. Settings and workbooks API suites could not run in the cloud; check locally.*
- [x] **0.7 Null handling:** null natural key or null filter value gives a 500 TypeError (`crud.js:48`); PATCH of a missing id gives 500 `"undefined" is not valid JSON` (`datasource.js:1501`); required strings are saved as `""`; `/do/is-authorized?id=<unknown>` never answers and holds a pooled connection (`feathers.js:1048`).
    - Fixed on `fix/0.7-null-handling` (2026-10-08): null filter values become IS NULL, PATCH of an unknown id answers not-found, an omitted required string is rejected, `/do/is-authorized` answers for an unknown id. Not covered: `{}` as a relation filter (todo test remains).
- [x] **0.8 Client model statecharts:** `model.save()` never settles when invalid or when called in Clean; a failed lock strands the model in Locking; a failed delete leaves it frozen; settings and workbook `doPut` have no catch (`.catch(model.error)` is undefined); `clear()` on a new record with child arrays overflows the stack; `list.subscribe(false)` and `list.inFilter` (`search()` at position 0) misbehave; `button.isPrimary()` always false and clears the flag when read.
    - Fixed on `fix/0.8-client-statecharts` (2026-10-08), including a re-entrancy bug in `client/state.js` that caused the `clear()` overflow. Settings still park in `/Error` after a failed save (pinned).
- [x] **0.9 Common helpers:** `(-5).pad(3)` gives `0-5`; `'_foo'.toCamelCase()` drops the first letter; `netWorkDays` mutates its Date arguments; money `toType` rounds the conversion ratio to the currency scale (ratio 0.001 becomes 0, division by zero).
    - Fixed on `fix/0.9-common-helpers` (2026-10-08).
- [ ] **0.10 SupplyChain:** `change-purchase-order-status` reads `ids[i]` so a single `id` gives 500; inbound move transactions have no `document`; a failed auto-post after save leaves no error on the record; `do-post-work-order-issue.js` rejects on-hold orders inside `try` without `await`, skipping error handling.
- [ ] **0.12 A new feather still defaults to everyone-everything.** On
  insert, a feather that declares no `authorizations` gets `everyone` full
  CRUD (`scripts/services.js` `defaultAuth`). 0.4 fixed the update path
  only, because application modules may rely on the insert default --
  changing it needs a pass over Job Shop and SupplyChain to see which of
  their feathers declare nothing. Candidates still open on a fresh install:
  `edition`, `server_process`, `notice`, `send_mail`, `comment`, `kind`,
  `layout`, `print_form`, `system_print_form`, `country`, `state`, `unit`
  and the currency feathers.
- [ ] **0.13 `POST /data/feather` crashes instead of refusing.** A
  non-super user gets 500 "Cannot read properties of undefined (reading
  'forEach')" from the Feather trigger, which runs before the create
  authorization check. The record is not created, so this is a 6.1-class
  unhandled error rather than a hole, but the denial should come first.
- [ ] **0.14 User accounts have no column-level authorization.** With 0.4
  in, `everyone` reads `user_account` because the client's user-name picker
  needs it, which also exposes `isSuper`, `isLocked`, `signInAttempts` and
  `lastSignIn` to every signed-in user. Narrowing it to names needs either
  column-level authorization or a dedicated name-list route.
- [ ] **0.15 A property's type and numeric settings cannot really be changed.**
  Longstanding, confirmed by John 2026-10-10. Changing a property's type, its
  precision or its scale leaves the old values behind: `Container.container`
  and `SalesHistory.invoice` are relations carrying precision 18 scale 8 in
  `demo`, which is meaningless, and neither `ship/feathers.json` nor
  `bill/feathers.json` declares them. Reinstalling the owning module did not
  clear it, although `updateCatalog` (`feathers.js` ~2330) assigns
  `catalog[name] = spec` outright, so some install path is not rewriting the
  feather it should. `client/models/feather.js` ~549 does reset scale,
  precision, min and max when the type changes, so the editor is not the
  whole story. Needed: find why a reinstall leaves the stale value, and give
  the catalog a way to drop a property setting rather than only add one.
  Until then a bad value has to be fixed with SQL against the `catalog`
  settings row. Caught by the catalog golden test, which had been silently
  failing -- see `fix/catalog-golden-sentinels`.
- [ ] **0.11 CLI install of SupplyChain** (`node install.js --dir`) creates money columns as `json` instead of `mono`; installing the same zip through the server's install route is correct.

## How to use this plan

Work top to bottom. Tier 0 is the regression suite, already in place; Tier 1 closes security holes and Tier 2 stops wrong money and inventory numbers; both come before any performance work. Each item names what to change, where, and how you'll know it's done.

| Tier | Theme | Items | Why this order |
| --- | --- | --- | --- |
| 1 | Security | 8 | Cross-tenant access and credential exposure in a multi-tenant server |
| 2 | Data correctness | 8 | Wrong tax, costs, inventory and allocations in live transactions |
| 3 | Indexes and schema | 5 | Biggest scaling risk; cheap to fix |
| 4 | Query and request performance | 5 | Dominant cost today (planning), then round trips |
| 5 | Tenant lifecycle and connections | 6 | Orphans, leaks and pool exhaustion as tenants grow |
| 6 | Resilience and code health | 6 | Makes the rest safer to change |

Scope: framework at `867c146` (your `refactor` branch), SupplyChain `9de2417` (2.2.0), Admin Console and Job Shop 2.1.9, CronJob 0.9.34, and the local `demo` database. Details and evidence for every item are in the docs `featherbone-review-handover.md` (Phase 1) and `featherbone-review-phase2.md`. Line numbers are approximate and refer to those versions.

## Tier 1: Security

The top item is tenant role isolation: one tenant's admin can reset another tenant's user password today. The rest are credential exposure and destructive failure paths.

- [ ] **1.1 Isolate tenant users from each other.** **[superseded → tenant-management-plan; partial fix at A.5]** Users are cluster-wide Postgres roles, and creating a `UserAccount` whose role already exists runs `ALTER ROLE … PASSWORD` on it.
    - Where: `scripts/services.js` `createRole`; `server/services/role.js` ~212–232; authorization via `pg_has_role()` in `tools.js`, `feathers.js`, `workbooks.js`.
    - Quick fix: refuse to create a user whose role exists but has no `user_account` row in this database.
    - Real fix: per-tenant role prefix, or app-level authentication and authorization, or one cluster per tenant. Decide before the refactor goes further; it shapes the auth model.
    - Done when: a two-tenant test shows tenant B cannot change or use tenant A's users or roles.
- [x] **1.2 Make the webhook fail closed.** With `webhookHeader` empty (the default), `hash` and `signature` are both `undefined` and the check passes.
    - *Done: `fix/1.2-webhook-fail-closed`, 2026-10-08. Rejects unless `webhookHeader` and `webhookSecret` are both set and the signature matches (`timingSafeEqual`); headers/hash no longer logged. The two todo tests are normal tests; positive-path (valid signature) is not covered by a test.*
    - Where: `server.js` `doNotice` (~1311).
    - Fix: reject when no secret is configured; compare with `crypto.timingSafeEqual`; stop logging all headers at verbose.
- [x] **1.3 Stop logging request bodies on module routes.** `postify` logs the full payload, so `/admin-console/create-template-database` writes the Postgres superuser password to the log.
    - *Done: `fix/1.3-no-body-logging`, 2026-10-08. All request-payload logs in `server.js` go through `loggable()` (tenant → db name, credential-like keys masked). Rotate the superuser password if the template-database route was ever used.*
    - Where: `server.js` `postify` (~375–392).
    - Fix: log route name and user only, or redact known secret fields as `doPostUserAccount` already does. Rotate the superuser password if this was ever used.
- [ ] **1.4 Remove drop-on-failure from `createDatabase`.** **[→ tenant-management-plan D.2]** If `CREATE DATABASE` fails because the name exists, the catch fires an un-awaited `DROP DATABASE IF EXISTS`.
    - Where: `server/datasource.js` ~332–400; duplicate check in Admin Console `triggers-tenant.js` runs before name normalization.
    - Fix: only drop a database this call created; check `pg_database` after normalizing the name; guard `conn2` in `finally`.
- [ ] **1.5 Close the Zip2Tax path traversal.** The file path comes from the client's `filename`, is read, then deleted.
    - Where: SupplyChain `sell/do-zip2tax-import.js:22,116`.
    - Fix: accept only an upload id or `path.basename`, resolve inside the upload folder, and verify it stays there.
- [ ] **1.6 Fix the login connection leak.** **[deleted by tenant-management-plan B.2 — no connection is opened as the user]** Each failed sign-in strands a pooled connection and creates two new pools.
    - Where: `server/database.js` `authenticate()` ~140–215.
    - Fix: `try/finally` release and end; reuse the service pool for the bookkeeping queries; use the tenant host, not `conf.pgHost`.
- [x] **1.7 Remove default secrets from the repo config.** `server/config.json` ships a `secret` and `pgCryptoKey`.
    - *Follow-up 2026-10-08: the old placeholder text now only logs a warning at startup instead of refusing, because databases already encrypted with the placeholder cannot be re-keyed. Blank or missing still refuses.*
    - *Done: `fix/1.7-default-secrets`, 2026-10-08. Template ships empty `secret`/`pgCryptoKey`; `server.js` and `install.js` refuse to start when empty or the old placeholder. Unit test `test/unit/config.test.js`.*
    - Fix: ship empty values and refuse to start until they are set. Document that `pgCryptoKey` cannot be changed on an existing database without re-encrypting (you just hit this).
    - Note (2026-10-06): `server/config.json` is now git-ignored and the repo ships `config.template.json`; the template still carries placeholder values and the server does not yet refuse to start with them.
- [x] **1.8 Take secrets out of SQL text.** **[role-password half deleted by tenant-management-plan B.4; the `pgp_sym_decrypt` half stays here]** The crypto key and role passwords are concatenated into statements, so they can show up in `pg_stat_activity` and server logs.
    - *Done (pgp_sym half): `fix/1.8-crypto-key-param`, 2026-10-09. `crud.js` binds the pgcrypto key as a query parameter for insert, update and select; with statement logging on, the key appeared 0 times against 35 before. Test in `security.test.js` enabled (skips if `pg_stat_activity` cannot see the queries). Tenant-service password exposure to ordinary users stays with 0.4.*
    - Where: `crud.js` `doSelect` (~1810, `pgp_sym_decrypt(col, '<key>')`); `role.js` `ALTER ROLE … PASSWORD %L` and `CREATE ROLE … PASSWORD %L`.
    - Fix: pass the key as a parameter as `settings.js` does; for role passwords, send a pre-hashed SCRAM secret or set `log_statement = none` for that session.

## Tier 2: Data correctness

These are SupplyChain bugs that change tax, cost, inventory and allocation figures, plus the framework's non-unique natural keys. Start with 2.1 and 2.2: they are small edits with large blast radius.

- [ ] **2.1 Remove mid-transaction `COMMIT`s.** Four services commit on the request's own client, often un-awaited, so later work runs in autocommit and rollback hooks and advisory locks are lost.
    - Where: `design/do-roll-up-costs.js:246`, `design/do-update-proposed-costs.js:39`, `sell/do-zip2tax-import.js:48` (also un-awaited `DELETE FROM tax_rate`), `plan/do-clear-allocations.js` (own `BEGIN`/`COMMIT`).
    - Fix: delete the `COMMIT`s and await the statements; if a subscription cleanup must be isolated, use a separate connection.
- [ ] **2.2 Round tax correctly.** `Math.round(ttl, 2)` ignores the second argument, so tax rounds to whole units.
    - Where: `bill/do-create-shipment-invoice.js:153`; unrounded line and discount amounts in `sell/triggers-sales-order.js` ~171–186.
    - Fix: `ttl.round(CURR_SCALE)` and round line amounts at the currency scale.
- [ ] **2.3 Lock before reading in posting functions.** Status is read before the lock, so two concurrent posts can both see status P and both post inventory.
    - Where: `buy/do-post-purchase-order-receipt.js` ~66–135, `make/do-post-work-order-receipts.js`, `make/do-post-work-order-issue.js`, `stock/do-post-inventory-adjustment.js`, `count/do-post-physical-count.js`; same pattern in `bill/do-apply-invoice-payment.js` and prepaid application in `do-create-shipment-invoice.js`.
    - Fix: claim the document atomically, e.g. `UPDATE … SET status = 'R' WHERE id = $1 AND status = 'P' RETURNING`, or lock then re-read.
- [ ] **2.4 Make actual-cost totals one shared calculation.** Three copies of backflush and cost logic accumulate totals differently; at least two double-count, and shipping never adds labor or overhead.
    - Where: WO receipts ~609–801, `make/post-operation-completion.js` ~254–439, `make/do-post-work-order-issue.js` ~161–398, `ship/do-ship-sales-order-shipment.js` ~361–375.
    - Fix: one helper where total = material + labor + overhead + service, used by all paths.
- [ ] **2.5 Fix allocation drift.** `inventory.allocated` and `supply.allocated` diverge from allocation rows; manual WO issue never relieves allocations.
    - Where: `plan/do-transact-allocated.js` ~427–540; `make/do-post-work-order-issue.js:269` compares to `"issue"` but the value is `"issued"`.
    - Fix: accumulate after the negative on-hand adjustment; subtract only what was actually deallocated; fix the string.
- [ ] **2.6 Make natural keys unique in the database.** Indexes are plain, and on hierarchies they sit on the empty parent table only.
    - Where: `server/services/feathers.js` `createIndex` (~2233); check-then-insert in `crud.js` `afterUniqueCheck`.
    - Fix: partial unique index `WHERE NOT is_deleted` per child table; for keys that must be unique across a hierarchy (Item, Demand, Supply), a shared key table or trigger, since Postgres can't enforce it across inherited tables.
- [ ] **2.7 Void ShipEngine labels on rollback.** Labels are bought over HTTP inside the ship transaction; the ids kept "in case of reject" are never voided.
    - Where: `ship/do-ship-sales-order-shipment.js` ~193–237, `do-ship-outside-process-shipments.js` ~121–165, `do-print-shipment-labels.js` ~81–91.
    - Fix: void in `client.onRollback`, or buy labels in a separate committed step keyed on the shipment.
- [ ] **2.8 Fix invoice, history and closure bugs.**
    - `bill/triggers-invoice.js` reads `ln.shipment` and `ln.unitPrice`, which don't exist, so sales history gets `shipmentLine` 0 and `unitPrice` null; several `number === object` comparisons never fire.
    - Prepayment loop in `do-create-shipment-invoice.js:171` never stops at zero balance.
    - `let del` outside loops writes history for the last allocation only: `make/triggers-work-order.js:68`, `buy/triggers-purchase-order.js:70`, `plan/triggers-planned-order.js:113`.
    - `buy/do-convert-planned-purchase.js:161` uses `d.ids[0]` every pass; PO receipt posting never resets `j`, skipping later receipts' lines.
    - Tax lookup in `sell/do-get-address-tax-rates.js` matches the city with an unanchored regex, `LIMIT 1` and no `ORDER BY`, so it can pick the wrong jurisdiction.

## Tier 3: Indexes and schema

In `demo`, all 364 relation columns across 127 tables have no index and no foreign key, and inherited indexes exist only on empty parent tables. Doing 3.1–3.3 as a migration per tenant database is fast; 3.4 stops the problem recurring.

- [ ] **3.1 Index every relation column.** Views run a correlated subquery per row on these columns, so every list page scans each child table once per parent row.
    - Run the generator below per tenant database, review the names (63-character truncation can collide), then apply with `CREATE INDEX CONCURRENTLY` on live data.
- [ ] **3.2 Add item/site composite indexes.** SupplyChain's raw SQL filters on `(_item_item_pk, _site_site_pk)` constantly.
    - Tables: every `demand` and `supply` child (`sales_order_line`, `work_order_requirement`, `sales_order_requirement`, `outside_process`, `purchase_order_line`, `work_order`, `inventory`, `planned_order` and its children), plus `inventory`, `item_site`, `inventory_transaction`.
    - Also: `allocation(_demand_demand_pk)`, `allocation(_supply_supply_pk)`, `product_bill_of_material_item(_product_product_pk)`, `tax_rate(zip_code)`.
- [ ] **3.3 Put natural-key and status indexes on child tables.** Today they index empty parents, so SupplyChain's only two `isIndexed` properties do nothing.
    - Missing on children of: `demand` (number, status), `supply` (number, status), `item`, `operation`, `invoice`, `receipt`, `shipment`, `container`, `resource_group`, `task`, `carrier`, `package_type`, `ship_method`, `unit`, `kind`, `layout`, `script`.
    - Also `user_account(name)`, the login lookup.
- [ ] **3.4 Change the framework DDL.** Make `feathers.js` create an index for every relation column and repeat inherited index and natural-key definitions on each child table when a feather is created or altered.
    - While there: fix `isIndexed` on relation properties, which indexes `key.toSnakeCase()` instead of the `_<key>_<relation>_pk` column.
- [ ] **3.5 Decide on foreign keys.** None exist today, so nothing stops orphaned relation values. Adding them is safe for non-inherited targets; relations to inherited feathers (Item, Demand, Supply, Contact) can't use a plain FK and need trigger checks or a key table.

Generator for 3.1 (read-only; it prints the statements):

```sql
SELECT format('CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I (%I);',
              left(c.relname || a.attname || '_idx', 63), c.relname, a.attname)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
  AND a.attname LIKE '\_%\_pk' AND a.attname <> '_pk' AND NOT a.attisdropped
  AND NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum);
```

## Tier 4: Query and request performance

At `demo` scale, planning is the dominant cost: 75–150 ms to plan a view query against 1–9 ms to run it. After that come round trips per request and per posted line.

| Query in `demo` | Rows | Planning | Execution |
| --- | --- | --- | --- |
| `_purchase_order` by id | 1 | 97 ms | 1 ms |
| `_purchase_order` all | 29 | 149 ms | 9 ms |
| `_work_order` first page | 19 | 77 ms | 9 ms |
| `_form` all | 104 | — | 172 ms |

- [ ] **4.1 Cache query plans.** The framework sends unnamed parameterized queries, so every request replans.
    - Fix: named prepared statements (`{name, text, values}` in `pg`) for stable `doSelect` shapes, so each connection caches the plan.
    - Done when: repeated form loads show planning near zero in `pg_stat_statements`.
- [ ] **4.2 Slim the generated views.** Each to-one relation to an inherited feather becomes an `Append` over every child table, nested up to 3 levels (24 subselects per `ShipmentInvoice` row).
    - Fix: a list view that expands only natural key and label fields; keep full expansion for single-record form loads; consider `LEFT JOIN LATERAL` over scalar subselects.
- [ ] **4.3 Cache form and catalog metadata in Node.** `form_attr_column` was scanned 3,044 times in a few minutes of use.
    - Fix: load forms once per tenant and invalidate on the existing change subscription.
- [ ] **4.4 Cut per-request overhead** (Phase 1). **[session half overlaps tenant-management-plan E.3]**
    - Session store: `resave: false`, and write only when the session changes.
    - Cache the deserialized user briefly instead of querying on every request.
    - Save the raw body only on the webhook route; remove the duplicate `urlencoded`; add `compression`.
- [ ] **4.5 Reduce SupplyChain request fan-out.** Rough estimates: 300–500 statements to ship a 20-line order, ~150 requests to post a 10-line PO receipt, 120–150 to explode a 3-level BOM.
    - De-duplicate `doRecalcInventoryOrders` by (item, site) and run once in `onCommit`.
    - Add `properties:` lists to heavy GETs (WorkOrder, Item, SalesOrder); fetch settings and base currency once per request.
    - Stop loading all of `ItemUnitConversion` per demand in `plan/do-plan-supply.js:73`.
    - Replace the tenant-wide `pg_advisory_xact_lock(1)` in explode and planning with a per-item or per-order lock.
    - Replace O(n²) `.find`/`.filter` loops in `design/do-roll-up-costs.js` with Maps.

## Tier 5: Tenant lifecycle and connections

At default settings, about 8 tenants on one Node server can exhaust Postgres's 100 connections, and failed provisioning leaves databases nobody can reprocess.

- [ ] **5.1 Size and close tenant pools.** **[→ tenant-management-plan E.4]** Each tenant gets a 10-connection pool (the `pgMaxConnections` setting is ignored), one held permanently for LISTEN; each sign-in opens 2 more pools; each SupplyChain `f.datasource.lock` takes 2 extra connections.
    - Fix: honor `pgMaxConnections`, lower the per-tenant max, set `idleTimeoutMillis`, end pools for idle tenants, and run PgBouncer in front. Fix the SSL config the code comment flags.
- [ ] **5.2 Fix the tenant registry leaks.** **[→ tenant-management-plan D.3]**
    - `deleteDatabase` calls `tenants.splice(idx, 0)`, which removes nothing (`server/datasource.js:438`).
    - `loadTenants()` only ever adds; deleted tenants keep their pool, listener and `pools[db]` entry.
    - `cleanupProcesses()` uses `tenants[0]` in its loop, so only the first tenant is cleaned after a restart (`datasource.js:524`).
    - Route re-registration appends duplicate Express handlers on every Route change.
- [ ] **5.3 Make provisioning atomic and resumable.** **[→ tenant-management-plan D.1]** `CREATE DATABASE`, writes to the new databases, and emails all run inside the admin transaction; a late failure leaves orphan databases and a notice that can't be reprocessed.
    - Fix: a provisioning state table (requested, db created, configured, emailed) with idempotent steps; create and drop databases in `onCommit`, not in AFTER triggers.
- [ ] **5.4 Make template creation safe** **[→ tenant-management-plan D.2]** (`createTemplateDatabase`).
    - Create the new template under a temporary name, then swap, instead of dropping first.
    - Use `ALTER DATABASE … IS_TEMPLATE` rather than updating `pg_database`.
    - Don't end the source tenant's pool mid-session; fix `port: conf.pgPort || 80`; guard unknown source databases.
- [ ] **5.5 Fix WooCommerce processing** **[→ tenant-management-plan D.4]** (`AdminConsole/do-process-woo-commerce.js`).
    - `if (!items.length > 1)` never fires, so multi-edition orders aren't rejected.
    - The upgrade/downgrade `PATCH Tenant` has no `id`.
    - Check the `<db>_demo` name for collisions.
    - Don't authorize edition changes on email plus name alone.
    - `triggers-tenant.js` compares the `modules` arrays with `!==`, so every tenant edit re-runs `doConfigureJobShop`.
- [ ] **5.6 Decide whether edition limits must be enforced.** **[→ tenant-management-plan D.5]** Job Shop editions only swap forms and workbook access; every feather and route is installed in every edition, so a Standard tenant can call Pro routes directly. Enforce server-side if editions are a paid boundary.

## Tier 6: Resilience and code health

One stray rejected promise can take down every tenant on the server, so 6.1 is worth doing early despite its tier. The rest makes the refactor safer.

- [ ] **6.1 Stop unhandled rejections from crashing the server.** **[→ tenant-management-plan E.5]** There's no `unhandledRejection` handler, and on Node 15+ one floating rejection kills the process.
    - Add a process-level handler that logs and alerts.
    - Fix the sources: `plan/do-transact-allocated.js:54` and `sell/do-sales-order-hold.js:66` (reject without `return`); un-awaited Alert requests in `ship-engine/do-import-ship-engine-carriers.js`; un-awaited `client.query` in `make/triggers-work-order.js:864`; the `onCommit` Alert without `catch` in `do-transact-allocated.js` ~166–182.
- [ ] **6.2 Remove multi-tenant shortcuts in app code.** **[→ tenant-management-plan E.5]**
    - `new f.PgClient({database: config.pgDatabase})` fallbacks query the system database, not the tenant's, and have no `finally` (`design/do-indented-bill-of-material.js`, `do-indented-where-used.js`).
    - `common/money-formats.js` sets global `f.formats` from the default tenant.
    - Per-process `pending` guards in ship and issue code: replace with database locks; the `splice(-1, 1)` path removes another request's id.
- [ ] **6.3 De-duplicate posting logic.** Backflush and cost logic exists three times, `calcAvail` twice, the trace-fetch loop three times; receipts patch materials by `indexOf` while others use `sequence - 1`.
- [ ] **6.4 Remove or fix dead code.** `stock/do-calculate-inventory-report.js` is routed but can't run; `stock/triggers-item.js` loads whole tables to test `.length`, puts `limit` where the framework ignores it, and uses `return` where `continue` is meant; `make/post-operation-completion.js:521` stores `f.today` uncalled.
- [ ] **6.5 Upgrade the runtime and dependencies.** The README targets Node 16 (end of life); `npm audit` reports 20 vulnerabilities, 11 high, including `ws`. Pin the `shipengine` version in the ShipEngine manifest.
    - Note (2026-10-06): do not use `npm audit fix --force`; it downgraded `pdfjs` to 0.5.4 and broke the server. Take dependency bumps one at a time (dependabot PRs), with `npm test` after each.
- [ ] **6.6 Add tests and CI.** Start with the paths this plan touches: posting (2.3), cost totals (2.4), allocations (2.5), tenant create and delete (1.4, 5.3), and the two-tenant role test (1.1). Split `crud.js`, `datasource.js`, `server.js` and `table-widget.js` (2.5–3k lines each) as you go, and settle on `async`/`await` over the `afterX` callback chains.

## Verification still to do

Three findings were traced in code but not yet proven by running them; confirm them on a writable scratch copy of `demo`, not `demo` itself.

- [ ] **Two-organization isolation test** for 1.1 **[→ tenant-management-plan F.1]**: create a user in organization B with an organization A username, then try to set A's password and sign in to A.
- [ ] **Concurrent posting test** for 2.3: post the same PO receipt from two sessions at once and check inventory.
- [ ] **Production-scale timings** for Tiers 3 and 4: `demo` is 26 MB with at most 400 rows per table, so index gains won't show until you load realistic volumes.
- [ ] **Unreviewed code and data:** client-side Mithril code (`module.js`, `forms.json`) was only sampled, and the other local databases (`ddom`, `demo_dci`, `featherbone_llc`, `scheduling`) weren't reviewed.
