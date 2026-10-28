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

**Progress 2026-10-24 (SupplyChain):** items 0.10 and 2.1, 2.2, 2.3, 2.4, 2.5, 2.7 and 2.8 are fixed and merged in `jrogelstad/SupplyChain` (PRs #21 to #28), one branch each, plus the pdfjs/table-layout port of the five print services (PR #29), the logo-pointer fix for the design prints (PR #31) and side margins for the product label (`fix/product-label-margins`). The framework needed three fixes before any of it could run (see `featherbone-fix-branches.md`, eighth round). John confirmed the bill of material and the indented BOM, with their prints, on `demo`; the SupplyChain suites have not yet been run over the merged code, and none of the Tier 2 fixes has been exercised on a live server. Details, judgment calls and what each branch left open are in `featherbone-supplychain-fix-branches.md`.

**Also 2026-10-24:** 1.1 and 1.6 are ticked (done by the tenant-management plan, see their notes). 0.11 was closed as not reproduced and then reproduced, found and fixed -- see its entry.

**Progress 2026-10-24 (the suites):** a full run on John's machine failed in eleven API files, about thirty claims. Nearly all of it was the suites themselves, left behind by the users rework: administering an organization is an appointment in `organization_admin`, not `identity.is_org_admin`, and sixteen copies of a `flags` helper across fifteen suites set the column. They now share `test/harness/authority.js`. The rest: two fixture packages `deploy-failure.test.js` deploys were never committed (built, to the shape its claims describe); a feather naming a missing role now has the role created rather than the grant dropped (PR #291); Core is its own package, so it is no longer an example of a module answering from its row; an installed catalog carries `inheritedFrom: ""` where a feather defines the property itself; `user-contact-employee.test.js` built an `Employee` feather SupplyChain already defines. All on `fix/stale-api-suites`, with 3.4's second half. The golden snapshots (catalog and schema) are stale on John's `demo` and are his to regenerate -- they were recorded from it. Also: `FB_TEST_SKIP` leaves a file out of a run, the runner says which file is in flight, and the lint walk no longer lints `client/api.js` or `modules/`, which the build and Deploy write.

**Progress 2026-10-13:** everything pushed through 2026-10-11 is merged (PRs #164-#177, #191-#194): 0.1, 0.4, 0.13, 0.16, 0.17, 1.2, 1.3, 1.7, 1.8, 2.6, 3.1, 3.3 and the 6.1 handler, plus tenant plan A.1-A.5 and B.1-B.3, the install fix for a brand new database, the `clean-numeric-bounds` script and test-helper fixes. Last verified run on John's machine (master at PR #194): API 262 pass / 0 fail, unit 306 pass. Pushed and **not yet merged**: tenant plan B.4/B.5 (`feat/b4-b5-identity-writes`), the manager admin API (`feat/manager-admin-api`) and the Users screen (`feat/manager-admin-ui`), stacked in that order. They finish what 0.1 and 1.1 started for the identity path: under `authStrategy: identity` users are identities, not Postgres roles. 1.1 stays open until the cutover is run (B.6) and `CREATEROLE` is withdrawn from the framework role. Still open from this tier: 0.10, 0.11 (could not reproduce), 0.12, 0.14, 0.15.

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

- [x] **0.1 `POST /data/user-account` always fails** **[→ tenant-management-plan B.5]** with 500 (`scripts/services.js:1357`, loop runs past the end of the roles list). Users can only be created in SQL today; also `POST /data/role` with an existing login role's name sets it NOLOGIN and blanks its password (`role.js:230`), the same class as 1.1.
  *Fixed 2026-10-11 on `fix/0.1-user-account-post` (the loop itself was
  already fixed on master in 4254cf11, but the todo reporter had masked two
  remaining defects). An unset `isActive` created the role NOLOGIN, so the
  new user could never sign in; it now defaults to a login role. And
  adopting an existing cluster role now requires proving its password
  (a probe connection): the test-and-production case still works, a
  takeover -- or a group role blanking a login role's password -- gets 409.
  **Reinstall Core after merging** (deployed service). Both users-suite
  todos are promoted to live assertions, rewritten on Contact so they run
  on a bare-Core database. B.5 later replaces this path entirely.*
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
- [x] **0.10 SupplyChain** *(done 2026-10-21, PR #21: wrong id variable, the inbound move's `document`, the on-hold message, and a failed auto-post now leaves an `error` on the record and raises an Alert)*: `change-purchase-order-status` reads `ids[i]` so a single `id` gives 500; inbound move transactions have no `document`; a failed auto-post after save leaves no error on the record; `do-post-work-order-issue.js` rejects on-hold orders inside `try` without `await`, skipping error handling.
- [ ] **0.12 A new feather still defaults to everyone-everything.** *(Checked 2026-10-24 against master: `defaultAuth` is still applied on insert, `scripts/services.js` ~195. The roles work of PR #291 creates roles a feather names; it does not change the insert default. Still open.)* On
  insert, a feather that declares no `authorizations` gets `everyone` full
  CRUD (`scripts/services.js` `defaultAuth`). 0.4 fixed the update path
  only, because application modules may rely on the insert default --
  changing it needs a pass over Job Shop and SupplyChain to see which of
  their feathers declare nothing. Candidates still open on a fresh install:
  `edition`, `server_process`, `notice`, `send_mail`, `comment`, `kind`,
  `layout`, `print_form`, `system_print_form`, `country`, `state`, `unit`
  and the currency feathers.
- [x] **0.13 `POST /data/feather` crashes instead of refusing.** A
  non-super user gets 500 "Cannot read properties of undefined (reading
  'forEach')" from the Feather trigger, which runs before the create
  authorization check. The record is not created, so this is a 6.1-class
  unhandled error rather than a hole, but the denial should come first.
  *Fixed 2026-10-11 on `fix/0.13-feather-denial`: the trigger checks
  isAuthorized (canCreate/canUpdate on Feather) before touching the
  payload and rejects 401 "Not authorized to create feathers"; a missing
  properties array no longer crashes either. **Reinstall Core after
  merging** -- the trigger is a deployed data service. Test in
  authorization.test.js.*
- [ ] **0.14 User accounts have no column-level authorization.** *(Checked 2026-10-24 against master after the users redo: `UserAccount` in `feathers-bootstrap.json` still grants `everyone` read on every column, `isSuper`, `isLocked`, `signInAttempts` and `lastSignIn` included. Not tested on a live server. Still open unless the picker has moved to a name-list route, which I did not find.)* With 0.4
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
  settings row. Confirmed again on 2026-10-10 from the other direction: a
  catalog can gain a property setting but not lose one. Deleting
  `"isRequired"` from `Tenant.contact` and reinstalling Core left the old
  `true` in place, and only an explicit `"isRequired": false` overwrote it.
  So the installer applies the values a declaration carries and never
  removes the ones it has stopped carrying -- which is the same defect as
  the stale precision, and the workaround is to declare the opposite value
  rather than omit it. Caught by the catalog golden test, which had been silently
  failing -- see `fix/catalog-golden-sentinels`.
- [x] **0.16 An unknown projected property crashed the query.** Asking for a
  property a feather does not have answered `Cannot read properties of
  undefined (reading 'isEncrypted')` -- `doSelect` dereferenced `fp[key]`
  for every requested key (`crud.js` ~1844). *Fixed 2026-10-11 on
  `fix/0.16-unknown-property`: 400 naming the feather and every unknown
  property. Found while confirming the application still ran after the
  tenancy merges; `query.test.js` had carried a todo for it, and the
  coverage moved to `crud.test.js` so it does not need SupplyChain to run.*
- [x] **0.17 Resolving inheritance mutates the stored catalog.** *Fixed
  2026-10-11 on `fix/0.17-inherited-from`: appendParent and the local
  property pass now copy property objects, so neither inheritedFrom nor an
  overload default can write into the cached catalog. Self-referential
  stamps (`Role.name` carrying `inheritedFrom: "Role"` -- the bug's
  signature, never a real declaration) are repaired when getFeather reads
  them and scrubbed when a feather is saved, so reinstalling a module also
  cleans a polluted catalog row. The catalog suite's todo test for this now
  passes and was promoted to a live assertion.*
  `getFeather`'s `appendParent` (`feathers.js` ~840) does
  `childProps[key] = parentProps[key]` and then sets `.inheritedFrom` on it --
  the same object, so the *ancestor's own* property is stamped too. `Role.name`
  in `demo` reads `inheritedFrom: "Role"`, which is how it was found, and the
  value has been persisted into the `catalog` settings row. The save path
  filters on `!prop.inheritedFrom` when deciding which columns to add
  (`feathers.js` ~1993), so a feather whose own property has been mislabelled
  can have that column skipped. Fix is a copy rather than a reference; the
  care is in checking what already depends on the current behaviour, and
  whether polluted catalogs need cleaning.
- [x] **0.18 A failed install never gives its connection back, and eight of them finish an instance.** Found 2026-10-24 by the new `api/deploy-failure` suite, as a hang in a later file. `datasource.install` opens a pooled client for the work and gave it back only where the work finished, so an install that threw -- a dependency in the wrong order, a relation to a feather nothing defines, anything the installer refuses -- left it checked out for the life of the process. One connection per failure, a default pool of ten, and then every request needing a connection to that instance waits for one that is never coming: no error, no timeout, a request that never answers. Measured on a live server, deploying a package built to fail: 2 connections, then one more per failure, and at ten the next deploy never answered. *Fixed on `fix/install-connection-leak`: the work moved into a function and the connection is given back on every path out of it, the error rethrown after. Flat at 3 across twelve failures. Claim added to `deploy-failure.test.js`; it needs that suite's fixture packages, so merge `fix/stale-api-suites` first.* **Still open beside it:** `installer.js` sets `isInstalling = true` and clears it only on success, so after any failed install the process believes it is installing for ever. The one reader is SupplyChain's ShipEngine initialiser, which then waits for a restart. One line in `rollback`.
- [ ] **0.19 A read-only feather is not read only to a super user.** Found 2026-10-24 by `supplychain/inventory.test.js` ("transactions are read only over the data API"), which could not run until today. `PATCH /data/alert/<id>` as a signed-in super user answers 200 and changes the row, and `Alert` declares `isReadOnly: true`. The same goes for `InventoryTransaction`, `SalesHistory`, `InvoicePayment`, `InventoryLocation`, `InventoryValueDetail`, `PrepaidInvoiceApplication` and `ShipEnginePackage` -- the records the application computes, which is exactly where read-only matters. Two reasons, and each alone would be enough: `server.js registerDataRoute` mounts only the GET route for a read-only feather, but the write routes are there anyway (the catalog those routes were built from did not mark it, which is what the newer guard's comment anticipates); and the newer guard in `datasource.js` (405 "Feather X is read only") is skipped when `isSuperUser`, which it reads as "an internal call" although an ordinary human super user over HTTP is also `isSuperUser`. The fix wants a marker for "this request came in over HTTP" -- the route handlers know, nothing else does -- rather than super-ness, because module code legitimately writes these rows through `f.datasource.request`. Needs John's call: it changes what a super user may do, and a support fix by hand may be something you want to keep.
- [x] **0.20 A record that is not there answers 500.** `PATCH` or `DELETE` of an id nothing matches answers 500 with "Record <id> not found." (`crud.js` ~1057 and ~2639 reject a bare string or Error with no `statusCode`, and `server.js error()` defaults to 500). 0.7 fixed the message -- it used to be `"undefined" is not valid JSON` -- but not the status. 404 is the answer, and a client cannot tell "no such record" from "the server broke" until it is. *Done: `fix/0.20-record-not-found`, 2026-10-26. A record that is not there answers 404 from all three places that say so (`datasource.js` for PATCH and DELETE, `crud.js` in both of its own checks); "already deleted" is still 500.*
- [ ] **0.21 A settings link opened before sign-in breaks the page.** Found 2026-10-26. Opening `/demo/#!/settings/globalSettings` with no session renders a blank page and throws `models[options.settings] is not a function`: the router mounts the settings page before sign-in, before the settings models exist, instead of showing the sign-in form. A workbook link does not have the problem. Same on master; not caused by 4.3.
- [x] **0.11 CLI install of SupplyChain** creates money columns as `json` instead of `mono`; installing the same zip through the server's install route is correct. *Fixed 2026-10-24, and it was never the installer: `f.formats` -- the registry `feathers.js` reads to turn a property's declared format into a column type -- was set in `server.js` and nowhere else, so a process started by `install.js` had none. SupplyChain's Common module registers three formats of its own (`unitCost`, `salesPrice`, `purchasePrice`) by writing them onto `f.formats`, found nothing to write to, and gave up; the installer then found no format by that name, fell back to the property's type and wrote `json`. Every price and cost column, on any command line install. Two branches: framework `fix/0.11-money-formats-on-install` hangs the registry on `f` in `datasource.js`, which `install.js` loads as well as `server.js`; SupplyChain `fix/money-formats-registered-on-load` (root 2.2.17, Common 2.1.11) registers the formats as that module loads rather than after an awaited settings read, which could otherwise lose the race against the install even with the registry present. Verified end to end on a fresh CLI install: `product.price` was `json`, is now `mono`, 26 money columns `mono` and none `json`. `api/schema.test.js` "stores every money-format property as mono" catches a regression. The earlier closure as "not reproduced" was fair from a database installed through the server, which is the path that works.*

## How to use this plan

Work top to bottom. Tier 0 is the regression suite, already in place; Tier 1 closes security holes and Tier 2 stops wrong money and inventory numbers; both come before any performance work. Each item names what to change, where, and how you'll know it's done.

| Tier | Theme | Items | Why this order |
| --- | --- | --- | --- |
| 1 | Security | 8 | Cross-tenant access and credential exposure in a multi-tenant server |
| 2 | Data correctness | 8 | Wrong tax, costs, inventory and allocations in live transactions |
| 3 | Indexes and schema | 5 | Biggest scaling risk; cheap to fix |
| 4 | Query and request performance | 5 | Dominant cost today (planning), then round trips |
| 5 | Tenant lifecycle and connections | 6 | Orphans, leaks and pool exhaustion as tenants grow |
| 6 | Resilience and code health | 7 | Makes the rest safer to change |

Scope: framework at `867c146` (your `refactor` branch), SupplyChain `9de2417` (2.2.0), Admin Console and Job Shop 2.1.9, CronJob 0.9.34, and the local `demo` database. Details and evidence for every item are in the docs `featherbone-review-handover.md` (Phase 1) and `featherbone-review-phase2.md`. Line numbers are approximate and refer to those versions.

## Tier 1: Security

The top item is tenant role isolation: one tenant's admin can reset another tenant's user password today. The rest are credential exposure and destructive failure paths.

- [x] **1.1 Isolate tenant users from each other.** **[superseded → tenant-management-plan]** *Done in code 2026-10-15/16 by the identity work: B.8 retired the role path (no Postgres login roles, no `CREATEROLE`, sign-in by identity with `access_grant` as the entry boundary), F.1 is the two-organization isolation test this item asked for (`test/api/isolation.test.js`, checked by mutation), and since `feat/global-usernames` (2026-10-21) a username is unique across the installation, so the original attack (creating a user in organization B with organization A's username) cannot be made. What remains is operations, not code: run `migrate-identities`/the self-upgrade switches on each real installation (see `tenant-management-plan.md`).* **[was: partial fix at A.5]** Users are cluster-wide Postgres roles, and creating a `UserAccount` whose role already exists runs `ALTER ROLE … PASSWORD` on it.
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
- [x] **1.4 Remove drop-on-failure from `createDatabase`.** *Done 2026-10-13 on `fix/d2-database-api` (tenant plan D.2): a name already taken is refused and never dropped, the rollback drops only a database the call created, the name is normalized before `pg_database` is checked, and `conn2` is guarded in the `finally`.* If `CREATE DATABASE` fails because the name exists, the catch fires an un-awaited `DROP DATABASE IF EXISTS`.
    - Where: `server/datasource.js` ~332–400; duplicate check in Admin Console `triggers-tenant.js` runs before name normalization.
    - Fix: only drop a database this call created; check `pg_database` after normalizing the name; guard `conn2` in `finally`.
- [ ] **1.5 Close the Zip2Tax path traversal.** *Still open (2026-10-24), and the same hole exists in `common/do-consolidate-print.js`, which reads, merges and deletes any PDF its client-supplied names reach.* The file path comes from the client's `filename`, is read, then deleted.
    - Where: SupplyChain `sell/do-zip2tax-import.js:22,116`.
    - Fix: accept only an upload id or `path.basename`, resolve inside the upload folder, and verify it stays there.
- [x] **1.6 Fix the login connection leak.** **[deleted by tenant-management-plan B.2 — no connection is opened as the user]** Each failed sign-in strands a pooled connection and creates two new pools.
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

## Tier 2: Data correctness (done 2026-10-24; residuals listed under each item)

These are SupplyChain bugs that change tax, cost, inventory and allocation figures, plus the framework's non-unique natural keys. Start with 2.1 and 2.2: they are small edits with large blast radius.

- [x] **2.1 Remove mid-transaction `COMMIT`s.** *Done 2026-10-21, `fix/2.1-no-mid-transaction-commit` (PR #22). Not run on a server.* Four services commit on the request's own client, often un-awaited, so later work runs in autocommit and rollback hooks and advisory locks are lost.
    - Where: `design/do-roll-up-costs.js:246`, `design/do-update-proposed-costs.js:39`, `sell/do-zip2tax-import.js:48` (also un-awaited `DELETE FROM tax_rate`), `plan/do-clear-allocations.js` (own `BEGIN`/`COMMIT`).
    - Fix: delete the `COMMIT`s and await the statements; if a subscription cleanup must be isolated, use a separate connection.
- [x] **2.2 Round tax correctly.** *Done 2026-10-21, `fix/2.2-round-tax` (PR #23); also fixes the client's freight tax. Not run on a server.* `Math.round(ttl, 2)` ignores the second argument, so tax rounds to whole units.
    - Where: `bill/do-create-shipment-invoice.js:153`; unrounded line and discount amounts in `sell/triggers-sales-order.js` ~171–186.
    - Fix: `ttl.round(CURR_SCALE)` and round line amounts at the currency scale.
- [x] **2.3 Lock before reading in posting functions.** *Done 2026-10-21, `fix/2.3-lock-before-reading` (PR #24), with a transaction-scoped advisory lock waited on before the read (sorted ids so overlapping posts cannot deadlock) rather than the application lock, which is only cleared when a record is updated. Shipment invoicing gained an `isInvoiced` guard. **Not yet done:** the ship functions still read the shipment before locking it, and the concurrent-posting test under Verification is still to run.* Status is read before the lock, so two concurrent posts can both see status P and both post inventory.
    - Where: `buy/do-post-purchase-order-receipt.js` ~66–135, `make/do-post-work-order-receipts.js`, `make/do-post-work-order-issue.js`, `stock/do-post-inventory-adjustment.js`, `count/do-post-physical-count.js`; same pattern in `bill/do-apply-invoice-payment.js` and prepaid application in `do-create-shipment-invoice.js`.
    - Fix: claim the document atomically, e.g. `UPDATE … SET status = 'R' WHERE id = $1 AND status = 'P' RETURNING`, or lock then re-read.
- [x] **2.4 Make actual-cost totals one shared calculation.** *Done 2026-10-21, `fix/2.4-actual-cost-totals` (PR #25): total is the sum of the four buckets in WO receipts, operation completion, WO issue and shipping; shipping puts the unexplained part of an item's cost in material. Existing totals correct themselves only on their next posting. The three copies are still three copies (see 6.3).* Three copies of backflush and cost logic accumulate totals differently; at least two double-count, and shipping never adds labor or overhead.
    - Where: WO receipts ~609–801, `make/post-operation-completion.js` ~254–439, `make/do-post-work-order-issue.js` ~161–398, `ship/do-ship-sales-order-shipment.js` ~361–375.
    - Fix: one helper where total = material + labor + overhead + service, used by all paths.
- [x] **2.5 Fix allocation drift.** *Done 2026-10-21, `fix/2.5-allocation-drift` (PR #26). Not run on a server.* `inventory.allocated` and `supply.allocated` diverge from allocation rows; manual WO issue never relieves allocations.
    - Where: `plan/do-transact-allocated.js` ~427–540; `make/do-post-work-order-issue.js:269` compares to `"issue"` but the value is `"issued"`.
    - Fix: accumulate after the negative on-hand adjustment; subtract only what was actually deallocated; fix the string.
- [x] **2.6 Make natural keys unique in the database.** *Done 2026-10-11 on
  `fix/2.6-natural-key-unique`, together with 3.3.* A natural key was a plain
  index, so uniqueness lived only in `crud.js` and two concurrent inserts
  could both pass the check. It is now a unique index partial on
  `NOT is_deleted`, built on the declaring table **and on every child**, and
  rebuilt rather than skipped so an existing database is upgraded. A database
  holding duplicates is told which feather, which value and which table.
    - **Still open: uniqueness across a hierarchy.** Postgres cannot span
      inheriting tables with one index, so a `Role` and a `UserAccount` may
      still share a name, and Item/Demand/Supply the same. Needs a shared key
      table or a trigger. **This matters more since ADR-002**, which makes
      extension-by-inheritance the supported way for a customer to add
      columns -- a customer's subclass can otherwise escape the parent's key.
- [x] **2.7 Void ShipEngine labels on rollback.** *Done 2026-10-21, `fix/2.7-void-labels-on-rollback` (PR #27): every bought label is voided from a separate request on rollback, with a Critical Alert if ShipEngine refuses.* Labels are bought over HTTP inside the ship transaction; the ids kept "in case of reject" are never voided.
    - Where: `ship/do-ship-sales-order-shipment.js` ~193–237, `do-ship-outside-process-shipments.js` ~121–165, `do-print-shipment-labels.js` ~81–91.
    - Fix: void in `client.onRollback`, or buy labels in a separate committed step keyed on the shipment.
- [x] **2.8 Fix invoice, history and closure bugs.** *Done 2026-10-22, `fix/2.8-invoice-history-closure` (PR #28), five commits. Left open: invoice history `shipment` and `site` are always empty (Invoice has no `shipment` property); the prepaid-invoice PATCH still uses `oldRec.total`; leftover locks after invoice payments.*
    - `bill/triggers-invoice.js` reads `ln.shipment` and `ln.unitPrice`, which don't exist, so sales history gets `shipmentLine` 0 and `unitPrice` null; several `number === object` comparisons never fire.
    - Prepayment loop in `do-create-shipment-invoice.js:171` never stops at zero balance.
    - `let del` outside loops writes history for the last allocation only: `make/triggers-work-order.js:68`, `buy/triggers-purchase-order.js:70`, `plan/triggers-planned-order.js:113`.
    - `buy/do-convert-planned-purchase.js:161` uses `d.ids[0]` every pass; PO receipt posting never resets `j`, skipping later receipts' lines.
    - Tax lookup in `sell/do-get-address-tax-rates.js` matches the city with an unanchored regex, `LIMIT 1` and no `ORDER BY`, so it can pick the wrong jurisdiction.

## Tier 3: Indexes and schema

In `demo`, all 364 relation columns across 127 tables have no index and no foreign key, and inherited indexes exist only on empty parent tables. Doing 3.1–3.3 as a migration per tenant database is fast; 3.4 stops the problem recurring.

- [x] **3.1 Index every relation column.** Views run a correlated subquery per row on these columns, so every list page scans each child table once per parent row. *Done 2026-10-11 on `fix/3.1-relation-indexes`, two mechanisms: feathers.js indexes relation columns whenever a feather is saved (the 3.4 half, walking the inheritance chain the way 2.6 does for natural keys), and `scripts/relation-indexes.js` sweeps the whole database at install, so existing databases and tables whose feathers are managed elsewhere are covered. **Reinstall Core (or any module) after merging to backfill.** The schema suite's 3.1 todo is promoted to a live assertion.*
    - Run the generator below per tenant database, review the names (63-character truncation can collide), then apply with `CREATE INDEX CONCURRENTLY` on live data.
- [ ] **3.2 Add item/site composite indexes.** SupplyChain's raw SQL filters on `(_item_item_pk, _site_site_pk)` constantly.
    - Tables: every `demand` and `supply` child (`sales_order_line`, `work_order_requirement`, `sales_order_requirement`, `outside_process`, `purchase_order_line`, `work_order`, `inventory`, `planned_order` and its children), plus `inventory`, `item_site`, `inventory_transaction`.
    - Also: `allocation(_demand_demand_pk)`, `allocation(_supply_supply_pk)`, `product_bill_of_material_item(_product_product_pk)`, `tax_rate(zip_code)`.
- [x] **3.3 Put natural-key and status indexes on child tables.** *Done
  2026-10-11 with 2.6: the index builder walks the inheritance chain, so an
  inherited natural key or `isIndexed` property is indexed on each table that
  carries rows rather than only on the ancestor that declared it.
  `user_account(name)` -- the login lookup -- had no index at all.*
    - Missing on children of: `demand` (number, status), `supply` (number, status), `item`, `operation`, `invoice`, `receipt`, `shipment`, `container`, `resource_group`, `task`, `carrier`, `package_type`, `ship_method`, `unit`, `kind`, `layout`, `script`.
    - Also `user_account(name)`, the login lookup.
- [x] **3.4 Change the framework DDL.** Make `feathers.js` create an index for every relation column and repeat inherited index and natural-key definitions on each child table when a feather is created or altered. *Done 2026-10-24: relation columns and natural keys were done with 3.1 and 2.6, inherited `isIndexed` definitions repeat on children since 2.6's chain walk, and the last bullet (`isIndexed` on a relation property named `key.toSnakeCase()`, a column a relation does not have, and failed the whole feather save) is fixed on `fix/3.4-indexed-relation`: relation properties are left to the relation indexes. No shipped feather set the flag, so nothing was failing. Test added to `schema.test.js`.* *Second half 2026-10-24 on `fix/stale-api-suites`: the flag is pushed to the index list in two places and the first fix changed one, so a feather declaring `isIndexed` on a relation still failed with `column "partner" does not exist`. The test written with the first half is what caught it.*
    - While there: fix `isIndexed` on relation properties, which indexes `key.toSnakeCase()` instead of the `_<key>_<relation>_pk` column.
- [x] **3.5 Decide on foreign keys.** *Decided no, 2026-10-24 (John). Foreign keys add nothing to read speed (3.1's indexes do that) and add a check on every write of a referencing row and a scan on every delete of a referenced one, and they impose an order on writes, parents first and children first on delete, which the framework's transaction code does not keep. Relations to inherited feathers (Item, Demand, Supply, Contact) cannot use a plain foreign key at all, because a parent table's key does not see its children's rows. Rows are soft-deleted, so the orphaning a foreign key guards against mostly cannot happen. The earlier attempt, long ago, ran into the same ordering cascade. Revisit only if orphaned relation values are actually found.* None exist today, so nothing stops orphaned relation values.

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

- [~] **4.1 Cache query plans.** The framework sends unnamed parameterized queries, so every request replans.
    - Fix: named prepared statements (`{name, text, values}` in `pg`) for stable `doSelect` shapes, so each connection caches the plan.
    - Done when: repeated form loads show planning near zero in `pg_stat_statements`.
    - *Written and measured 2026-10-24 on `feat/4.1-named-statements`, not
      merged. `tools.prepared` names a statement by a hash of its text, every
      value being a bound parameter already, and a connection stops naming new
      shapes at 200 because node-postgres never drops a prepared name.
      `FB_UNNAMED_SQL=1` turns it off, which is how these numbers were taken:
      300 list reads (purchase orders, work orders, sales orders, ten rounds)
      against a freshly installed `demo`.*
    - *Unnamed: 1309 ms and 1433 ms wall, 949 ms and 1038 ms of planning.
      Named: 496 ms and 516 ms wall, 274 ms and 285 ms of planning. So two and
      a half times faster, and planning falls by about 70%. It does not fall
      to zero because Postgres plans a named statement afresh for its first
      five executions before it settles on a generic plan -- with a ten
      connection pool that warm-up is paid up to fifty times per query shape,
      which is an argument for 5.1's smaller pools.*
    - *Risk checked: a view rebuilt under a cached plan. Adding a property to
      a feather and reading its list again behaves identically named and
      unnamed (both answer "column \"note\" does not exist" until the view
      is rebuilt), so naming does not add a failure there. The
      "cached plan must not change result type" error looks unreachable here
      because `doSelect` always names its columns and returns one json
      column. `api/query` (33) and `api/crud` (42 of 43, the one failure
      environmental) pass with it on.*
    - *Left to decide: whether this and PgBouncer in transaction mode can
      coexist (they cannot -- named statements do not survive it), which 4.4
      and 5.1 both touch. And 4.2 removes the cost rather than hiding it: the
      planning is expensive because each view is an Append over every child
      table. If only one of the two gets done, 4.2 is the better buy.*
- [x] **4.2 Slim the generated views.** Each to-one relation to an inherited feather becomes an `Append` over every child table, nested up to 3 levels (24 subselects per `ShipmentInvoice` row).
    - *Done: `fix/4.2-narrow-views`, 2026-10-26.* The cost was not the subselects but what they named. Each relation view (`_<feather>$<property>`, e.g. `_invoice$customer`) lists only a few properties but read them from the related feather's **full** view, and Postgres expands every view a view names before it drops the unused columns. So a read cost the size of the whole view graph underneath it, whatever columns it asked for: `_shipment_invoice` expanded 6,220 views, took 67 ms to plan for `id` alone, and one invoice's form load on John's demo planned for 405 ms and ran in 3 ms. Relation views now read the related **table**, through one `columnSql` helper the full view uses too. On the sandbox: `_shipment_invoice` whole row 195 ms to 2.6 ms, `_purchase_order_receipt_line` 144 ms to 0.4 ms, `_sales_order` 7.2 ms to 1.4 ms. Every full view is byte-identical, every relation view returns identical rows (474 views on the sandbox; the heaviest ten also checked read-only against John's demo, including 101,264 demand rows), column types unchanged so the schema goldens stand. `test/api/relation-views.test.js` claims both. Lists were never the separate problem: they already ask for fewer columns, but paid the same expansion. The original "list view" and `LEFT JOIN LATERAL` suggestions are dropped: the first already existed in all but name, and execution was never the slow part. The inheritance `Append` is real but sits inside the 1-3 ms of execution. With planning this cheap, 4.1's named statements matter much less. Needs the views rebuilt: Core 3.0.0-alpha.8.
- [x] **4.3 Cache form and catalog metadata in Node.** `form_attr_column` was scanned 3,044 times in a few minutes of use.
    - *Done differently: `fix/4.3-sign-in-loads-once`, 2026-10-26.* Metadata is not read per request. Measured in the sandbox: 40 list and single reads touched no form, catalog or settings table (the catalog is already cached in Node), and the database work per request was about 1 ms. Forms, catalog, modules and workbooks are read once per page load, which the client keeps current through its subscription. The scan counts were the forms read itself: on John's demo it plans in 8 ms and runs in 41 ms, and its 1,520 attribute rows each probe the five layout tables for a relation widget, about 7,600 scans per read on tables small enough that a sequential scan is the cheapest plan. 614,787 scans of `form` is roughly 80 sign-ins, not steady traffic. What did repeat: every interactive sign-in loaded all of it **twice**. `main.js` ran `start()` without waiting, then `window.history.go(0)` reloaded the page so a fresh, already signed-in page could finish the job (back since "Async fixes to startup", 2023-09-18). The reload also fetched who had signed in and an event key for the new session, which the sign-in path never asked for. Now the sign-in path asks `/connect` for both, as the two-factor path already did, and routes once `start()` has finished. Sign-in to a settled home page: 1.4 s to 0.4 s in the sandbox, catalog (388 KB), modules (415 KB) and forms (808 KB) fetched once. Checked in a browser against master: the same home page, banner and enabled buttons; sign-out in another tab still reaches this one (it does not with the key from before sign-in); a deep link and a forced password change land where they did. Not checked: the two-factor path end to end (it already fetched its own `/connect`). A server-side form cache is not worth building for ~50 ms a page load with the invalidation it would need across nodes.
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

- [ ] **5.1 Size and close tenant pools.** **[→ tenant-management-plan E.4]** *Worth doing for a reason 0.18 showed: the pool has no acquire timeout, so a client that is never given back turns into a request that waits for ever instead of an error anybody could see. Whatever the leak, a timeout would have named it.* Each tenant gets a 10-connection pool (the `pgMaxConnections` setting is ignored), one held permanently for LISTEN; each sign-in opens 2 more pools; each SupplyChain `f.datasource.lock` takes 2 extra connections.
    - Fix: honor `pgMaxConnections`, lower the per-tenant max, set `idleTimeoutMillis`, end pools for idle tenants, and run PgBouncer in front. Fix the SSL config the code comment flags.
- [x] **5.2 Fix the tenant registry leaks.** *Done 2026-10-13 on `fix/d3-tenant-registry` (tenant plan D.3), with the last two bullets already covered: `cleanupProcesses` walks every instance, and routes mount once.*
    - `deleteDatabase` calls `tenants.splice(idx, 0)`, which removes nothing (`server/datasource.js:438`).
    - `loadTenants()` only ever adds; deleted tenants keep their pool, listener and `pools[db]` entry.
    - `cleanupProcesses()` uses `tenants[0]` in its loop, so only the first tenant is cleaned after a restart (`datasource.js:524`).
    - Route re-registration appends duplicate Express handlers on every Route change.
- [ ] **5.3 Make provisioning atomic and resumable.** **[→ tenant-management-plan D.1]** `CREATE DATABASE`, writes to the new databases, and emails all run inside the admin transaction; a late failure leaves orphan databases and a notice that can't be reprocessed.
    - Fix: a provisioning state table (requested, db created, configured, emailed) with idempotent steps; create and drop databases in `onCommit`, not in AFTER triggers.
- [x] **5.4 Make template creation safe** *Done 2026-10-13 on `fix/d2-database-api` (tenant plan D.2): built under a working name and swapped, `ALTER DATABASE … IS_TEMPLATE`, a busy source refused rather than disconnected, and `port: conf.pgPort || 80` gone.* (`createTemplateDatabase`).
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

- [~] **6.1 Stop unhandled rejections from crashing the server.** **[→ tenant-management-plan E.5]** *Handler done 2026-10-11 on `fix/6.1-unhandled-rejection`: `unhandledRejection` logs the stack and the server keeps serving (verified: a floated rejection, then HTTP 200). `uncaughtException` deliberately left fatal. Hunting down the floating rejections themselves stays with E.5.* There's no `unhandledRejection` handler, and on Node 15+ one floating rejection kills the process.
    - Add a process-level handler that logs and alerts.
    - Fix the sources: `plan/do-transact-allocated.js:54` and `sell/do-sales-order-hold.js:66` (reject without `return`); un-awaited Alert requests in `ship-engine/do-import-ship-engine-carriers.js`; un-awaited `client.query` in `make/triggers-work-order.js:864`; the `onCommit` Alert without `catch` in `do-transact-allocated.js` ~166–182.
- [ ] **6.2 Remove multi-tenant shortcuts in app code.** **[→ tenant-management-plan E.5]**
    - `new f.PgClient({database: config.pgDatabase})` fallbacks query the system database, not the tenant's, and have no `finally` (`design/do-indented-bill-of-material.js`, `do-indented-where-used.js`).
    - `common/money-formats.js` sets global `f.formats` from the default
      tenant. *Half of this moved with 0.11 (2026-10-24): the formats are
      registered as the module loads, so an install cannot miss them. What
      stays here is that the scales are still read from one tenant's
      `commonSettings` into a process-wide registry, so two tenants that
      choose different decimals share whichever read last.*
    - Per-process `pending` guards in ship and issue code: replace with database locks; the `splice(-1, 1)` path removes another request's id.
- [ ] **6.3 De-duplicate posting logic.** Backflush and cost logic exists three times, `calcAvail` twice, the trace-fetch loop three times; receipts patch materials by `indexOf` while others use `sequence - 1`.
- [ ] **6.4 Remove or fix dead code.** `stock/do-calculate-inventory-report.js` is routed but can't run; `stock/triggers-item.js` loads whole tables to test `.length`, puts `limit` where the framework ignores it, and uses `return` where `continue` is meant; `make/post-operation-completion.js:521` stores `f.today` uncalled.
- [~] **6.5 Upgrade the runtime and dependencies.** `npm audit` reports 20 vulnerabilities, 11 high, including `ws`. Pin the `shipengine` version in the ShipEngine manifest.
    - *Note (2026-10-18): the Node floor moved to 20 for 3.0 (`package.json` engines, README) -- the part of this item the README staleness was about. The `npm audit`/`ws` and `shipengine`-pin work is still open, and is a SupplyChain concern rather than the framework's.*
    - Note (2026-10-06): do not use `npm audit fix --force`; it downgraded `pdfjs` to 0.5.4 and broke the server. Take dependency bumps one at a time (dependabot PRs), with `npm test` after each.
- [ ] **6.6 Add tests and CI.** *Before CI: the integration suites only run against a `demo` that was once a combined database. A `demo` built by a current installation is an instance and carries no registry tables, so `identity-model` (12 claims), `manager`, `security` and `users` read tables and feathers that are not there -- the suites ask the instance for `identity`, `organization`, `access_grant` and `TenantService`, which now live in the manager. Found 2026-10-24 by running the suites against a database built with `node install --instance`. They need to ask the manager copy (the harness already brings it current) before any machine but John's can run them.*  Start with the paths this plan touches: posting (2.3), cost totals (2.4), allocations (2.5), tenant create and delete (1.4, 5.3), and the two-tenant role test (1.1). Split `crud.js`, `datasource.js`, `server.js` and `table-widget.js` (2.5–3k lines each) as you go, and settle on `async`/`await` over the `afterX` callback chains.

- [x] **6.7 Rethink how settings are saved, starting with the "changed by another user" failure.** Long-standing (John, 2026-10-24): `Settings for "catalog" changed by another user. Save failed.` turns up whenever an install fails, and after other complex transactions that roll back. Nobody else changed anything.
    - Cause (read from `server/services/settings.js`, not yet reproduced): `saveSettings` writes the new data and etag into the process-wide `dbsettings` cache as soon as its `UPDATE` runs, inside the request's transaction (`done()`, ~line 770). Nothing undoes that on rollback. The database row goes back to its old etag while the cache keeps the new one, so the next save compares the cache's etag with the row's (~line 845) and refuses. It keeps refusing until the process restarts or something reloads the entry. The cache also hands out the rolled-back values to readers in the meantime, and a second server process holds its own copy.
    - The catalog is the usual victim because every feather save rewrites it (`feathers.js` ~729, ~2644), so one failed install poisons the next attempt, which then fails on a different error from the real one. Seen on 2026-10-24: a failed SupplyChain deploy, then a retry failing on the catalog etag.
    - Fix: update the cache only on commit (`client.onCommit`) and drop the entry on rollback (`client.onRollback`; the installer now runs those hooks when it rolls back, which it did not before). Take the conflict check from the row itself, read with `SELECT ... FOR UPDATE`, not from a cache that can be ahead of it. Then decide whether the etag comparison against the cache is needed at all.
    - Related: the installer saves the catalog many times per install, each a read-modify-write of one large row. Saving it once, at the end, would shrink the window and the cost. Compare 0.15, which is also a catalog-update defect.
    - Done when: a test makes a request that saves settings and then fails, and the next save of the same settings succeeds without a restart. A failed install followed by an immediate retry gets past the catalog.
    - Resolved 2026-10-24: `saveSettings` registers a rollback hook that drops the row's cache entry, keyed to the transaction's own `rollbacks` array (a guard on the pooled client outlives the transaction -- the first fix missed this, and the second failed install on a recycled client re-poisoned the cache). The installer's rollback now runs its own connection's hooks as well as the caller's. The conflict check reads the row (`SELECT ... FOR UPDATE`), not the cache, which also ends the spurious multi-node refusal. Reproduced and regression-tested in `deploy-failure.test.js` via a clean feather in `fbtfail` that rewrites the catalog before the broken one fails; the follow-on `fbtseed` deploy is the "done when" retry. The cache handing uncommitted values to OTHER requests mid-transaction, and the organization share committing on a separate connection, remain as recorded above.

- [x] **6.8 Build the production client with one command.** Found 2026-10-26. `client/clientmin.js` had not been rebuilt since 2.2.0, and the command that built it (`terser` over a hand-kept list of files, run from `client/`) was never comprehensive: it concatenated files as scripts, which cannot work once files import one another, and its list had fallen behind `index_debug.html`. The bundle was missing nine components (`ribbon`, `toolbar`, `dashboard`, `adminPage`, `adminInstancesPage`, `connectionBanner`, `envBanner`, `homeDialogs`, `imageUploadWidget`) and three view models, so none of the Users and Instances screens, the ribbon or the dashboard appeared without `"debug": true`; `index.html` also lacked `print.css`, and listed `models/feather.js` ahead of the bundle by itself.
    - *Done: `feat/minify-client-script`, 2026-10-26. `npm run build:client` (`scripts/build-client.js`, esbuild) takes the module scripts `index_debug.html` names, in order, and bundles and minifies them with their imports (big.js is inlined rather than fetched at run time), then writes `index.html` from the debug page: one bundle in place of the module scripts, `.min.js` vendor files where they exist. `index_debug.html` is the single list. `-- --check` changes nothing and fails if either file is stale; `-- --sourcemap` writes a map. `test/unit/build-client.test.js` fails when `index.html` is not what the debug page produces or a client file is left out of the bundle. Bundle 255 KB to 419 KB (118 KB gzipped) because it now holds the whole client. Verified in headless Chromium: the debug page and the bundled page register the same 45 components, 23 view models, 36 models and 26 global entries, with the same errors (the page has no server behind it). Not run: a signed-in session against a live server with `"debug": false`.*
    - *Rebuild and commit `clientmin.js` with any change under `client/`; two open branches that both do will conflict on the generated file, and the answer is to rebuild, not to merge it by hand. The linter shim (`javascript-lint.js` with the 500 KB `jslint.mjs`) and `common/*.js` stay separate scripts.*

- [ ] **6.9 Stop queueing queries on a busy client.** Found 2026-10-28. John sees `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0` in the server log from time to time. Harmless today: pg 8 queues the second query behind the first and runs them in order. It is a problem only if `pg` moves to 9 (the manifest allows `^8`, so nothing upgrades by itself). Node prints a deprecation once per process, so the log shows the first site hit since the last restart, never the rest.
    - Found by wrapping `Client.query` to log every call made while the client's queue was not empty, then running the api suites (SupplyChain not run). Sites in the framework: `crud.doDelete` (child deletes started with `forEach` and not awaited, then the parent delete queued behind them: also means a failing child does not stop the parent delete); `events.doSubscribe` (one `INSERT` per id, queued together); `feathers.saveAuthorization` called from `Promise.all` on one client (`installFeathers`, `workbooks.js`), each call running `getKey`, `isSuperUser` and the write.
    - Same pattern, not yet seen firing: `Promise.all` over one client's queries in `installer.js` (module delete, about a dozen `DELETE`s), `events.js` (tenant subscribe), `navigation-categories.js`, `packager.js` (dashboards and settings), and `getFeathers` (`frequests`).
    - Fix: run them one after another (`for ... of` with `await`); where order does not matter and speed does, one set-based statement (`= ANY($1)`, `unnest`) instead. Do not use a second client to get parallelism: a transaction owns its client. App code has the same shape wherever it floats a `client.query` (6.1 lists `make/triggers-work-order.js:864`).
    - Test: wrap `Client.query` in the harness and fail a run on any call made while another is active, which also keeps the pattern from coming back. Then `pg@9` is a version bump rather than a hunt.

## Verification still to do

Three findings were traced in code but not yet proven by running them; confirm them on a writable scratch copy of `demo`, not `demo` itself.

- [ ] **Two-organization isolation test** for 1.1 **[→ tenant-management-plan F.1]**: create a user in organization B with an organization A username, then try to set A's password and sign in to A.
- [ ] **Concurrent posting test** for 2.3: post the same PO receipt from two sessions at once and check inventory.
- [ ] **Production-scale timings** for Tiers 3 and 4: `demo` is 26 MB with at most 400 rows per table, so index gains won't show until you load realistic volumes.
- [ ] **Unreviewed code and data:** client-side Mithril code (`module.js`, `forms.json`) was only sampled, and the other local databases (`ddom`, `demo_dci`, `featherbone_llc`, `scheduling`) weren't reviewed.
