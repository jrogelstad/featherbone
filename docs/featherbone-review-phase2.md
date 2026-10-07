> Copied from the Featherbone Claude project into the repo on 2026-10-06.
> Written against framework commit `867c146`; the local checkout has since moved
> to master (`920dee6`) with the test suite, UI refresh and test fixes.

# Featherbone Review: Phase 2 (apps, local copy, `demo` database)

Continues `featherbone-review-handover.md`. Phase 1 findings are referenced as F-C1…F-C6 (correctness and security) and F-P1…F-P4 (performance).

Reviewed on 2026-09-27:

- **SupplyChain:** `jrogelstad/SupplyChain` at `9de2417` (manifest 2.2.0), 122 feathers.
- **Admin Console:** v2.1.9. The CronJob it bundles is also included.
- **Job Shop:** v2.1.9.
- **CronJob:** v0.9.34.
- **Local Featherbone copy.**
- **Live `demo` database:** Postgres 14.24 on localhost, reached through the read-only `featherbone-postgres` connector.

The `demo` database runs older module versions than the SupplyChain repo: Core 2.2.0, most modules 2.1.9, and Stock and SupplyChain 2.1.9a.

## Headline

Phase 1 predicted the biggest problem would be missing indexes on relation columns. The `demo` database confirms it exactly, and the apps make it worse rather than working around it. On a 26 MB database, though, the dominant cost right now is **query planning**. The generated views are so large that Postgres spends 75–150 ms planning each view query, against 1–9 ms executing it.

The Admin Console review found the most serious new problem. **All tenants share one Postgres role namespace.** Users are cluster-wide Postgres roles, and creating a user in one tenant can reset the password of a user with the same name in another tenant.

The SupplyChain code contains several real money and inventory bugs. The worst are tax rounded to whole dollars, `COMMIT` statements injected mid-transaction, and double-posting races on receipts.

## 1. Local Featherbone copy

- It is a fresh clone taken today of `867c146`, the same commit reviewed in Phase 1, on a new local branch `refactor` with no commits yet. `origin/refactor` also points to `867c146`.
- **No source changes.** Only runtime files differ:
  - `server/config.json`: `clientPort` 3003, `pgDatabase` `demo`, and a new `pgCryptoKey` and `secret`.
  - `package-lock.json`: the version string changed from 2.1.8 to 2.2.0.
  - Log files.
- So none of the Phase 1 findings are resolved locally, and every finding in this document applies to the refactor branch as it stands.
- **Operational note.** Today's log shows 11 `Wrong key or corrupt data` errors. The changed `pgCryptoKey` doesn't match the key the `demo` data was encrypted with, so encrypted columns fail to decrypt. The framework has no key-rotation path, and a changed key fails silently at read time.
- **Repo defaults.** The committed `server/config.json` ships a real-looking default `secret` and `pgCryptoKey`. Any deployment that doesn't change them has forgeable sessions and a known encryption key. The fix is to ship empty values and refuse to start until they are set.

## 2. `demo` database: evidence

| Check | Result |
|---|---|
| Relation columns (`_<prop>_<relation>_pk`) | **364 across 127 tables. 0 indexed, 0 foreign keys.** This confirms F-P1. |
| Natural-key indexes | 30+ `*_index_*` indexes, **none unique**. This confirms F-C2. |
| Natural-key indexes on inheritance parents | Built on the **empty parent table only**. `item`, `demand` and `supply` hold 0 rows themselves, so every real row lives in child tables that have no index on `number`. See the table below. |
| SupplyChain's only `isIndexed` properties (`Demand.status`, `Supply.status`) | Also parent-only, so they index empty tables and have **no effect**. |
| `id` column | Uniquely indexed on every table, including children, so lookups by `id` are fine. |
| `user_account.name` (the login lookup) | Not indexed. It inherits from `role`, whose index doesn't carry over. |
| Hottest tables since stats reset (20:52) | Framework metadata, not business data: `form_attr_column` had 3,044 seq scans reading 2.0M tuples, and `form`, `form_attr` and `system_print_form` each had about 3,000 scans. |
| `SELECT * FROM _form` (104 rows) | 172 ms and 33k buffer hits. `form_attr` is scanned 104 times and `form_attr_column` 1,520 times, one correlated subplan per parent row. |
| `_purchase_order` by id (1 row) | **Planning 97 ms, execution 1 ms.** A full scan of 29 rows: planning 149 ms, execution 9 ms, 3.4k buffers. |
| `_work_order` first page (19 rows) | Planning 77 ms, execution 9 ms. `work_order_requirement` (257 rows) is scanned in full once per work order. |
| Natural-key check on Supply | A sequential scan of all 8 Supply child tables. |

