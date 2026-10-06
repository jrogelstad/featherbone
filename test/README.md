# Featherbone regression tests

Pins the current behavior of the framework and the SupplyChain modules so a
refactor can be checked against it. No new dependencies: the suite uses
`node:test` and `node:assert` (Node 18+; developed on Node 22).

## Running

```text
node test/run.js                # everything: unit, then integration
node test/run.js unit           # unit tests only, no database needed
node test/run.js integration    # api/ and supplychain/ against a database
node test/run.js supplychain/purchasing   # files whose path contains this
```

Integration runs clone the source database into a throwaway copy, start a
Featherbone server on its own port against that copy, run the test files
one at a time, then stop the server and drop the copy. Nothing touches the
source database. A full run takes about five minutes.

The Postgres user in `server/config.json` must be able to `CREATE DATABASE`
and `CREATE ROLE` (the tests create login roles for their test users).
The clone uses `CREATE DATABASE ... TEMPLATE`, which needs no other
connections on the source; if the source is in use (for example your dev
server is running), the harness falls back to `pg_dump | pg_restore`, which
needs those tools on the path.

Settings, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FB_TEST_SOURCE_DB` | `demo` | Database to clone from |
| `FB_TEST_DB` | `featherbone_test` | Throwaway copy (dropped afterwards) |
| `FB_TEST_PORT` | `3990` | Port for the test server |
| `FB_TEST_PGHOST`, `FB_TEST_PGPORT`, `FB_TEST_PGUSER`, `FB_TEST_PGPASSWORD` | from `server/config.json` | Postgres connection |
| `FB_TEST_KEEP_DB=1` | | Keep the copy after the run for inspection |
| `FB_UPDATE_GOLDEN=1` | | Rewrite golden files instead of comparing |
| `FB_TEST_REPORTER` | `spec` | Any `node --test` reporter, e.g. `tap` |

Server output goes to `test/.artifacts/server-<db>.log`.

## Layout

```text
test/run.js              runner (clone, bootstrap users, start server, run, drop)
test/harness/            env.js settings, db.js lifecycle + SQL helper,
                         server.js child process, http.js Session (sign-in,
                         /data API, module routes), fixtures.js data builders,
                         golden.js snapshot comparison
test/unit/               no database: common/ helpers, client/state.js
                         statechart library, model and property statecharts,
                         list, settings/workbook/feather/form models,
                         component render smoke tests (lib/browser-env.js
                         stands in for the browser)
test/api/                framework over HTTP: auth, users, authorization,
                         crud, query, locking, catalog, settings, workbooks,
                         schema (SQL-level), security
test/supplychain/        flows over HTTP: purchasing, inventory, count,
                         design (BOM, costing), manufacturing, sales,
                         shipping, billing, planning
test/golden/             snapshots (catalog, schema, workbook and component
                         shapes); commit them
```

Every file builds its own data with an `RT-`-style unique prefix, so the
tests pass on a clone of the demo database and on a fresh install, and files
can run alone or together in one server.

## Reading the results

Three outcomes matter:

- **pass**: current behavior, pinned.
- **todo**: a known defect. The test asserts the *correct* behavior and is
  marked `{todo: "plan 2.3: ..."}` (an item in the improvement plan) or
  `{todo: "defect: ..."}` (found while writing the tests). It shows as a
  failing todo, which does not fail the run. When the defect is fixed the
  test starts passing; remove the `todo` option then.
- **skip**: a test that cannot run safely in the shared server, with the
  reason in the option (for example one PATCH that crashes the server).

A plain failure means behavior changed. Look at the assertion; if the new
behavior is intended, update the test (or `FB_UPDATE_GOLDEN=1` for a golden
file) and commit.

## Writing more tests

Copy the shape of an existing file. Integration files get a signed-in
session with `const admin = await signedIn();` (from `harness/http.js`),
build data with `harness/fixtures.js` (`configure`, `world`,
`purchasedItem`, `manufacturedItem`, `cabinetAssembly`, `supplier`,
`customer`), call routes with `admin.route("/buy/post-purchase-order-receipts",
body)` and assert with API reads or `db.query(sql, params)`. Some module
routes start a server process and return before the work is done; the
`lib/` helpers in each area poll for completion.

For large structures use `matchGolden("area-thing", value)`; the first run
writes `test/golden/area-thing.json`, later runs compare. Volatile record
fields (`id`, `etag`, timestamps) are dropped from records automatically;
pass `{mask: new Set([...])}` to mask others.
