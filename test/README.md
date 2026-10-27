# Featherbone regression tests

Pins the current behavior of the framework, and runs the tests modules
carry in their own packages, so a refactor can be checked against it. No new dependencies: the suite uses
`node:test` and `node:assert` (Node 18+; developed on Node 22).

## Running

```text
node test/run.js                # core, then every module deployed in demo
node test/run.js core           # core only: unit, then api
node test/run.js unit           # unit tests only, no database needed
node test/run.js integration    # api/ and deployed modules
node test/run.js SupplyChain    # one package's tests
node test/run.js sell           # one module a package carries
node test/run.js SupplyChain@2.2.32   # deploy that version into the copy first
node test/run.js --package ~/Documents/SupplyChain [sell]   # a working copy
node test/run.js api/crud       # files whose path contains this
```

### Module tests

A module's tests live in its package, in a `test/` folder beside its
manifest (ADR-003): SupplyChain's are in `sell/test`, `buy/test` and so
on. The runner reads the copy's `module` rows and runs the tests of the
version **deployed in the source database**; other versions on disk are
ignored. Module names are not case sensitive, and a name the server does
not hold is taken as a path fragment.

- `<Package>@<version>` deploys that installed version into the
  throwaway copy before running. A failed deploy fails the run.
- `--package <dir>` installs a working copy into a scratch modules
  directory (`test/.artifacts/modules`, holding copies of the other
  deployed packages) and deploys it into the copy, so tests can run before
  anything is packaged. The server's own modules directory is not
  touched.

Module tests run against the server's real modules directory
(`modulesDir`, or `FB_TEST_MODULES`). They reach the harness as
`require("featherbone-test")`, which the runner resolves through
`NODE_PATH` (`test/export`):

```js
const {http, db, env, fixtures, golden} = require("featherbone-test");
const {matchGolden} = golden.at(__dirname);   // ./golden/<name>.json
```

That module is a public interface: changing what it exports breaks every
package's tests. `fixtures` holds only builders over framework feathers;
a module keeps its own (SupplyChain's are in `common/test/lib`).

Integration runs clone the source database into a throwaway copy, start a
Featherbone server on its own port against that copy, run the test files
one at a time, then stop the server and drop the copy. Nothing touches the
source database. A full run takes about five minutes.

**Stop your own server first, and close the browser on it.** The clone
itself copes with a busy source -- `CREATE DATABASE ... TEMPLATE` needs no
other connections, and the harness falls back to `pg_dump | pg_restore`,
which needs those tools on the path -- but `api/deploy.test.js` makes a
template copy of the source for its own claims, and Postgres refuses that
outright while anything is connected ("source database ... is being
accessed by other users"). Nine of its claims fail for that reason alone.

The Postgres user in `server/config.json` must be able to `CREATE DATABASE`
and `CREATE ROLE` (the tests create login roles for their test users).

Settings, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FB_TEST_SOURCE_DB` | `demo` | Database to clone from |
| `FB_TEST_DB` | `featherbone_test` | Throwaway copy (dropped afterwards) |
| `FB_TEST_PORT` | `3990` | Port for the test server |
| `FB_TEST_PGHOST`, `FB_TEST_PGPORT`, `FB_TEST_PGUSER`, `FB_TEST_PGPASSWORD` | from `server/config.json` | Postgres connection |
| `FB_TEST_MODULES` | `modulesDir` from config | Packages directory the module tests come from |
| `FB_TEST_KEEP_DB=1` | | Keep the copy after the run for inspection |
| `FB_UPDATE_GOLDEN=1` | | Rewrite golden files instead of comparing |
| `FB_TEST_SKIP` | | Comma separated path fragments to leave out, for a file too slow to sit through: `FB_TEST_SKIP=upgrade` runs everything but `api/upgrade.test.js` (and `unit/upgrade.test.js`, which matches the same fragment). Skipped files are named at the start of the run, so a green run cannot quietly be a partial one |
| `FB_TEST_REPORTER` | `test/harness/reporter.js` | Any `node --test` reporter, e.g. `spec` (every test, full errors, SQL and stacks) or `tap` |

The default reporter prints results only: one line per test file, then each failure once (test name, the first lines of its message cut to 240 characters, and where in the tests it was thrown), then one set of totals. Known-defect (todo) tests are counted, and any that now pass are named so they can be promoted. Console output from the tests is dropped. Use `FB_TEST_REPORTER=spec` when you need the full detail.

The runner also names each integration file as it starts it, because the
reporter says nothing about a file until it finishes and a slow one looks
like a hang. `api/upgrade.test.js` is the slow one: it runs a core upgrade
per instance, and an upgrade costs what the instance's data costs, so on a
large `demo` it can run for many minutes.

Server output goes to `test/.artifacts/server-<db>.log`.

**A run that is interrupted can leave state behind.** `api/module-install.test.js`
installs a fixture package into the packages directory and removes it in its
`after`; kill the run before that and the next one reports "nothing reached
the disk" against a package that is still there. `rm -rf
test/fixtures/modules/FbtWebInstall` clears it.

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
test/export/             featherbone-test, the harness as module tests see it
test/golden/             snapshots (catalog, schema, workbook and component
                         shapes); commit them
```

Every file builds its own data with an `RT-`-style unique prefix, so the
tests pass on a clone of the demo database and on a fresh install, and files
can run alone or together in one server.

## Lint

`unit/lint.test.js` runs the project's own JSLint (`client/jslint.mjs`)
over every JavaScript file, skipping `node_modules`, `vendor`, the
generated `client/clientmin.js`, the linter itself and the packages under
`modules` (they, and their tests, live in their own repositories). Not every file is
clean yet, so it is a ratchet: `test/lint-baseline.json` records the
warnings each file is known to have, no file may exceed its entry, and a
file with no entry (a new one) must have none. Fixing warnings never
fails the test; run `FB_UPDATE_LINT=1 node test/run.js unit/lint` to lower
the baseline to match. The update can only lower a count, never raise one.

## Reading the results

Three outcomes matter:

- **pass**: current behavior, pinned.
- **todo**: a known defect. The test asserts the *correct* behavior and is
  marked `{todo: "plan 2.3: ..."}` (an item in the improvement plan) or
  `{todo: "defect: ..."}` (found while writing the tests). It is listed
  with its `# defect:` note and counted in the `todo` total, but does not fail
  the run or appear in a trailing failures block (the default reporter hides
  those; real failures still print). When the defect is fixed the
  test starts passing; remove the `todo` option then.
- **skip**: a test that cannot run safely in the shared server, with the
  reason in the option (for example one PATCH that crashes the server).

A plain failure means behavior changed. Look at the assertion; if the new
behavior is intended, update the test (or `FB_UPDATE_GOLDEN=1` for a golden
file) and commit.

## Writing more tests

Copy the shape of an existing file. Integration files get a signed-in
session with `const admin = await signedIn();` (from `harness/http.js`),
build data with `harness/fixtures.js` (`uniq`, `money`, `address`,
`currency`, `settings` and the like; a module's tests use its own builders,
such as SupplyChain's `world` and `purchasedItem`), call routes with
`admin.route("/buy/post-purchase-order-receipts", body)` and assert with
API reads or `db.query(sql, params)`. Some module routes start a server
process and return before the work is done; the `lib/` helpers beside
those tests poll for completion.

For large structures use `matchGolden("area-thing", value)`; the first run
writes `test/golden/area-thing.json`, later runs compare. Volatile record
fields (`id`, `etag`, timestamps) are dropped from records automatically;
pass `{mask: new Set([...])}` to mask others.
