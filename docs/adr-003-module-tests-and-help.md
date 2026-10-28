# ADR-003: Tests and help travel with their modules

Status: **accepted**, 2026-10-27.
Author: John, written up by Claude from his direction of 2026-10-27.
Builds on ADR-002 (packages on disk). Implementation status is the last
section.

## 1. The question

Two pieces of infrastructure are monolithic and live in the wrong place.

- **Tests.** Every SupplyChain test sits in core under `test/supplychain`,
  next to the framework's own. Tests for a module's behaviour belong to
  that module and should change in the same commit as the code they pin.
- **Help.** The old `help_files` branch put the whole Job Shop manual in
  one file under `public/help`. Its links are wired through a help URL on
  each worksheet, which John says "has caused a lot of trouble in the
  past, and gets really problematic if the customer wants to write their
  own help."

Both used to have a good excuse. A module was a zip that the installer
read
one manifest entry at a time, and anything that was not `install`,
`execute`, `module`, `service`, `feather`, `batch`, `workbook` or
`settings` rolled the install back. ADR-002 removed that excuse: a package
is now a directory on the server, `<modulesDir>/<name>/<version>/`, and
anything in that directory travels with it, whatever the manifest says.

## 2. Decision

1. **A module's tests live in the module**, in a `test/` folder next to
   its manifest. The core runner finds them through the package registry
   and runs the tests of **the version deployed into the source
   database** (`demo` by default).
2. **A module's help lives in the module**, in a `help/` folder of
   Markdown pages with a `help.json` index. It is served from the version
   the database deployed.
3. **Help is found by the form the user is looking at, not by a stored
   URL.** A form defines the actions that apply and is what a list
   drills into, so different presentations of one feather can have
   different help (John, 2026-10-27). The feather is the fallback.
4. **The help link becomes the customer's supplement**: a URL
   to start, held by reference and never copied into a worksheet's
   saved configuration.
5. **Help opens in one named pop-out window** that the app reuses,
   replacing its content when help is asked for somewhere else.

## 3. Tests

### Where they live

| Was in core | Now in SupplyChain |
| --- | --- |
| `test/supplychain/billing.test.js` | `bill/test/billing.test.js` |
| `count.test.js` | `count/test/count.test.js` |
| `design.test.js` | `design/test/design.test.js` |
| `inventory.test.js` | `stock/test/inventory.test.js` |
| `manufacturing.test.js` | `make/test/manufacturing.test.js` |
| `planning.test.js` | `plan/test/planning.test.js` |
| `purchasing.test.js` | `buy/test/purchasing.test.js` |
| `sales.test.js` | `sell/test/sales.test.js` |
| `shipping.test.js` | `ship/test/shipping.test.js` |
| `lib/buy.js`, `lib/make.js`, `lib/sell.js` | `buy/test/lib/`, `make/test/lib/`, `sell/test/lib/` |
| SupplyChain builders in `test/harness/fixtures.js` | `common/test/lib/fixtures.js` |

Sub-modules of one package share helpers by relative path, since an
umbrella package installs as one directory. Core keeps only the generic
fixtures (`uniq`, `money`, `today`, `ref`, `findOne`, `ensure`).

### How module tests reach the harness

A package can live anywhere `modulesDir` points, so a module test cannot
reach core's harness by relative path. The runner puts
`test/export` on `NODE_PATH`, where `featherbone-test` resolves to the
harness:

```js
const {http, db, env, fixtures, golden} = require("featherbone-test");
```

That makes the harness a public interface for module authors. Changing it
is now a breaking change for every package with tests.

Golden files for a module live beside its tests:
`golden.at(__dirname).matchGolden(name, value)` writes to `./golden/`.

### What runs

The runner clones the source database as before, then reads the clone's
`module` rows to see what is deployed, and for each top-level package
there collects the `test/` folder of the package and of each module it
carries. Packages hold several versions on disk; only the version
deployed is tested, so older ones are ignored without anyone choosing.

```text
node test/run.js                       core, then every deployed module
node test/run.js core                  core only (unit + api)
node test/run.js SupplyChain           one package
node test/run.js sell                  one sub-module of a package
node test/run.js SupplyChain@2.2.32    that version, deployed into the copy first
node test/run.js --package ~/Documents/SupplyChain [sell]
                                       a working copy, installed for this run only
node test/run.js unit | integration | <path fragment>   as before
```

`@version` and `--package` deploy into the throwaway copy only
(`install.js --deploy` aimed at it), never into the source. If that
deploy fails, the run fails. `--package` installs the working copy into a
scratch modules directory under `test/.artifacts` that links to everything
else the server holds, so you can test before packaging.

Module tests run in their own phase against the server's real modules
directory, as the SupplyChain suites already did. That is because a
deployed module's code is read from its package.

### What it costs

- Test files are copied with the package to every server that installs
  it. Nothing loads them, since the installer acts only on manifest
  entries, so they cost disk and nothing else.