Inherited indexes that are missing on child tables:

| Parent | Column | Child tables with no index |
|---|---|---|
| demand | number, status | outside_process, sales_order_line, sales_order_requirement, work_order_requirement |
| supply | number, status | inventory, planned_order, purchase_order_line, purchase_order_line_component, work_order |
| item | number | product, service |
| operation | number | planned_operation, work_order_operation |
| invoice | number | prepaid_invoice, shipment_invoice |
| receipt, shipment | number | purchase_order_receipt / work_order_receipt; outside_process_shipment / sales_order_shipment |
| role | name | user_account |

These tables are also affected: `carrier`, `package_type` and `ship_method` (their ShipEngine children), and `container`, `resource_group`, `task`, `unit`, `kind`, `layout` and `script`.

**New performance finding (F-P5): planning cost.** The framework issues unnamed parameterized queries, so every request replans the view. The view nests correlated subplans, and each relation to an inherited feather expands into an `Append` over every child table. Planning therefore dominates at current data sizes.

Fixes:

1. Use named prepared statements (`{name, text, values}` in `pg`) for the stable `doSelect` shapes, so the generic plan is cached per connection.
2. Shrink the views. Generate list views that expand only the natural key and label, and keep the full expansion for single-record form loads.
3. Cache the form and catalog metadata in the Node process instead of re-reading `_form` on each load.

Without indexes, the cost grows as parent rows × child rows: every list page scans each child table once per parent row. It's invisible at `demo` scale and will dominate with production volumes.

## 3. SupplyChain

### Profile

- 122 feathers, 853 properties, 185 to-one relations and 54 to-many (`childOf`) relations.
- 33 natural keys, 16 of which are autonumbered.
- Heavy table inheritance: 35 feathers inherit `Document`; Demand, Supply, Item, Receipt, Shipment and Invoice are hierarchies.
- The deepest views expand relations 3 levels deep. `ShipmentInvoice` has 24 nested to-one subselects per row; PurchaseOrder, SalesOrder and Invoice have 12–18 plus 2–3 child arrays.
- Every to-one relation declares an explicit `properties` list. This refines F-P2: over-fetching is bounded per level, but it compounds through nested relations. For example, PO line → sales order line → item → unit.

### Checklist answers

- **`isIndexed` / `isNaturalKey`:** used as above. There are no relation indexes and no unique constraints.
- **Raw SQL indexes or constraints in install scripts:** none. There is no `CREATE INDEX`, `ALTER TABLE` or constraint anywhere in the repo.
- **Hot-path overrides:** yes. There is extensive raw SQL (`obj.client.query`) in planning, allocation, cost roll-up, due-date and receipt code. Almost all of it filters on unindexed relation columns, mainly `(_item_item_pk, _site_site_pk)` on `demand`/`supply` and their children.

### Findings, ranked

The file reviews were done by two focused passes. The headline items were spot-checked in source.

1. **Tax rounded to whole currency units** (`bill/do-create-shipment-invoice.js:153`). `Math.round(ttl, 2)` ignores its second argument, so $7.35 of tax becomes $7. Line and discount amounts are never rounded either (`sell/triggers-sales-order.js` around line 171).
2. **Transactions committed partway through a request.** These run `COMMIT` on the request's own transaction client, often without `await`. Everything after runs in autocommit, and rollback hooks and advisory transaction locks are lost:
   - `design/do-roll-up-costs.js:246`
   - `design/do-update-proposed-costs.js:39`
   - `sell/do-zip2tax-import.js:48`, which also runs an un-awaited `DELETE FROM tax_rate`
   - `plan/do-clear-allocations.js`, which sends its own `BEGIN`/`COMMIT`