- Core API suites that lean on Job Shop or SupplyChain feathers (Terms,
  Employee, Product in crud, query, locking, catalog, users) and the five
  catalog snapshots that need Job Shop are not moved by this ADR. Moving
  them to the module that owns the feathers, or giving core its own test
  feathers, would let core's tests run with no modules installed. That is
  the follow-up.

## 4. Help

### Why the worksheet URL kept going wrong

When a worksheet is configured, `workbook-page.js` copies the whole
`HelpLink` record, URL included, into the sheet. The sheet is saved into
`default_config`, `local_config` and each user's profile. So a change to
the HelpLink row, or a package upgrade, never reaches a sheet that was
saved before it. One field also serves two owners: a reinstall overwrites
the customer's link, or the customer's edit hides the vendor's link for
good.

### The model

- **Content.** Each module that has help carries `help/` with Markdown
  pages and `help.json`:

  ```json
  {
      "title": "Sell",
      "default": "sales-orders.md",
      "pages": [{"path": "sales-orders.md", "title": "Sales orders"}],
      "forms": {"Sales Order": "sales-orders.md"},
      "feathers": {"SalesOrder": "sales-orders.md"}
  }
  ```

  `pages` is the module's contents list, in reading order, which the
  window offers; `default` is what the module answers with when it has
  nothing on this particular form.

- **Serving.** `GET /:db/help/:module/<path>` serves from `help/` of the
  version that database deployed (`packages.resolve`). Two instances on
  different versions each get help that matches them. Core's generic
  help (workbooks, filters, worksheets) is served from the checkout the
  same way.