3. **Double posting.** Status is read before the record lock is taken in `buy/do-post-purchase-order-receipt.js`, `make/do-post-work-order-receipts.js`, `make/do-post-work-order-issue.js`, `stock/do-post-inventory-adjustment.js` and `count/do-post-physical-count.js`. Two concurrent posts of the same document can both see status "P" and both post inventory. Fix: lock first, or claim the document atomically with `UPDATE … SET status='R' WHERE id=$1 AND status='P' RETURNING`. The same read-then-lock pattern loses concurrent invoice payments (`bill/do-apply-invoice-payment.js`) and allows a prepayment to be applied twice (`do-create-shipment-invoice.js`). This still needs a concurrency test to confirm.
4. **Wrong actual-cost totals.** Backflush and cost logic is written three times: WO receipts, operation completion, and WO issue. Each copy accumulates totals differently, and at least two double-count. On shipping, labor and overhead are never added, so actual total cost equals material cost. Fix: one shared helper, with total = sum of the four components.
5. **Allocation drift.** `plan/do-transact-allocated.js:427–540` leaves `inventory.allocated` and `supply.allocated` out of step with the allocation rows. `make/do-post-work-order-issue.js:269` compares against `"issue"`, but the value is `"issued"`, so manual issues never relieve allocations.
6. **Paid ShipEngine labels are orphaned on rollback.** Labels are bought over HTTP inside the ship transaction while holding locks (`ship/do-ship-sales-order-shipment.js` around lines 193–237). The code collects label ids for voiding "in case of reject" but never voids them.
7. **Path traversal with delete** (`sell/do-zip2tax-import.js:22,116`). The path is built from the client-supplied `filename`, read, then `unlink`ed. With `../`, any file the Node process can write can be deleted.
8. **Request fan-out.** Rough estimates from reading the code, not measured:
   - Shipping a 20-line order: about 300–500 SQL statements.
   - Posting a 10-line PO receipt: about 150 sequential datasource requests.
   - Exploding a 3-level, 20-component BOM: about 120–150 requests in one transaction, which also takes a tenant-wide `pg_advisory_xact_lock(1)`.

   The main multipliers:
   - `doRecalcInventoryOrders` runs once per line with no de-duplication, over unindexed inheritance tables.
   - Full `GET`s with no `properties` list (WorkOrder, Item).
   - Settings and base currency are re-fetched per line.
   - `ItemUnitConversion` is loaded in full for every demand during planning.
9. **Unhandled rejections.** There are floating promises and rejects without `return` in `do-transact-allocated.js:54` and `do-sales-order-hold.js:66`, un-awaited Alert requests, and un-awaited queries such as `make/triggers-work-order.js:864`. The framework installs no `unhandledRejection` handler, so on Node 15+ any of these can crash the whole multi-tenant server.
10. **Closure and index bugs.**
    - `let del` is declared outside loops, so every `onCommit` writes history for the last allocation (`make/triggers-work-order.js:68`, `buy/triggers-purchase-order.js:70`, `plan/triggers-planned-order.js:113`).
    - `buy/do-convert-planned-purchase.js:161` uses `d.ids[0]` on every pass.
    - PO receipt posting never resets `j`, so the lines of later receipts are skipped while those receipts are still marked received.
11. **Multi-tenant hazards.**
    - The `new f.PgClient({database: config.pgDatabase})` fallback in `design/do-indented-bill-of-material.js` and `do-indented-where-used.js` queries the system database, not the tenant's, and has no `finally`.
    - `common/money-formats.js` sets the global `f.formats` from the default tenant, so all tenants get its decimal scales.
    - The module-level `pending` guards in the ship and issue code are per process and break across nodes.
    - The splice logic in the ship code can remove another request's id.
12. **Smaller bugs.**
    - `triggers-invoice.js` reads `ln.shipment` and `ln.unitPrice`, which don't exist, so sales history gets `shipmentLine` 0 and `unitPrice` null.
    - Several `number === object` comparisons never fire.
    - `stock/do-calculate-inventory-report.js` is routed but can't run.
    - `stock/triggers-item.js` loads whole tables just to test `.length` and uses `return` where `continue` is meant.
    - The tax lookup matches the city with an unanchored regex, `LIMIT 1` and no `ORDER BY`.
13. **Duplication.** There are three copies of backflush and cost, two of `calcAvail`, and three of the trace-fetch loop. The largest files are `make/module.js` at 3.4k lines and `make/triggers-work-order.js` at about 1k lines.

## 4. Admin Console, CronJob and Job Shop

### How tenants work

- The Tenant feather lives in the system database (`config.pgDatabase`). `loadTenants()` reads it and creates one `pg.Pool` per tenant database.
- Creating a Tenant clones a template database and runs `doConfigureJobShop` against the new tenant.
- WooCommerce orders arrive as `Notice` records through a webhook. An admin processes a notice, which creates a production tenant plus a 30-day Enterprise demo tenant, an Employee and an administrator UserAccount in each, and sends magic-login emails.
- Credentials: each tenant points to a `TenantService` row, whose `pgPassword` is encrypted with `pgCryptoKey`. That row supplies the connection user, described as the "administrative user". WooCommerce provisioning always uses the first `TenantService` row, so in practice every tenant shares one administrative account.

### Findings, ranked

1. **Cross-tenant account takeover through the shared role namespace (new, high).** Featherbone users are Postgres login roles, and login works by connecting to the tenant database as that role. Roles are cluster-wide.
   - The POST `UserAccount` trigger (`scripts/services.js` `createRole`, then `server/services/role.js:212–232`) checks whether a role with that name exists. If it does, the trigger runs `ALTER ROLE … PASSWORD` on it instead of failing.
   - So an administrator of tenant B who creates a user named `alice@acme.com` sets Alice's password in tenant A too, and can then sign in to tenant A as Alice.
   - Authorization uses `pg_has_role()`, which is also cluster-wide. Granting `administrator` in one tenant therefore grants it wherever `administrator` is authorized.
   - The WooCommerce flow depends on this sharing: "the same password will be used for your demo system."
   - Fix options: prefix roles per tenant, or move authentication into an application table, or give each tenant its own cluster. At minimum, refuse to create a UserAccount whose role already exists but has no `user_account` row in this database.
   - Needs confirming with a two-tenant test.
2. **Webhook accepts unsigned requests by default** (`server.js` `doNotice`). When `webhookHeader` is empty, the default, both `signature` and `hash` are `undefined`, and `hash === signature` passes. Anyone can then POST `Notice` records, which become tenant-provisioning requests.
   - The fix is to fail closed when no secret is configured and use `crypto.timingSafeEqual`.
   - Also, `verbose` logging writes every webhook header to the log.
3. **Superuser password written to the log.** `postify` (`server.js:384`) runs `logger.info(payload)` with the full request body on every module route. `/admin-console/create-template-database` takes `superuser` and `password` in the body, so the Postgres superuser password lands in the log in plain text. The user-account route masks `password`, but this generic path doesn't.
4. **`createDatabase` can drop an existing database** (`server/datasource.js:332–400`). If `CREATE DATABASE` fails because the name already exists, the `catch` fires `DROP DATABASE IF EXISTS <name>` without `await`.
   - The duplicate check (`triggers-tenant.js`) looks only at other Tenant rows, and it runs before the name is normalized, so "Acme Co" and "acme_co" both pass.
   - An idle, non-template database with that name is dropped. That includes a database nobody is connected to, such as `postgres` or an old restore.
   - `finally` then calls `conn2.done()` while `conn2` is undefined, throwing a TypeError that hides the real error. A non-superuser caller gets the same TypeError instead of a clear message.
5. **Provisioning isn't atomic and orphans databases.** These run inside the admin database transaction:
   - `CREATE DATABASE`, which can't be rolled back.
   - Writes to the new tenant databases on other connections.
   - Emails.

   If a later step fails, the Tenant rows roll back but the databases and their roles remain. Reprocessing the notice then fails with "already in use by another company". `DELETE Tenant` drops the database with `FORCE` in an AFTER trigger, before commit, so a later rollback leaves a Tenant row pointing at a dropped database.

   Fix: a state-machine table (requested, db_created, configured, emailed) with idempotent steps. Run database creation and deletion in `onCommit`.
6. **Tenant registry leaks.**
   - `deleteDatabase` calls `tenants.splice(idx, 0)` with a delete count of 0, so it removes nothing.
   - `loadTenants()` only ever adds tenants.
   - Deleted tenants keep their pool, their permanently checked-out listener connection and their `pools[db]` entry. A recreated tenant with the same name reuses the stale pool.
   - `cleanupProcesses()` loops with `tenants[0]`, so after a restart only the first tenant's stuck processes are cleaned up.
   - Route re-registration appends duplicate Express handlers on every Route change.