- **Finding the topic.** A worksheet names the form it drills into
  (`sheet.form`, a form name, or `"D"` for the feather's default form).
  An open record shows a form. Forms and feathers both record their
  module. In order:
  1. the `forms` entry of the form's module;
  2. the `feathers` entry of the feather's module;
  3. the `default` page of either, in that order;
  4. core's generic page.

  Step 3 was added while building it: a module that says nothing about
  this form still answers better about itself than core's generic page
  does, and it keeps the per-module maps small.

  Form names are unique (SupplyChain's 72 are), so the name is the key.
  Nothing about help is stored on a worksheet or a form any more. The
  original idea was keying by feather. It moved to the form because the
  form is where the actions are, and one feather can have more than one
  form.
- **The customer supplement.** A customer link is a `HelpLink` row that
  belongs to no module, keyed by the form it supplements.
  It is found when help opens and is never copied into a configuration.
  Deploys write only rows that belong to a module, so a deploy can't
  touch it. The help window shows it beside the standard topic, under the
  customer's own heading. A URL to start (John); pages the customer
  writes inside the app can come later if wanted.
- **Moving off the old links** is a one-way script. A worksheet or form
  `helpLink` that points at a row belonging to a module is dropped,
  because package help covers it. One pointing at a row that belongs to
  no module becomes a supplement. Then the property is removed from
  worksheets and forms.

  The manifest runs `scripts/retire-help-links.js` twice, either side of
  the feathers, because the feathers are where the two columns change
  hands: `Form.helpLink` is dropped there and `HelpLink.form` is added
  there. The first pass reads the references while the old column is
  still there and parks them in a carry table; the second writes the
  supplements once the new column exists, and clears up. Which pass it
  is, the script reads off the database. A link two forms shared becomes
  one supplement each, since a supplement answers for a form.

### The help window

Help opens with `window.open(url, "featherbone-help", "popup,…")`.
Because the window is named, the browser keeps one: the first request opens
a separate small window, and later requests reuse that window instead of
opening a tab. The user can move it to another screen and resize it. It is
the same origin, so it is signed in and styled like the app, dark mode
included.

- The app sends a new topic to the open window with `postMessage`, so the
  window keeps its own Back history, then brings it to the front.
- The window saves its size and position when closed, and the app asks
  for the same placement next time. The browser decides whether it
  honours that, but Chrome usually does, second screen included.
- Markdown is turned into HTML in the window by one vendored npm
  library (`marked`). The reader needs nothing else installed (John: "ok
  with markdown if it just means including an npm file").
- On phones and tablets the window opens as a tab, which is the right
  thing there.

Chrome's Document Picture-in-Picture window was considered and set aside:
it works only in Chrome, and it always stays on top, which gets in the way
when help sits on its own screen.

### The Job Shop manual

The 197 topics generated on the `help_files` branch are split up. Most
document SupplyChain behaviour and go to the sub-modules' `help/`
folders. Job Shop keeps navigation and getting-started, and core takes
the generic workbook how-tos. The generator's anchors make the mapping
mechanical. The 22 unwritten articles are still unwritten.

## 5. Questions settled

| Question | Answer |
| --- | --- |
| Which version's tests does "all" run? | The version deployed into the source database ("I meant deployed into demo"). |
| What is help keyed by? | The form, because it defines the actions and is what a list drills into. Feather as the fallback. First answer was the feather; moved to the form the same day. |
| Customer help | A URL to start. |
| Markdown | Yes, rendered in the browser by a vendored library. |
| New tab or pop-out | One reusable pop-out window. |

## 6. Implementation status, 2026-10-27

- **Tests, core side**: branch `feat/module-tests` in
  `jrogelstad/featherbone`. The runner discovers module tests,
  `featherbone-test` resolves on `NODE_PATH`, goldens can be per module,
  `@version` and `--package` work, and `test/supplychain` plus the
  SupplyChain fixtures are removed from core.
- **Tests, SupplyChain side**: branch `feat/module-tests` in
  `jrogelstad/SupplyChain`. The suites move into the sub-modules and the
  version is bumped so there is a package to deploy.
- **Merge order**: both together. Core without the SupplyChain branch
  runs no SupplyChain tests. The SupplyChain branch's tests need the core
  runner to resolve `featherbone-test`.
- **Seed databases** (branches `feat/test-seed-database`, then
  `feat/test-seed-split`): the runner clones seeds that `test/seed.js`
  builds from the installers and `test/seed.json` pins, instead of
  `demo`. A used database moved the results under the tests (an approved
  proposed cost, Postgres collation, a combined manager/instance shape,
  authorization grants), and the goldens recorded whatever it held. There
  are two: `core`, Core with the `FbtModel` fixture package, for the
  framework's tests, and `supplychain`, Core with the pinned SupplyChain,
  for the packages'. Each phase clones its own, so Core's goldens hold
  Core alone and SupplyChain's (`common/test/golden`) hold SupplyChain's.
  Job Shop is in neither. Core tests that borrowed SupplyChain's Terms,
  Category and Location now use `FbtTerms`, `FbtCategory` and
  `FbtLocation`; the tests of what the module itself adds (the Terms
  trigger, Product's inheritance of Item, the catalog, routes, settings
  and schema it contributes) moved into the package. Two gaps remain:
  the api phase loads no module code, and `TenantService` is a manager
  feather, so the two security tests that need an encrypted column skip
  on an instance. Seeds carrying domain data for a package are future
  work; today the SupplyChain seed is the package as installed, and each
  test makes its own records.
- **Help** (branches `feat/module-help` in both repositories, Core
  3.0.0-alpha.10 and SupplyChain 2.2.44). Built as planned:
  - `server/services/help.js` and three routes: `/:db/help` (the
    window), `/:db/help-topic` (which page answers, with the customer's
    supplement), `/:db/help/:module/<path>` (the file, from the version
    that database deployed). A path that leaves a module's help folder
    is refused.
  - The window is `help.html` and `client/help-window.js`: one named
    pop-out, Markdown rendered by `marked` (vendored as a dependency),
    its own Back history, a contents list for the module, placement
    remembered, a tab on a narrow screen. `f.openHelp` opens it, and
    `client/core.js` attaches that before it freezes `f` -- a module
    script loaded later cannot add to `f` at all, which is worth
    knowing.
  - `Form.helpLink` and the worksheet's are gone, with the Form editor
    field and the worksheet configuration field; `HelpLink.form` is the
    customer's supplement; the Help Files worksheet lists those.
  - Core carries `help/`: workbooks, worksheets, concepts, user
    accounts, authorizations, print forms, developing (with a written
    account of this design) and a glossary.
  - SupplyChain carries help in each of its twelve modules, 28 pages.
    All 197 generated topics are placed, each exactly once: 165 in
    SupplyChain, 32 in core. The 38 the generator left as stubs are
    still stubs, now reading "Not written yet" rather than naming the
    Job Shop knowledge base.
  - Tests: `test/api/help.test.js`, `test/api/help-migration.test.js`
    (which builds the old shape and upgrades it), and
    `common/test/help.test.js` in SupplyChain, which holds the join
    between a page on disk, a form name in the database and the entry
    that ties them.
  - **Corrected the same day** (Core 3.0.0-alpha.10), after a deploy of
    Job Shop to the cloud demo failed on `duplicate key value violates
    unique constraint "help_link_id_key"`:
    - **The bright line** (John): our standard help is files in a
      package; the customer's is records they keep in a workbook; and
      neither writes over the other. So the migration now *removes*
      every help link that belongs to a module -- it had soft-deleted
      90 of them in that database, and a deleted row keeps its id,
      which is what the duplicate key was. Removing frees the id, so
      even a package still carrying one can install it. The clear-out
      runs on every upgrade rather than once, so a stale package that
      puts some back does not leave them there for good, and
      `deleteModule` now takes a module's links with it the way it
      already took its forms and routes. A link belonging to no module
      is the customer's and is never in scope for any of it; the Help
      Files worksheet is their own list, with nothing of ours in it.
    - A POST naming the id of a deleted record now brings that record
      back instead of failing on a duplicate key (`doUpsert` in
      datasource.js). This was not new and not only about help: it bit
      any time somebody deleted a record a package ships, which is
      John's "umpteenth time". `deploy-failure.test.js` deletes a
      record the fixture package carries and deploys it again.
  - **Still to do**: Job Shop's own help folder (navigation and
    getting-started), which is where the manual's remaining front
    matter belongs. The generated `job-shop-help.html` on the
    `help_files` branch can be retired once that is done.