7. **Connection budget (checklist).** Each tenant gets a pool with node-pg's default of 10 connections, because `pgMaxConnections` is ignored (F-C6). One of those is held permanently as the LISTEN connection.
   - Per node: (tenants + 1) × 10, plus 2 transient login pools per sign-in, plus 2 extra connections per `f.datasource.lock` call in SupplyChain posting code.
   - At Postgres's default `max_connections` of 100 (what `demo` uses), about 8 tenants on one node can exhaust the server.
   - Needed: honor `pgMaxConnections`, lower the per-tenant pool max, close idle pools (`idleTimeoutMillis`, end pools for inactive tenants), and put PgBouncer in front.
8. **`createTemplateDatabase`.**
   - It drops the old template before creating the new one, so a failed create loses the template.
   - It edits `pg_database.datistemplate` directly instead of `ALTER DATABASE … IS_TEMPLATE`.
   - It ends the source tenant's pool, so users are disconnected mid-copy.
   - It falls back to `port: conf.pgPort || 80`.
   - It throws a TypeError if the source database isn't a registered tenant.
9. **WooCommerce processing bugs** (`do-process-woo-commerce.js`).
   - `if (!items.length > 1)` never fires, so multi-edition orders aren't rejected.
   - The upgrade/downgrade `PATCH Tenant` has no `id`.
   - The `<db>_demo` name isn't checked for collisions.
   - Edition changes are authorized only by matching the order's email and first and last name to the tenant's contact.
10. **Minor tenant-trigger issues.**
    - The PATCH trigger compares `newRec.modules !== oldRec.modules`, two arrays, which is always true. Every tenant edit therefore re-runs `doConfigureJobShop` inside the admin transaction.
    - `doCreateTemplateDatabase` and `doDeleteExpiredDemos` have no role check of their own. Deletion is still guarded by the superuser check in `deleteDatabase`.
11. **Job Shop.** Job Shop is a configuration layer. `doConfigureJobShopEdition` swaps forms, workbook authorizations and settings per edition (Standard, Professional, Enterprise). **Edition limits are cosmetic.** Every feather and route is installed in every edition, so a Standard tenant can call Pro routes directly.
12. **CronJob.** The standalone v0.9.34 package and the copy bundled in Admin Console differ slightly. Nothing significant was found beyond the framework patterns above.

## 5. Revised priority (framework plus apps)

1. **Security:**
   - Tenant role isolation (§4.1).
   - The webhook fail-open (§4.2).
   - The superuser password in logs (§4.3).
   - The `createDatabase` drop-on-failure (§4.4).
   - The zip2tax path traversal (§3.7).
   - The login connection leak (F-C1).
   - Default secrets in the repo config.
2. **Data correctness:**
   - Remove the mid-transaction `COMMIT`s.
   - Lock before read in the posting functions.
   - Fix the tax rounding.
   - Fix the cost-total helpers.
   - Make natural keys unique per child table (F-C2).
3. **Indexes:**
   - All 364 relation columns. The generator is below; review the names, since the 63-character truncation could collide.
   - `(_item_item_pk, _site_site_pk)` on every demand and supply child table, `inventory` and `item_site`.
   - Natural-key and status columns on every child table in the table above.
   - `user_account(name)`.
   - Longer term, have `feathers.js` create indexes on each child table when a feather inherits an indexed or natural-key property.
4. **Planning cost:** prepared statements, slimmer list views, and cached form metadata (F-P5).
5. **Tenant lifecycle:** registry cleanup, pool sizing, and atomic provisioning.
6. **Resilience:** an `unhandledRejection` handler, and void labels on rollback.

```sql
-- Generates CREATE INDEX for every unindexed relation column (run per tenant DB, review first)
SELECT format('CREATE INDEX IF NOT EXISTS %I ON %I (%I);',
              left(c.relname || a.attname || '_idx', 63), c.relname, a.attname)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
  AND a.attname LIKE '\_%\_pk' AND a.attname <> '_pk' AND NOT a.attisdropped
  AND NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum);
```

## 6. Still open

- **Concurrency tests** for §3.3 (double posting) and the cross-tenant role test for §4.1. Both need a writable scratch database, not `demo`.
- **Timings with production-scale data.** `demo` is 26 MB with at most 400 rows per table.
- **Other local databases.** The same cluster also holds `ddom`, `demo_dci`, `featherbone_llc` and `scheduling`, none of which were reviewed. `featherbone_llc` may be the Admin Console system database.
- **Client-side Mithril code** (`*/module.js`, `forms.json`) was only sampled.
