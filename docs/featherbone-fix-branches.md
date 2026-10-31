> Copied from the Featherbone Claude project into the repo on 2026-10-06.
> Update 2026-10-06: the local checkout is now `Documents/featherbone` (a fresh
> clone of `jrogelstad/featherbone`); the old `Documents/Featherbone` folder,
> including `claude-branches/`, was deleted. `fix/test-battery` is merged (PR
> #125), so nothing from that folder needed recovering.

# Featherbone fix branches: how they're delivered, and status

Read this together with `featherbone-review-handover.md`. Started 2026-10-01.

## Open, 2026-10-27 (tenth round): module tests live in their modules

John, 2026-10-27: "unit tests for specific supply chain functionality
should live within their respective modules within supply chain". Decided
in `docs/adr-003-module-tests-and-help.md`, which also covers help (not
built yet). Three branches; **merge in this order**, the first two in
`jrogelstad/featherbone`:

1. `docs/adr-003-module-tests-and-help` -- the ADR.
2. `feat/module-tests` (on the first). `test/run.js` reads the copy's
   `module` rows and runs the `test/` folders of each deployed package and
   the modules it carries. Only the version deployed in the source database
   is tested. `Package@version` deploys that version into the copy first,
   and `--package <dir>` deploys a working copy from a scratch modules
   directory. Module tests reach the harness as
   `require("featherbone-test")` (`test/export`, on `NODE_PATH`), golden
   files can sit beside a module's tests (`golden.at(__dirname)`), and the
   reporter names module files `<module>/<version>/...`.
   `test/supplychain` and the SupplyChain builders in
   `test/harness/fixtures.js` are removed. Installing a package from a
   directory no longer copies its `.git`, with a unit test for that.
3. `feat/module-tests` in `jrogelstad/SupplyChain`: the nine suites, their
   three helpers and the builders, moved into the sub-modules. Version
   2.2.39, rebased on SupplyChain main after #56-#58.

Merge 2 and 3 together: core without 3 runs no SupplyChain tests, and 3
needs 2's `featherbone-test`. After merging, install and deploy SupplyChain
2.2.39 into `demo`, or run `node test/run.js SupplyChain@2.2.39`. That
version needs `money_base()` from framework #372, so upgrade the instance
first (`node install.js --instance demo`). **Proved
in the cloud sandbox** with SupplyChain installed from its repo HEAD (the
first time it has installed there). The moved suites give 154 pass / 1 fail /
27 todo, identical to the old `test/supplychain` run on the same database:
the one failure (`inventory` "transactions are read only over the data
API", 500 against 404) and the 16 todo tests that now pass are the same in
both runs, and again after rebasing all three on the new masters. Unit 473
pass. `api/crud` and `api/catalog` fail as on master
here, for want of Job Shop.

## Merged, 2026-10-25 (ninth round): the dashboard, used in anger

John ran the dashboard against his own data all day and reported as he went.
Everything here is merged to master (featherbone PRs #343-#359, SupplyChain
#49-#51). The build status lives in the project doc
`claude/featherbone-dashboard-build-status.md`; this is the branch record.

- **Drill-down** (#355, #356, #358, #359; SupplyChain #51). Clicking a measure
  row opens the records behind it in a modal list -- a *copy* of a worksheet's
  configuration, never a reference to one, so reconfiguring or deleting the
  worksheet cannot break it. A source answers `drillFor(tile, row)`; a row it
  says nothing for is not clickable. No edit mode, no import, none of the
  worksheet's own actions. Three things came back from John's first use: a
  record now opens as its own page rather than inside the dialog (it had
  neither the back button nor room to draw), Sort and Filter are rendered
  *beside* the drill-down rather than inside it (a modal opened inside a modal
  paints in front but will not take a click) and inside a `.pure-form` wrapper
  (without one, Pure leaves selects and inputs as raw browser widgets), and the
  list is reopened when the back button returns to the board.
- **Two components drew the view model they were born with** (#356, #359).
  `dialog.js` and `button.js` read `vnode.attrs.viewModel` in `oninit`, which
  runs once, so swapping in a new view model left the old one on screen: a
  second drill-down showed the first one's title, and its Close button closed a
  dialog that had already gone. Both now prefer what they are handed on each
  draw. A no-op for every caller that passes the same view model every time,
  which is all of them today.
- **The board is 24x16 rather than 12x8** (#355), halving the step a tile moves
  and resizes by. Everything stored is in the old units and is scaled on the
  way in -- saved layouts and the draft (by a layout's new `grid`), the tiles a
  package ships, and `defaultTile` (by its own `grid`). A layout saved from now
  on records its board so it is not scaled twice.
- **Package branding carries an icon** (#350), a sibling `icon.png`/`.jpg`/
  `.jpeg`/`.svg`, shown in the ribbon and as the favicon, travelling with every
  export the way the title does. The wallpaper now blends across the whole
  dashboard page rather than stopping at the tile grid (same PR), with a
  surface behind the title that fades out to the right (#351 follow-ups).
- **Exporting a module carries the layouts people built** (#352). Save Layout
  records no module, so a layout built on the Home tab had a blank one and
  belonged to no export -- a package shipped the wallpaper and no boards. A
  top-level export now takes the unowned layouts too and stamps them with its
  own module. Caveat worth knowing: on an instance holding layouts for several
  applications they all go to whichever module is exported.
- **Lists kept their totals below the bottom of the window** (#353). The
  interface is drawn at `--fb-ui-scale`, and `table-widget.js` measured the room
  it had in real viewport pixels but assigned it as a CSS height, which the zoom
  then stretched: every list came out about 13% too tall and its sticky totals
  footer sat off-screen. Also the likeliest explanation for the older "board
  frame runs past the viewport bottom" oddity.
- **The due-date histogram starts where the data does** (#349) rather than
  drawing the whole fixed lookback, and **a source may format per tile**
  (#354, `formatFor`) so inventory value can be money while inventory quantity
  is a count on the same source.
- **Inventory on the dashboard** (SupplyChain #50): `bi.inventory_daily` holds
  each day's net change to the balance, so one table answers both "on hand now"
  and "on hand a year ago" with no snapshot to keep. Tiles by product, category,
  group and source; an Inventory Value metric. Reconciles to `Inventory`'s own
  quantity and total value for every product and site in demo.
- **The Add Tile metrics picker is two lists** (#357), John's own work brought
  over from his working copy, plus a fix: the halves are one grid now, so the
  label, filter box or hint, list and arrows line up across them by
  construction rather than by matching heights.
- **Tests** (this round): 443 unit tests, up from 428 at the start of the day.
  New coverage for the grid migration, `formatFor`, the drill-down's
  configuration and read-only manners, both view-model staleness bugs, and the
  package export (unowned layouts, the icon). The histogram trim is **not**
  covered: its columns are SVG measured against a DOM, and the unit harness has
  none.

## Open, 2026-10-24 (eighth round): SupplyChain on disk

Found by John running SupplyChain after the "deploy writes no code rows" change:
"Apparently we broke it" (Products workbook, then almost every screen, then the
indented BOM and where-used prints). Three framework fixes, all on
`fix/nested-package-modules` and merged to master (PRs #282, #283, #287).

- **Modules nested inside an umbrella package are found on disk.** SupplyChain is
  an umbrella: its manifest lists `common`, `sell`, `buy`... as `install` files,
  each with its own manifest, services, client script and routes. `packages.scan`
  indexed only top-level `modules/<name>/<version>/`, so `resolve("Common", v)`
  found nothing; with rows no longer written, a deployed Common had an empty
  client script, the formats `unitCost`, `salesPrice` and `purchasePrice` were never
  registered, and screens failed with `reading 'isMoney'`. `scan` now indexes
  nested modules by their own name and version, kept apart from the installed
  list (`installed()`, `newest()` and `remove()` still speak of what was
  installed). A path that leaves the package is ignored, and a module installed
  on its own wins over the copy inside an umbrella. A nested module with no
  `package.json` takes its libraries from the umbrella's.
- **`saveModule` stops blanking scripts.** It sent `script: ""` for an existing
  module; a POST over an id keeps properties it does not carry, so it now omits
  the script for a module that exists.
- **A super user's browser got no client code.** `fromPackage` in `datasource.js`
  left rows untouched for any request made as a super user, and the query route
  passes the signed-in user's `isSuper`. With every row empty, a super user
  received no code for Core or any packaged module. Everyone now gets the file.
- **Libraries a manifest declares are loaded.** A packaged module's `ModuleNpm`
  rows stop being read, and an umbrella's `package.json` names only what the
  umbrella declared, so `f.Fs`, `f.NodeFetch`, `f.PgClient`, `f.Qs`, `f.Xlsx` and
  `f.Shipengine` stopped loading once nested modules were found
  ("Cannot read properties of undefined (reading 'readFileSync')" on the
  prints). `packages.libraries` now adds each manifest's own `npm` list under
  the names `ModuleNpm` gave them; a `package.json` wins where both name one.
- Tests: `test/unit/packages.test.js` (nested resolve, services, client, routes,
  libraries, listing, path guard, precedence) and a super-user claim in
  `test/api/client-code.test.js` (written, not run: it needs the API harness).
  Lint ratchet clean. The `components` and `model-statechart` unit tests fail on
  master too.
- **Verified by John on `demo` 2026-10-24:** the bill of material and the
  indented BOM, with their prints, work. Not yet run: the SupplyChain suites over the merged
  code (John is running them).

Plan item 6.7 (settings cache not undone on rollback) turns a failed SupplyChain
deploy into a second, misleading failure on the retry (catalog etag).

## Open, 2026-10-22 (seventh round)

John, 2026-10-22, about self upgrade: "I really just want 2: Self upgrade
manager and self upgrade instances booleans. When I start the server, it
checks the core versions of those things and applies any necessary scripts
to upgrade them just as if I'd run install --manager and install --instance
[name] for every instance." Then: "we could in fact remove that instance
migration script entirely", and, asked to confirm: the instance-to-identity
migration goes, the organization-to-global merge stays.

`feat/self-upgrade-two-switches` (on master, pushed 6fdd7b37).

- **`selfUpgrade` and its six companions are gone.** `selfUpgradeManager`
  and `selfUpgradeInstances` are booleans, off by default, environment
  overridable. Neither takes an organization, a list or credentials.
- **The manager is now upgraded when its Core version is behind.** Before,
  an existing manager was never touched (only an absent or non-manager one
  was built), so a changed manager schema could not arrive by restart.
  Every registered instance whose Core version is behind (or absent) gets
  `install.js --instance <name>`. The manager goes first; a failed manager
  step is fatal, a failed instance step holds that instance.
- **`scripts/migrate-identities.js` is deleted** (tag `v3.0.0-alpha.1`
  keeps it). README, CHANGELOG, ADR-001 and the skill say so.
- Unit suite 377/0; `test/unit/upgrade.test.js` rewritten (17 claims).

**`feat/global-usernames` now carries it** (merged in; pushed ef8063ee)
**and bumps the manifest, `package.json` and the lockfile to
3.0.0-alpha.2.** Without a bump a deployed manager at 3.0.0-alpha.1 is not
behind a checkout that is still 3.0.0-alpha.1, so `selfUpgradeManager`
would never have applied the duplicate-username merge and the unique-name
index. Proved on a live cluster: manager alpha.1 -> alpha.2 through the
switch (merge step ran), then both instances followed; `global-usernames`
8/8, `upgrade` 19/19. Merge `feat/self-upgrade-two-switches` first or
`feat/global-usernames` alone -- the second contains the first. The
version number is John's to change if alpha.2 is not what he wants.

The org-to-global change is **not** in `migrate-identities`: it is two
manager steps in `manifest.json` (`merge-duplicate-identities.js`, then
`manager-constraints.js`), which `install.js --manager` applies and the
switch triggers.

## Open, 2026-10-21 (sixth round)

John, reading back the answer that a platform administrator needs an
account in each organization: "that defeats one of our original
requirements to have the notion of a global platform admin over all who
can resolve any problem for any org. It's not practical for them to
have create many versions of themselves. Likewise we had the use case
of a VAR who might be given access to multiple orgs that are their
accounts. So user names must be global and unique to the whole system."

`feat/global-usernames` (on master, independent of the fifth round).
**A model change, so it needs `node install.js --manager` after
merging** (or `selfUpgradeManager`, now that the version is 3.0.0-alpha.2) -- that is what merges duplicate usernames, builds the new
index and creates the `organization_admin` table.

- **A username is unique across the installation.** Sign-in finds
  whoever holds the name; the grant decides which instances they may
  reach, which is where the organization boundary properly lives. The
  picker's "which organization is yours?" prompt is gone with it, as is
  the per-organization credential lookup.
- **`identity.organization` means who owns the account**, not where the
  person may work. `instancesFor` no longer requires the instance to
  belong to the identity's own organization, so a reseller granted
  instances in three organizations sees all three, each labelled.
- **Administering an organization is an appointment** -- new
  `OrganizationAdmin` feather, one row per organization administered.
  `identity.is_org_admin` is no longer read. Any existing identity can
  be appointed, whichever organization owns the account, and the
  console appoints an existing person rather than only creating one.
- **`is_platform_admin` is now true to its name**: one account answers
  for every organization. New route and Users-screen action to appoint
  one, platform administrators only, with a guard against standing down
  the last one.
- **The organization picker** on the Users screen is offered to anybody
  appointed over more than one organization, not only to platform
  administrators.
- **Email autofill**: a user name that looks like an email address is
  offered as the email, and stops being offered if the name stops
  looking like one.
- **The account stays with the organization that owns it.** Found while
  rewriting the isolation suite: once anybody can be appointed, an
  organization administrator could appoint an outsider and then reset
  the password of the account that person uses everywhere else.
  Appointment and grants are theirs to give; the password and whether
  the person may sign in at all are not. Only a platform administrator
  crosses that line. SSO is confined the same way -- a group claim
  appoints over its own organization only, and a provider cannot link a
  subject to an account another organization owns.
- **Migration merges duplicates** (John's choice over a report to
  resolve by hand): the identity most recently signed in to survives
  and inherits the others' grants, federated subjects and
  administration; the others are soft-deleted; each merge is printed
  and audited. Proven against a replica of John's own manager, where
  `ncuser_12161` existed in Default and Road Runner Campers, and then
  against his dev manager itself.

New `test/api/global-usernames.test.js` (8 claims, including one
platform account seeing every organization and one reseller account
administering two). `picker`, `isolation` and `federation` rewritten
where they asserted the old rule; `isolation` keeps all 18 claims.
**Verified side by side:** sixteen api files on this branch and on
master, 72 failures each, name for name -- the sandbox's own baseline.
Checked in headless Chromium against the upgraded dev manager. ADR-001
gains revision 4; README and the tenant plan updated.

Not done: `client/clientmin.js` is not regenerated, so the screen
changes appear in debug mode only until it is.

## Open, 2026-10-20 (fifth round, evening)

Found by John on his own `tracker` instance, installing a bug-tracker
package from the Modules page, plus one he asked for while this was
being tested. Merge order: 1, 2, 3, 4; 5 stands on master by itself.

1. `fix/web-install-to-disk` -- John: "it's still installed the old way
   as rows." The Modules page's Install button posted to
   `/:db/module/install`, which unpacked the zip to a temporary folder,
   wrote the module's code into this database's rows and deleted the
   folder: the server never held the package. It now does Install
   (`modules/<name>/<version>/`) and Deploy (into this instance) as one
   action through `admin.installAndDeploy`, by the Admin Console's rules:
   platform administrator only, the instance held while it runs, both
   ends audited, and the version replaced if the server has it (a
   package in development is installed again and again). **Behavior
   change:** an organization administrator who is not a platform
   administrator can no longer install from this button. Also fixes
   `datasource.recordDeployed`, which could not move a module from one
   version to the next while the old version was still installed (its
   write to the `module` row was refused as an edit of code served from a
   package, leaving the instance held). `test/api/module-install.test.js`.
2. `fix/console-reach-other-orgs` -- John could not Close or Drop
   `tracker`: "No instance in this organization has that id." `node
   install.js --instance` put it in a new "Default" organization, and the
   platform console lists every instance but sent only the instance id,
   while the server looks an instance up inside an organization (the
   caller's own unless one is named; tenant plan A.4). The console now
   sends the organization it already holds for the row (`picker.js`
   `send` and the progress poll). Reproduced in headless Chromium against
   an instance in a second organization: 404 before, Close and Drop
   succeed after. Client only; the server contract was already tested.
3. `fix/deploy-writes-no-code-rows` (on 1) -- John: "stop allowing those
   things. Period. No more writing scripts to the database from any
   path." Two commits. The first stopped a deployment of a held package
   writing code; the second took the condition away entirely. The
   installer writes no `Module.script` and no `DataService` rows at all:
   `saveModule` records name, version and dependencies with an empty
   script, `saveService` is gone, and a manifest's service files are read
   where they live. **Core is now a package too** -- the checkout, not a
   directory under `modules/`, so it cannot be installed, removed or
   listed as one, but its manifest answers `packages.resolve` and its
   services and client script are read from its files like any other's.
   That is what makes this a rule rather than a preference: with nowhere
   else for code to come from, `datasource.install` refuses a directory
   that carries services or a client script and is not a package this
   server holds, before it changes anything. The old write guard (which
   refused edits only for a disk-served module) is now a flat refusal of
   any write carrying code, from any caller including Install and Deploy,
   so the deployment flag they needed to get past it is gone; deletes are
   still allowed, and so is everything else about a Module. **Rows
   already there are left alone** and still load for a module with no
   package (SupplyChain's Common, Buy, Sell; Job Shop), which is what the
   fallback is for; the Packager stays until those ship as packages.
   `file-mode.test.js` and `test/unit/packages.test.js`.
4. `fix/installer-remote-state` (on 3) -- **four defects found by
   running the suite over 3, all of them on master already and all the
   kind that only show once a deployment really reaches the instance it
   names.** Two commits.
   *The install that never answered:* whether an install writes to a
   database other than the caller's was module-level state in
   `installer.js` -- the first deployment set it and nothing ever
   cleared it, so every later install in that process finished as a
   remote one, including the ones that never opened a connection of
   their own, which died on `conn.done()` as an unhandled rejection.
   The promise never settled, the request waited for an answer that was
   never coming, and the deployment holding the instance never let it
   go. On John's `tracker` that needs one deploy first, and then the
   Modules page hangs and leaves the instance down for maintenance.
   *The target that was never opened:* the path for a caller with
   nothing watching its progress (the command line, and the Modules
   page, which tracks its own) skipped the step that opens the target
   database. Opening it is its own step now and every path takes it;
   only progress tracking is skipped.
   *The connection a failure kept:* a failed install left its client
   checked out of the instance's pool for the life of the process, and
   since ending a pool waits for its clients back, the next thing
   needing that instance to itself -- a template copy, a drop -- waited
   with it forever. One failed deployment was enough.
   *The user a deployment wrote as:* the caller's own connection was
   given the service account, the one opened for the target was not, so
   it wrote as the operator -- who, deploying to a customer's instance,
   is generally not a user of it at all, and was refused with "Only the
   record owner or a super user are allowed to change document
   ownership".
   Plus the one follow-up that belongs to 3: **the framework answers
   for whatever version a database records.** A module under the
   modules directory is served the exact version its database carries,
   because two databases may run different versions of it; the
   framework is the one this process is, and a database recording an
   older Core is behind rather than owed code nobody keeps any more.
   Matching it strictly left such a database -- exactly the one an
   upgrade is aimed at -- served nothing at all for Core.
   `module-install.test.js` gains the hang case (it hangs without this
   and fails in thirty seconds with it; the harness's `upload` learned
   a timeout), `test/unit/packages.test.js` the version one.
   **Verified side by side:** the same seventeen api files on this
   branch and on branch 1, same 21 failures on each, name for name --
   the sandbox's own baseline, which wants SupplyChain and Job Shop --
   and `module-install` hangs on branch 1 where it passes here.

5. `feat/ribbon-signed-in-as` (on master) -- John: "I'd like to see who
   I'm logged as over near the alarm bell." A label beside the alerts
   bell on every screen the ribbon is on: the username, with the full
   name, organization, instance and administration tier in its tooltip,
   and clicking it shows the Home tab where the account buttons are. The
   organization is the part worth the lookup -- an identity belongs to
   exactly one organization and nothing on a screen said which, which is
   how a platform administrator ends up unsure whose instance they are
   in. `admin.whoAmI` (the one method there that refuses nobody, since it
   reports and does not act) rides out on the connect payload, best
   effort, and reads authority from the identity rather than the session.
   Two claims in `test/api/auth.test.js`; checked in headless Chromium.

Not done: removing the row fallback and the Packager (needs SupplyChain
and Job Shop repackaged first); cleaning up code rows an older
installation already holds.

## Open, 2026-10-20 (fourth round)

Found by John on the 3.0.0-alpha.1 deployment: an administrator could
not change a user's name, email or phone (or even see the email and
phone), a user created on the Users screen was never mailed, and
"Forgot password" did nothing. Five branches, **stacked, merge in this
order**; none needs a reinstall (client and server code only).

1. `feat/users-hide-disabled` -- the Users screen lists only people who
   can sign in; a "Show disabled users" checkbox (off by default) brings
   the rest back. Client and CSS only.
2. `feat/users-edit-details` -- POST `/:db/admin/identity/info`
   (`admin.updateIdentity`), an Edit button and right-click item, and
   Email and Phone columns. The details live on the person's profile in
   the instance (`Contact`), so they are read and written there through
   `changeUserInfo`, with the identity's name and email kept in step and
   the change audited (`identity.info_changed`). Someone who has not
   signed in yet has no profile: name and email only. Also fixes two
   defects in `changeUserInfo` that the self-service "Edit my contact
   information" shared: a profile made at first sign-in has no contact,
   and linking a new one was refused by the user-account trigger
   ("Contact must have a primary email address") because it reads the
   address off the contact it is handed, so no one provisioned through
   the Users screen could ever save their own details; and on any
   failure it rolled back and never answered. `test/api/admin-users.test.js`.
3. `feat/new-user-email-invite` -- the 2.2.0 way of making a user: no
   password, the person is mailed a magic link that signs them in and
   sends them to the change-password page. System mail (that link, the
   password reset, sign-in codes) now goes out through the
   **organization's SMTP account** from Settings (`server/services/notify.js`),
   falling back to `config.json`; it used to use `config.json` alone, so
   the account an administrator entered was only ever used for mail a
   person sent by hand. A mail that cannot go is now reported to the
   administrator instead of being answered "sent". **"Forgot password"
   fixed**: for a user with no contact (every user made on the Users
   screen) the user-account trigger refused the change-password flag
   ("Contact is required"), the error went nowhere, and the request
   never answered; the contact is now made from the identity's name and
   address when there is none. Same tests file, against a throwaway SMTP
   server: the mail arrives through the organization's account, the link
   signs the person in with `changePassword` set, the password they
   choose works, and a dead mail server is reported.

Checked in this sandbox: `admin-users.test.js` 12 claims (two of the
edit claims fail with the `changeUserInfo` fix removed), the
neighbouring suites (`users`, `auth`, `security`, `settings`,
`organization-settings`, `credentials`, `picker`, `platform`) match
master, `users` still failing its one Employee/Job Shop test, and the
Users screen driven in headless Chromium. Check locally: with Job Shop
installed, a contact there is an `Employee`; `changeUserInfo` creates a
plain `Contact` for a profile that has none, as it always did.

4. `fix/org-two-factor-session` (on top of 3) -- **a security hole that
   was already on master, found while testing the sign-in code mail.**
   When two-factor is required by the *organization* (tenant plan C.2,
   `organization.is_two_factor_required`) rather than by `config.json`'s
   `twoFactorAuth`, the password step still opened a session: passport's
   local strategy was created with `session: !twoFactorAuth`, which is
   only false for the installation-wide setting. The confirmation code
   was mailed and asked for, but a password alone already had access (a
   data request made before entering any code returned 200). The
   password step now never opens a session; `doSignIn` logs the user in
   itself when no second factor applies, and the magic-link callback
   (which checks the code) is the only way in when one does. New
   `test/api/two-factor-mail.test.js`: with the organization requiring
   it and SMTP pointed at a throwaway server, a password alone gets
   nowhere, the code arrives through the organization's account at the
   user's address, a wrong code is refused and still gets nowhere, and
   the right code signs the user in. The throwaway SMTP server moved to
   `test/api/lib/mailsink.js` so both tests use it. Merge it with, or
   straight after, branch 3.

5. `fix/user-contact-employee` (on top of 4) -- **found on John's
   `tracker`/`demo` after branches 2 and 3**: saving a person's details
   on the Users screen, and creating a user with an invitation, failed
   with "Cannot read properties of undefined (reading 'type')". Cause:
   SupplyChain's Common module keeps a trigger on UserAccount
   (`triggersUserAccount`) that PATCHes the account's contact *as an
   Employee*, assuming every user account is backed by one.
   `changeUserInfo` -- the one place a contact is made for someone who
   has none, shared by the administrator's edit, the invitation,
   "Forgot password" and "Edit my contact information" -- made a plain
   Contact, so linking it to the account tripped that trigger. It now
   makes an Employee when the instance has an `Employee` feather that
   inherits `Contact`, with `number` (the required natural key) set to
   the user name in upper case, suffixed `-2`, `-3` if another employee
   has it, and `isActive` true; otherwise a Contact as before.
   `test/api/user-contact-employee.test.js` builds an Employee feather
   as Common defines it and fails without the change. The user
   `ncuser_12161`'s contact on `demo` is a plain Contact; anything that
   saves that account will hit the same trigger -- the real fix for
   that is in Common (make the trigger create or skip a non-Employee).

   The 2FA mail itself was not removed by branch 3: its text, subject,
   recipient, code and verify step are as they were; only the transport
   changed to the shared `notify.send`.

Not done: the invitation does not appear in the Users worksheet's own
"new user" form (a user made there is still mailed by
`doPostUserAccount`, now through the organization's account too);
a "send test email" button under Settings; any change to the mail
wording (the 2.2.0 text is reused as it was).

## Open, 2026-10-18 (third round)

Two more, each standing alone on `john/master` (which now carries the
second round below, merged as PRs #246-#248):

1. `fix/snackbar-close-icon-contrast` -- the snackbar/progress-meter's
   close (and other) icons had lost their contrast and in some states
   their click target; restyled. Pushed, not yet a PR.
2. `feat/upgrade-deploy-progress` -- John: "When I upgrade core or
   deploy a package I get no idea of whether it's working on not. The
   original admin console had progress meters for both actions. I'd
   like to see that." Both the Instances screen and the platform
   console's fleet view now poll a percent complete while an Upgrade
   or Deploy runs, against a process id the caller picks before
   sending the request (there is nothing to hand back until the
   install is already underway). `installer.js`'s `isSuper` no longer
   implies "skip the process record too" -- it skips `checkSuper()`
   alone when a process id rides along. New read-only route,
   `GET .../admin/instance/process?id=<instance>&processId=<id>`
   (and the platform equivalent), answers `{status, percentComplete,
   errorMessage}` or `null`, guarded the same as the write routes.
   Neither screen carries the client's SSE wiring, so both poll --
   `picker.js` and `admin-instances-page.js` each get their own small
   polling function, written to that file's own conventions rather
   than shared, both on a plain `<progress class="fb-admin-progress">`
   rather than the signed-in app's snackbar meter. **Also fixes an
   unrelated, pre-existing defect found along the way:** the
   Instances screen's **Upgrade** button was fully built underneath
   (`vm.doUpgrade`, the `entry("upgrade", ...)` definition, disabled
   reasons and all) but `menuKeys()` and the toolbar render never
   referenced it, so it appeared in neither the toolbar nor the
   right-click menu -- confirmed on `john/master` before this branch,
   not something #248 or this work introduced. Found by actually
   clicking through the flow in headless Chromium rather than trusting
   the code read. 10 new claims (5 each in `test/api/upgrade.test.js`
   and `test/api/fleet.test.js`); verified end to end in headless
   Chromium against both screens, real incremental `percentComplete`
   over the wire.

## Open, 2026-10-18 (second round)

**Merged 2026-10-18** (PRs #246-#248, in that order). Three, which
stood independent of each other and of the stack below:

1. `docs/record-punted-decisions` -- the SSO/HA/API-tokens punts,
   decided in conversation on 2026-10-18, recorded in the ADR docs
   rather than left only in a local working copy that was then reset.
2. `feat/logo-upload` -- the logo setting gets an Upload button, not
   just a pasted URL (`formats.image`, through the existing
   `/do/upload`, gated by `fileUpload`).
3. `fix/fleet-core-column-and-upgrade-button` -- the platform
   console's fleet table gets a **Core** column (version and whether
   behind, which used to live only in a tooltip), and the single-row
   "upgrade" there is gone: it duplicated the group button, which
   Deploy never had a row counterpart for either.

Each stood on `john/master` after the 2026-10-17/18 stack below, not
on each other.

## Merge order, 2026-10-17 and 18

One stack, in this order, each built on the one above it. Merging the
last brings all four.

1. `feat/self-upgrade-on-start`
2. `chore/version-3.0.0-alpha.1`
3. `feat/instance-upgrade-action`
4. `feat/organization-settings`

**After merging:** `node install.js --instance <name>` on every instance.
Both (2) and (4) need it — (2) because the Core version in each
database's `module` row is what the fleet view and the self-upgrade
compare against, and (4) because the `globalSettings` definition is
stored per instance and the organization-owned properties are only
recognised once the new definition is installed.

**Merged 2026-10-18** (PRs #241-#244, in that order), and the branches
are gone from `FeatherboneJS/Featherbone`; the rows below are kept as
the record of what each one was.

## Merge order, 2026-10-16

Eleven branches went up this day. Three stand alone and can go in any
order:

1. `fix/registry-refresh-one-at-a-time` -- the F.3 hang.
2. `fix/harness-upgrade-manager` -- the harness's manager copy.
3. `docs/platform-admin-items`, then `docs/decisions-2026-10-16` --
   docs only, the second written on top of the first.

The rest are **one stack, in this order**, each built on the one above
it:

4. `fix/one-pool-per-database`
5. `feat/g1-instance-picker`
6. `feat/g2-platform-console`
7. `feat/demo-drop-after-grace`
8. `feat/fleet-group-deploy`
9. `feat/d5-edition-platform-only`
10. `feat/c3-azure-ad-sso`
11. `feat/file-mode-visible`

Merging the last one brings all of them. `feat/c3-azure-ad-sso` also
carries the harness change from (2), so whichever of the two is merged
first, the other is a no-op. Each one's own row below says what it is
and what it was tested against; the suite was run over the whole stack
at the end -- unit 342/0, and the api suite at the sandbox's
14-failure baseline, which is what it was before any of this.

## Delivery

- **Update 2026-10-08: pushing from the cloud works now.** Attaching `FeatherboneJS/Featherbone` to the session with push access (the add-repo step) lets the session push branches directly. Clone it shallow, branch from `master`, commit as `jrogelstad <john@rogelstad.net>` with the Co-Authored-By trailer, push `fix/<item>`, and John opens the PR. One branch per plan item. The bundle workflow below is no longer needed.
- **Still true:** no git on John's laptop from a linked session, and writing into his `.git` is refused. `jrogelstad/SupplyChain` is private and was *not* reachable with the session's GitHub credential on 2026-10-08.
- **Old workflow (obsolete):** bundles plus `fetch-branches.sh --push`, written to `Documents/Featherbone/claude-branches/`.

## Cloud test environment (rebuild notes)

- **Postgres:** the cluster is Postgres 16 (`/usr/lib/postgresql/16/bin`). Run `initdb` as the `postgres` user, auth md5. Because of PG15+ public-schema permissions, before `node install.js` run `ALTER SCHEMA public OWNER TO admin; ALTER DATABASE demo OWNER TO admin; ALTER ROLE admin CREATEDB CREATEROLE`.
- **SupplyChain** is a private repo (`jrogelstad/SupplyChain`). Rebuild it by staging the `.git` pack from `Documents/SupplyChain`. Install `17aabed`, not HEAD `9de2417`: that commit fails with "Relation feather Product required by InventoryValueDetail not found". Install by zipping the folder and POSTing it to `/demo/module/install/x=1` as `admin`/`password`.
- **An ordinary test user no longer needs Job Shop.** `test/api/lib/access.js` `createUser` falls back to `Contact` where there is no `Employee` feather, so the settings, workbooks, authorization and security suites run against a framework-only database. The full battery there fails 503 tests (639 before the 0.4 branch); the rest need Job Shop and SupplyChain.
- **Cloud Postgres, 2026-10-09:** `admin` was given SUPERUSER so the harness's `pg_dump | pg_restore` fallback can replay `GRANT SELECT ON pg_authid`, which it hits whenever the server holds a connection to `demo` and `CREATE DATABASE ... TEMPLATE` is therefore refused. Local Postgres does not need this.
- **Driving the client headless:** Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with `playwright-core`; sign in at `http://localhost:3003/demo/` and collect console errors and failed requests. One pre-existing console error showed up for every user on master: the Mithril `removeChild` `NotFoundError`. The `TypeError: Cannot read properties of undefined (reading 'selected')` at `client/main.js` is fixed on `fix/boot-order-menu` (2026-10-13): opening `#!/home` before sign-in rendered the home route before the menu existed, and left the ribbon missing after sign-in.
- **These docs keep reverting on the laptop (twice on 2026-10-09).** They are tracked in the repo, so a pull, merge or checkout restores the committed version over edits made from a session. The Claude project copies under `claude/` are the ones to trust; commit the docs on the laptop if the local copy is to survive.
- **Job Shop:** without it, five snapshot tests fail (`catalog-routes`, `catalog-settings-definition`, `catalog-workbooks`, `settings-definitions`, `workbooks-catalog`). Never regenerate those from the cloud database.

- **Cloud Postgres, as rebuilt 2026-10-08:** the `postgres` user cannot traverse the scratchpad under `/tmp`, so put the cluster in `/var/lib/pgtest` (initdb with `--pwfile`, start with `pg_ctl`, use absolute paths because `su` resets PATH). Create `admin` (LOGIN CREATEDB CREATEROLE) and database `demo`, run `CREATE EXTENSION pgcrypto`, `ALTER SCHEMA public OWNER TO admin` and `GRANT SELECT ON pg_authid TO admin`, copy `server/config.template.json` to `server/config.json` (set `pgCryptoKey`, `secret`, `clientPort` 3003), then `node install.js`. `Kind`, `Category`, `Location` and `Contact` are framework feathers; `Terms`, `Employee` and the authorization and query suites' `before` hooks need SupplyChain and Job Shop.
- **Test runner:** `node test/run.js api/query` runs one file; adding the word `integration` first runs everything. Unit tests need only `server/config.json` and `npm ci --ignore-scripts`.
- **SupplyChain rebuild from the staged pack was blocked** by the session's permission classifier on 2026-10-08 (not retried). Needs John's go-ahead or repo access.

## Findings

- **John's `demo` grants `everyone` full CRUD** on `role`, `user_account`, `feather`, `script`, `module`, `route`, `form` and others. A fresh install gives read access on `role` only. Flagged to John; not changed.

## Status

**Update 2026-10-15 (night).** The stack now runs `feat/harness-identities` → `feat/b8-retire-role-path` → `feat/a4-admin-model` → onward (one branch per remaining plan item; merge in that order). Everything through B.6 is merged on John's fork. The first two finish Tier B of the tenant plan: `feat/harness-identities` (prerequisite 3 of B.8 -- the whole suite signs in by identity; also what fixed John's red run after his config went to identities) and `feat/b8-retire-role-path` on top of it (B.8 itself: no role path, no `authStrategy`, identity-native `install.js`, triggers and harness without Postgres roles). **After merging B.8, run `node install.js --instance <name>` on every instance, `demo` included**: the Role/UserAccount triggers live in the installed core-services script and the old copy still calls `grantMembership`, which no longer exists. The api suite sits at the 66 baseline on both branches.

**Update 2026-10-16 (ADR-002).** Six branches finish the ADR-002
implementation, stacked on the tenant-plan stack and the two ADR doc
branches; the first rows of the table below carry them in merge order.
The api suite is at its 66-failure sandbox baseline on every one of them
and the unit suite is 324 pass / 0 fail. **`node install.js --manager`
is needed after the first of them** (the registry row gains a column),
and `node install.js --instance <name>` on every instance after the
tenant-plan stack, as before.

**Update 2026-10-13 (later).** The three admin branches (B.4/B.5, the manager admin API and the Users screen) are merged, as is `fix/boot-order-menu`. Open now: the two database branches at the top of the table and `fix/debug-no-cache`.

**Update 2026-10-13.** Every branch in the table below that says "Pushed" is now **merged** into `FeatherboneJS/Featherbone` master (PRs #164-#177, in the order listed), as are `fix/install-fresh-database` (#177, with #191/#194 carrying John's own commits), `fix/test-required-fields` (#178/#194) and `fix/clean-numeric-bounds` (#179). Master verified on John's machine: API 262 pass, 0 fail, 0 cancelled; unit 306 pass. The "Reinstall Core after merging" notes still apply to any database not yet reinstalled. Open work is the three stacked branches in the first rows of the table.


| Branch | Plan item | State |
| --- | --- | --- |
| `feat/organization-settings` | John, 2026-10-18: "move the global settings from the database to the platform manager organization instance", and "I mean the organization record that manages all the instances" | **Open, merge fourth.** A customer's letterhead and mail account are the same wherever something is printed or sent from, so they live against the organization in the manager instead of in each instance. Bare `"$organization_settings"` made on first use (look-then-advisory-lock, the claim table's lesson), so no manager reinstall. Marked a property at a time (`"isOrganization": true`), since one document can hold both kinds; the definition stays per instance and the screen does not move -- still Settings in the Home tab's Global group, "right next to other organization-based data" (John). Every reader already went through `getSettings`, so the overlay there covers printing, the SMTP transport and the client model untouched. **The logo stopped being a `ResourceLink`** and is a pointer -- a URL, or an uploaded file's name read from `files/upload/`, basename only -- which is what let it move with the rest; an object with a `resource` is still read so an existing one keeps printing. No migration (John): the instance's values answer until the first save, and the instance keeps a full copy. `test/api/organization-settings.test.js`, 8 claims. **Reinstall every instance after merging** -- the definition is per instance. Full api suite: the same 37 failures as master in this sandbox, compared list to list |
| `feat/instance-upgrade-action` | John, 2026-10-17: "I know I could easily attach one from platform admin, but how do I get its db up to 3.0.0 alpha?" | **Open, merge third.** Deploy applies packages from `modules/`; the framework is not one, so a core upgrade was a shell and nothing else. `upgradeInstance` is that act on demand -- held, manifest applied through the in-process installer (as a deployment does, since this runs inside a request), let go, audited both ends, platform only; a failure leaves it held. `upgradeFleet` is the same across a named group, one at a time. Both screens get it: the Instances screen's toolbar and right-click menu, and the platform console's, plus a group button beside the group deploy. The overview now carries `serverVersion`, and each instance `coreVersion`/`isCoreBehind`, decided by `upgrade.isBehind` -- the same comparison the startup upgrade uses. Does **not** reach a database that predates the manager: with no `"$db"` marker the console refuses to register it, and `install.js --instance` (or `selfUpgradeInstances`) is still what converts one. `test/api/upgrade.test.js`, 13 claims |
| `feat/self-upgrade-on-start` | John, 2026-10-17: "I have an instance of featherbone 2.2.0 on the cloud in a situation where I don't have access to run command line there... I'm thinking I actually need to enable some kind of self-upgrade process when the server starts?" | **Open, merge first.** `selfUpgrade` runs the three upgrade acts at startup, ahead of the datasource because the manager is one of the things a first upgrade creates. What runs is the command line as a child process -- the same `install.js` and `migrate-identities.js` -- so there is one installer to keep right and its catalog loading stays out of the server's caches. Each step asks first: the manager's `"$db"` marker, and each instance's Core version against `manifest.json`. The identity backfill is its own switch (one way, no rollback) and runs only when something else did. One at a time across nodes on an advisory lock on the maintenance database, since `claimWork` lives in the manager that may not exist yet; a service account that cannot reach it is told so and goes on without it. A failed instance upgrade holds that instance and the server still starts; a failed manager build stops it. **Proved end to end against a live cluster:** an empty cluster booted to a manager, a registered instance and an organization; the next boot ran nothing; with the version bumped the boot after that upgraded the instance from Core 2.2.0 and the one after was quiet again. `test/unit/upgrade.test.js`, 18 claims. Settings and behavior are in the README |
| `chore/version-3.0.0-alpha.1` | John, 2026-10-17: "let's assume we're trying to version jump to v3.0.0-alpha.1. Update versioning to that, and start release notes" | **Open, merge second** (on the first, which its notes describe). Version in `package.json`, `package-lock.json` (root entries only), `manifest.json` and both `yuidoc.json`. The manifest version is the load-bearing one: `install.js` records it in each database's `module` row, so it is what the fleet view and the self-upgrade compare against, and bumping it marks every 2.2.0 instance as behind. New `CHANGELOG.md` starting at this release -- the ADR-001 and ADR-002 shape changes, the operations work, a Fixed summary, the upgrade path with its one-way warning, and the known gaps (SSO unproven against a real directory, API tokens and manager HA out of scope, the feather property ordering defect). Unit suite 368 pass / 0 fail after the bump; no golden hardcodes a version |
| `fix/one-pool-per-database` | Found 2026-10-16 while running the api suite over the G.1-G.3 work: `lifecycle` and `provision` failed with "featherbone_test2 has 1 other session(s)" after a group deployment had touched that instance | **Open.** `pools` lived inside `exports.Database`, and eleven services each do `new Database()`, so one database had as many pools as services. Two consequences: the README's connection budget was wrong by that factor, and "give up this database" could not work -- `releaseTenant` before a template copy or a drop (D.3) ended only the asking service's pool while everyone else's idle connections kept the database busy. One module-level pool map fixes both. `test/api/pools.test.js`: two services find one pool and ending it ends it for both, and a template copy succeeds straight after a deployment has touched the instance -- both fail without the change |
| `fix/registry-refresh-one-at-a-time` | Found by John's test run hanging in F.3, 2026-10-16 | **Open.** Registering an instance reads the registry twice at once -- in the admin route and in the Tenant change event it raises -- and two overlapping `refreshTenants` both found the new instance missing, both added it, and both listened to it. The second listener asked for the advisory lock (`7001`, node id) that the first, from the same process, already held and waited for itself for good: the refreshing request never answered and the lock stayed behind (seen in `pg_stat_activity` as one `pg_advisory_lock` blocked by a sibling `LISTEN` connection on the same database). `server/services/serialize.js` runs refreshes one at a time, in order, each with its own result or error; `test/unit/serialize.test.js` shows the look-wait-add race and that serializing removes it. Timing-dependent, so not reproduced through the harness here (F.3 passes either way); confirm on John's machine that F.3's "provisioning run claimed on node A" no longer hangs. **Second occurrence, same cause, found in `pg_locks` on John's machine:** the D.4 "rebuilding replaces the template in place" test hung with two listener connections to one instance (`featherbone_test2`) from the same node, the second blocked in `pg_advisory_lock`. The template build resumes listening to its source without waiting while a registry refresh listens to the same instance. `datasource.listen` now runs one listen at a time per instance (a second caller joins the first), `releaseTenant` waits for a listen still opening, and the build's resume-listening no longer leaves an unhandled rejection |
| `fix/harness-upgrade-manager` | John's api run, 2026-10-16: deploy, fleet and maintenance suites cancelled on `column "is_maintenance" of relation "tenant" does not exist`, and the schema and catalog goldens differed by it | **Open.** The harness builds its manager as a copy of the source database, and a `demo` that began combined carries the registry tables it had then; reinstalling `--instance demo` does not touch them and `--manager` upgrades `db_manager`, not that copy. The harness now runs `install.js --manager` against its own manager copy after marking it, the way a real manager is upgraded (idempotent on a current one). Does not change what the catalog golden sees: it is read from the instance copy, so if `Tenant.isMaintenance` is still missing there that one test needs `demo` itself brought current |
| `feat/g1-instance-picker` | John, 2026-10-16: "I don't see the option yet to log in without a db in our url where, after authentication, I am prompted to pick one. going to url without db in the path just fails" | **Open.** The tenant plan described the picker (section 9, sign-in and instance selection) and nothing built it, so the root URL 404ed. Now: `GET /` serves `picker.html` (its own page, not the application bundle, which is built rather than read), `POST /sign-in` with no database authenticates the identity against the manager alone (`database.authenticateIdentityOnly`, the credential half factored out of `authenticateIdentity` so both paths count failures and re-hash the same way), and `GET /my/instances` answers the grants. Entering an instance is where access to it is proven: `server.js` admits an identity session once per instance through `platform.mayEnter` and records it on the session, so a revoked grant shuts the door at the next entry rather than at session expiry. A username in two organizations is asked which, without the organizations being listed and without trying the password against each (that would lock every one of them). An organization that requires a second factor gets no passport session here, so opening an instance lands on that instance's own sign-in: the code is the instance's to send. `test/api/picker.test.js`, 13 claims. The paths the server answers itself (`auth`, `my`, `platform`) are refused as instance names, since an instance called `platform` would be shadowed by the console and could never be opened |
| `feat/g2-platform-console` | John, 2026-10-16: "Managing orgs is obviously essential... How do I create an org? Their first database?" and his answer to G.4, "make the global platform administration an option for a global admin" | **Open, stacked on `feat/g1-instance-picker`.** Organizations were command-line only and nothing saw across them. `/platform`, reached from the picker, is the one screen that crosses organizations: the organization list (create, rename, change sign-in, appoint the first administrator, close or open, build an instance) and every instance on the installation with its owner, state and connection. It is served where no database is named, so `admin.js`'s `contextFor` now works without an instance -- the actor comes from the session identity and must be a platform administrator, and each method names the instance it acts on -- and `datasource.databaseActor` takes the caller's organization from the client when there is no registry row to read it from. Actions follow the row pattern: click to select, buttons at the right of the toolbar, the same actions on right-click. `test/api/platform.test.js`, 13 claims, including that the authority is read from the identity rather than taken from the session |
| `feat/demo-drop-after-grace` | John, 2026-10-16, answering the plan's last open question: "I would eventually like demos to be dropped, but after more time has passed... if nobody says anything after, say, a month, we'll just completely drop it" | **Open.** The sweep closed an expired demo and left the database forever. It now also drops one that has been expired longer than `demoGraceDays` (config.json, 30 by default; 0 never drops), audited as `instance.demo_dropped`, with the registry row kept and marked deleted so the record outlives the instance. The drop needs no actor and is given none: `datasource.deleteExpiredDemo` reads the registry itself and refuses anything that is not a demo, closed and past the grace, so the policy is the authority rather than a caller -- `deleteDatabase`'s platform-administrator guard is untouched, both now sharing one `dropDatabaseNow`. The sweep route answers `{closed, dropped}`. `test/api/lifecycle.test.js` gains the two claims: a day past expiry is closed and still there, a month past is gone |
| `feat/fleet-group-deploy` | John, 2026-10-16, answering ADR-002's remaining question: "I'd like the option to upgrade the fleet one by one or in a group... likely patches I would want to deploy to a fleet, especially if urgent" | **Open.** `admin.deployFleet` applies one package version to a named list of instances, one after another, each one going through `deployPackage` exactly as a single deployment does -- so a group is a sequence of the same act, which is what makes it a rolling outage rather than a simultaneous one. The instances are named rather than implied, so a test database before production is the same action with one name. The first failure stops the rest by default (`stopOnError: false` carries on); the answer gives deployed, failed and not-attempted counts and a row per instance, and the group is audited as `fleet.deploy_began`/`fleet.deploy_finished` beside each instance's own rows. Reachable at `/:db/admin/instances/deploy` and `/platform/instances/deploy`; the console's fleet table gains a tick per instance, a "Carries" column saying how many of its modules are behind, and a Deploy button. `manager.instanceAnywhereById` is new, because a group crosses organizations. 5 claims in `test/api/fleet.test.js`. **Not covered:** a failure part-way through a group -- forcing one needs a package that breaks on apply |
| `feat/d5-edition-platform-only` | John, 2026-10-16, answering D.5: the edition "helps it determine what workbooks to show without having to create a proliferation of packages... eventually in this new structure I would like the edition setting to only be set or changed by the platform administrator" | **Open.** D.5 settled: an edition is not a security boundary (every feather and route installs whatever the edition; JobShop 2.3.0-alpha2 hides worksheets with `f.hiddenFeathers()` in the browser and whole workbooks by stripping their `$auth` rows), but who may change it is. A settings row is now the platform's when its definition says `isPlatformOnly` or when config.json's `platformOnlySettings` names it -- the second so `jobShopSettings` can be locked down without touching the JobShop repository. `settings.saveSettings` asks before the instance's own authorization, because the instance's super user passes that check and is exactly who should not pass this one; `platform.isPlatformAdminOf` reads the identity in the manager through the database's organization. Reading is unchanged. 4 claims in `test/api/settings.test.js`. **Still the module's to do:** JobShop's own route `/job-shop/do-configure/` has no role check of its own (the Develop workbook having no `$auth` rows is all that keeps the button out of reach), and its service passes `isSuperUser` to every inner request; this branch stops the settings write, which is what the edition actually is, but the module should refuse the route too |
| `feat/file-mode-visible` | John, 2026-10-16, after asking whether the script editors disappear once a module is on disk, and proposing that a database switching to file mode should have its module rows hollowed out | **Open, top of the 2026-10-16 stack.** The rows stay -- the catalog is a `$settings` row every request resolves names against, and workbooks and forms are rows a customer edits in place, so only the *code* rows are duplicated on disk, and those are the fallback and the pre-packaging record (ADR-002 §7 wants the migration to reconcile them, which deleting them first prevents). What was actually wrong is that nothing said which half a module was on: a super user could edit a service script in Develop, see it saved, and get the package's code on the next load -- and note `isSuperUser` is the signed-in user's flag, so a super user was also reading the stored row rather than the file the browser compiles. Now a write to `module.script` or a `data_service` row of a disk-served module is refused 405 naming the module and version, gated on `isExternalClient` so Install and Deploy (which arrive with their own client) still write them. The screens mark each instance `N behind`, `N from rows`, and `N adrift` -- the last being the one nobody would notice: the instance names a version this server does not hold and silently falls back to its tables, which is how two nodes end up running different code for one database. `test/api/file-mode.test.js`, 5 claims |
| `feat/c3-azure-ad-sso` | John, 2026-10-16: "Sure. Azure AD is the most common. Let's start with that" (plan C.3/C.4) | **Open. Merge `fix/harness-upgrade-manager` first** -- the new manager tables arrive with `install.js --manager`, and this branch carries that harness change too, so whichever is merged first the other is a no-op. Two manager feathers: `IdentityProvider` (per organization, secret encrypted with the installation's key) and `IdentityFederation` (`(issuer, subject) -> identity`, unique). `server/services/oidc.js` does the protocol through `openid-client` 6.8.8 (discovery, PKCE, state, nonce, signature, issuer and audience -- the plan called hand-rolling it a hazard); `server/services/federation.js` decides who the subject is: linked, linked to the person who was here before SSO, or made on the spot with the grants the provider names (C.4). Group claims carry the organization-administrator flag and are reapplied every sign-in; platform administration is never a claim. `organization.authentication` is finally read: `sso` refuses a local password without checking it. The console configures a provider and never shows a secret back. 14 claims in `test/api/federation.test.js`. **Not covered here, and to be proven against a real directory:** discovery, PKCE, the state/nonce round trip, the id-token checks and the userinfo fallback -- the seam between `oidc.js` and `federation.js` exists so the untestable half is as small as possible |
| `feat/instances-toolbar-actions` | UI pattern, John 2026-10-16 | **Open.** The Instances screen's per-row buttons became toolbar buttons on the right that enable for the selected row (Close/Open, Resume, Maintenance, Deploy, Template, Drop, Attach), plus a right-click menu with the same actions, built from one list so they cannot disagree; the Actions column is gone and rows are selectable. Checked in headless Chromium against a test server (selection, enable/disable, menu, dismissal, no console errors). The Users screen (`admin-page.js`) still has per-row buttons. Pattern recorded in the skill |
| `fix/claim-race-and-npm-load` | Found by John's first run on a full install, 2026-10-16 | **Merged (#215).** `claimWork` made its `$claim` table with `CREATE TABLE IF NOT EXISTS`, which is not safe against itself: two processes making it at the same instant both pass the existence check and one dies on `pg_type_typname_nsp_index` (the F.3 test failed on it). It now looks first and, when it has to make the table, takes an advisory lock, so one process makes it and the rest find it (8 concurrent makers over 40 rounds against Postgres directly: 280 failures plain, 0 locked). `test/api/multinode.test.js` drops the table before contending and uses six processes. The branch first also made `loadNpmModules` warn instead of dying on a retired package (`pdfjs`); `feat/adr002-retire-module-npm` merged first and made that loader a no-op, so that half was dropped. The print services still naming `pdfjs` and `table-layout` (Common and Design modules, Ship) needed porting to pdfmake, in SupplyChain -- **done 2026-10-22, SupplyChain PR #29** (see `featherbone-supplychain-fix-branches.md`) |
| `docs/adr-002-close` | Docs | **Open, merge last.** ADR-002 section 10 (implementation status), ADR-001 rev 3 note carried forward, this table, the skill |
| `feat/adr002-orphan-scripts` | ADR-002 q6 | **Open, merge sixth of the ADR-002 stack.** A service row belonging to no module is not loaded (it never was) and each database is told once, by name; nothing is deleted. `test/unit/services.test.js`, `test/api/orphan-scripts.test.js` |
| `feat/adr002-retire-module-npm` | ADR-002 q1 | **Open, merge fifth.** Libraries come from the module's own `package.json` and its own version directory (`featherbone.libraries`, or every dependency camel-cased); loaded with the database's modules before its code runs. `ModuleNpm` deprecated, still honored for a module with no package, and read from the instance now -- the one-mode collapse had left that loader reading the manager, so instance rows had stopped loading entirely. `loadNpmModules` is a no-op. `test/unit/packages.test.js` |
| `feat/adr002-client-from-disk` | ADR-002 §2 | **Open, merge fourth.** A module's client script is served from its installed package, so what the browser compiles changes only by deployment access; a module with no package still answers from its row; internal callers see the rows. Fixture gains a client file at both versions. `test/api/client-code.test.js` |
| `feat/adr002-fleet-view` | ADR-002 | **Open, merge third.** Instances screen gains a Modules column (what each instance carries, read from the instance; how many are behind a package the server holds) and "Deploy" on the row (hold, apply, record, release), platform only, audited both ends. New datasource methods: `installedPackages`, `deployedModules`, `packageDir`, `recordDeployed`. `test/api/fleet.test.js` |
| `feat/adr002-install-deploy` | ADR-002 §6, q2, q5 | **Open, merge second.** `install.js --package <dir|tarball>` installs on the server and touches no database (per-version `npm install`); `--packages` lists; `--deploy <module>[@version] --instance <db>|--manager` holds the instance, applies the manifest, records the version in `module`, releases. A failed deployment leaves the instance held. Also: a manifest with no client module file left no `module` row at all, and `install.js` exited 0 on failure. `test/api/deploy.test.js` |
| `feat/adr002-maintenance-state` | ADR-002 q7 | **Open, merge first of the ADR-002 stack** (on `docs/adr-001-rev3`). `Tenant.isMaintenance`: a held instance answers 503 with an explanation for everything but its own pages, sign-in and the admin routes, and only a platform administrator may sign in. Audited both ends. Read through a column probe, so an un-upgraded manager reports nothing held. **`node install.js --manager` after merging**; the registry also refreshes manager-owned fields on instances it already holds. `test/api/maintenance.test.js` |
| `docs/adr-002-status` | Docs | **Open, merge after `docs/adr-001-rev3`.** ADR-002 marked with what is built and what is not; the stale section 9 notes corrected |
| `docs/adr-001-rev3` | Docs | **Open, merge after `docs/tenant-plan-close`.** ADR-001 is accepted and implemented: an as-built table (manager/instances vocabulary, bare tables, no login roles, SSO and TOTP not built), §1 labelled as history, §9 split into answered and still open |
| | Feather property defect | **Found 2026-10-16, not fixed.** Adding a property in the *middle* of a feather's property list gives the new column the displaced property's type: `Tenant` gained a boolean before `expiration` (`string:dateTime`) and the column was created `timestamp with time zone`, so the install died on "invalid input syntax for type timestamp". A feather's properties are stored as a positional child array, so an inserted property lands on the row that was there and inherits whatever it does not set (here, `format`). Reproduced three times on a scratch clone and confirmed in the DDL. Workaround: append new properties at the end. Fix belongs in the Feather child-array merge (by name, not position) |
| `docs/tenant-plan-close` | Docs | **Open, merge last.** Plan annotations for D.1-D.4, C.1/C.2, E, F; README (lifecycle screen, connection budget); this table |
| `feat/f3-multinode-test` | Tenant plan F.2, F.3, F.4 | **Open, merge eighth.** `test/api/multinode.test.js` (second server: shared sessions, cross-node WebAuthn challenge, provisioning claim, two-process claimWork); isolation.test.js gains the F.2 mirror (second org owns an instance; neither admin can close the other's); F.4 recorded under B.6 |
| `feat/e-multinode-readiness` | Tenant plan E.1, E.3, E.4 | **Open, merge seventh.** `datasource.claimWork` ("$claim" in the manager); session `resave: false`; tenant pools capped (`pgTenantPoolSize`, `pgTenantIdleTimeout`), budget in README. CronJob module must call claimWork in its own repo |
| `feat/c1-c2-identity-credentials` | Tenant plan C.1, C.2, E.2 | **Open, merge sixth.** Passkeys to the manager ("$identity_credential" by identity, grant-joined lookup, counter actually checked and written back); challenges to "$identity_challenge" (single use, expiry); migrate-identities copies old rows; org-level `isTwoFactorRequired` decides the second factor; magic-link send failure no longer 500s the envelope |
| `feat/d4-lifecycle` | Tenant plan D.4 remainder | **Open, merge fifth.** "Template" on the Instances screen (service-account build, best-effort pg mark, audited); expired-demo sweep (hourly + on demand, closes and audits, drops nothing); `test/api/lifecycle.test.js` |
| `feat/d1-provisioning` | Tenant plan D.1 | **Open, merge fourth.** Resumable provisioning ("$provision", FOR UPDATE SKIP LOCKED per step), Create/Resume/Drop on the Instances screen (platform only), "$db" marker check on register, closed instances refuse sign-in. Fixes: createDatabase's registration read (manager, via the pipeline -- a lent client's uncommitted PATCH deadlocked activation) and the clone-source LISTEN release. `test/api/provision.test.js` |
| `feat/a4-admin-model` | Tenant plan A.4 (rest) | **Open, merge after B.8.** The break-glass reach: platform administrators may name another organization on the admin routes (`?organization=`/body), with a picker on the Users screen only they see; refusals for everyone else; audit against the organization acted on; 7 new tests. `isSuper` labeled "Tenant Super User" on the User Account form. Closes Tier A |
| `feat/b8-retire-role-path` | Tenant plan B.8 | **Open, merge after `feat/harness-identities`.** Deletes the role path: `authenticate` is `authenticateIdentity`, `authStrategy`/`config.authStrategy`/template key gone, `role.js` identity-only (`changeRoleCreateDb`, `grantMembership`, `revokeMembership` removed with their registrations and trigger calls), `doSignIn` pre-check and `provisionProfile` gate gone, `databaseActor` platform-admin only, Users-screen banner gone. `install.js` identity-native (`--organization`, first identity/grant/org-admin/platform-admin, no `CREATEROLE`, unknown flags fatal). Harness makes no Postgres roles for test users; identity and isolation suites use the harness server. Fixes a real defect the old oracle hid: an unauthorized PATCH of another user's password changed it before the update was refused. **Reinstall every instance after merging** |
| `feat/harness-identities` | Tenant plan B.8 (prereq 3) | **Open.** Harness seeds organization FBTest with an identity and grant per test user; server env `authStrategy: identity`; `users.test.js` rewritten for the identity path; `canSignIn`/`identity`/`grant` oracles |
| `feat/admin-instances` | Tenant plan D.4 (part) | **Open, merge after D.2** (it is stacked on it). The Instances screen: its own route and Global-group button, listing the organization's instances with their database, connection, user count, what this server is serving and whether sign-in is open; register a database that exists, attach an unattached instance, close and open. 8 new API tests; verified in Chromium. Also fixes the Users screen's icons, which rendered as literal text (`manage_accounts`) because the page wrote Material font names instead of going through `f.icon`. `client/clientmin.js` is still not regenerated |
| `fix/d3-tenant-registry` | Tenant plan D.3, improvement 5.2 | **Open, merge first of this pair.** The registry only ever grew: `deleteDatabase` spliced with a delete count of 0 and `loadTenants` only added, so a dropped or unregistered instance kept its pool and its LISTEN connection. An instance leaving now gives them up; `registryChanges` is the unit-tested decision of what leaves and `registeredTenants` reports the registry safely. Verified in-process against a live cluster |
| `fix/d2-database-api` | Tenant plan D.2, improvement 1.4 and 5.4 | **Open, merge after D.3** (it is stacked on it). Names normalized and checked before use; the manager and the cluster's own databases refused; `createDatabase` refuses a name already taken and rolls back only what it created; `createTemplateDatabase` builds under a working name and swaps, so a failed build leaves the old template; platform-admin (or super user, on the role path) check inside the three functions, every call audited. 17 live checks; api failure set identical to master here |
| `fix/debug-no-cache` | Defect | **Open, independent.** In debug mode the client files and the index page now send `Cache-Control: no-cache`, so a pull takes effect on a normal reload. A stale `client/main.js` was why the Users button looked disabled after merging the admin UI. Production responses unchanged |
| `feat/b4-b5-identity-writes` (1fc8d896) | Tenant plan B.4, B.5 | **Open, merge first.** Under `authStrategy: identity`, `server/services/role.js` writes identities and `access_grant`s instead of Postgres roles: create (an existing identity keeps its password), change password, login on/off (flips the instance grant), drop (clears `$auth`, deactivates the grant, keeps the identity). Membership changes are no-ops (B.3 reads `role_membership`). Every action audited to `admin_audit`. Manager writes are a separate transaction from the instance's, ordered so a failure is inert. New `server/services/manager.js`. Default `role` strategy is unchanged. Identity suite 24 pass; API run equals master baseline |
| `feat/manager-admin-api` (0479108e) | Tenant plan D.4 (part) | **Open, merge second** (on the first). `server/services/admin.js` and `/:db/admin/*` routes: overview, create identity, set password, activate/disable/unlock, grant/revoke instance access, org-admin flag. Three tiers: platform, organization, instance (limited to people who can already reach that instance); none gets 401 |
| `feat/manager-admin-ui` (0b5fe711) | Tenant plan D.4 (part) | **Open, merge third.** The Users screen (`client/components/admin-page.js`, route `/admin`, "Users" button in the Global group). Verified in Chromium; `client/clientmin.js` is **not** regenerated. Creating an identity here does not create the local `user_account` profile a person still needs to sign in |
| `fix/boot-order-menu` (552b5692) | Defect | **Open, independent of the stack.** The home route in `client/main.js` used a menu that does not exist until `start()` finishes (page loaded on `#!/home` before sign-in), throwing `Cannot read properties of undefined (reading 'selected')` and leaving the ribbon missing after sign-in. Guarded; verified in Chromium (reproduced on master first). Unit 306 pass. Also removes that error from the "two console errors" note below, once merged |
| `fix/install-fresh-database` | Defect | Merged. `node install.js --manager` / first install of a new database no longer dies with 25P02 (`to_regclass` probes replace try/catch around failed queries in `buildRegistry`) |
| `fix/test-required-fields` | Test defect | Merged. Test helper `createContact` supplies Employee `number`; second test database gets its admin; catalog signature ignores zero min/max; `inheritedFrom` assertion updated |
| `fix/clean-numeric-bounds` | Catalog data | Merged (#179). `scripts/clean-numeric-bounds.js` removes the editor's stray `max: 0` (dry run by default); `--clear-min` exists but John keeps `min: 0` to reject negatives |
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
| `feat/install-instance` | Tenant plan A.1 | Pushed 2026-10-10. `node install --instance <name>` builds an application database and registers it in the control plane, so a server serves it at `/<name>/`. Creates a shared `Default service` from the configured connection. **Reinstall Core after merging** -- `Tenant.contact` becomes optional. Prerequisite for the single-mode collapse |
| `wip/one-instance-mode` | Tenant plan section 9 | **Dead.** Was pushed 2026-10-10 as not-mergeable (blocked on tenant plan section 10), merged by accident as PR #161, reverted by `revert/one-instance-mode`, and the branch deleted. Its work was recovered and finished on `feat/one-mode`. Lesson adopted: nothing is pushed again until it is verified |
| `fix/0.16-unknown-property` | 0.16 | Pushed 2026-10-11. An unknown property in a query's `properties` crashed with a TypeError; now 400 naming the feather and every unknown property. Safe to merge |
| `fix/2.6-natural-key-unique` | 2.6, 3.3 | Pushed 2026-10-11. Natural keys become unique partial indexes on the declaring table and every child; an inherited key was indexed only on the ancestor, and `user_account(name)` had none. **Reinstall Core after merging** -- and if any table holds duplicate natural keys the install stops and names them. Raised 0.17 |
| `revert/one-instance-mode` | — | Pushed 2026-10-11. Reverts the accidental merge of `wip/one-instance-mode` (PR #161), restoring master to working order. **Merge first** of the three-branch stack |
| `feat/adr-002-packages` | ADR-002 | Pushed 2026-10-11, two commits. Part 1: every database gets its own catalog (`settings.catalogFor`, per-database registries, read-only enforced in the datasource as 405). Part 2: module code loads from installed packages under `modules/<name>/<version>/` (manifest service files), the `module` row's version choosing which, with DB rows as fallback; proven by a fixture package at 1.0.0 and 1.1.0 served to two databases from one process (`test/api/modules.test.js`). Appends `/fbtest/version -> fbtestVersion` to the catalog-routes golden -- **confirm that golden on a full install**. Merge second, onto the revert |
| `feat/one-mode` | Tenant plan section 9 | Pushed 2026-10-11. The collapse, rebuilt on ADR-002: `managerDatabase` (default `db_manager`) replaces `serverRole`/`both`/`controlPlane`; `"$db"` schema 2 (`manager`/`instance`) with in-place conversion, so `node install.js --instance demo` upgrades an existing database and `--manager` builds the manager; manager holds registry and sessions and is never routable; harness builds manager + two instances. Merge third. Full api suite fail-set identical to the ADR-002 baseline; unit suite clean |
| `feat/identity-cutover` | ADR-001 A.4/A.5, B.1-B.3 | Pushed 2026-10-11, two commits, on top of `feat/one-mode` (merge fourth). B.3: membership resolved by a recursive CTE over role/role_membership (`tools.memberNames`), unconditional -- the GRANTs only mirrored those rows. B.1/B.2 behind `authStrategy` ("role" default, byte-for-byte today's path; "identity" verifies scrypt in Node against the manager, imports SCRAM and md5 pg_authid verifiers with re-hash on first sign-in, enforces access_grant, locks and audits like the role path). A.5: `scripts/migrate-identities.js` backfill, dry-run default, audited. Left for B.4/B.5: stop creating login roles, user creation on the identity path |
| `fix/0.17-inherited-from` | 0.17 | Pushed 2026-10-11, on `feat/identity-cutover` (merge fifth). getFeather copies property objects instead of stamping the cached catalog; self-referential `inheritedFrom` stamps are repaired on read and scrubbed on save, so reinstalling a module cleans a polluted catalog row. Catalog-suite todo promoted to a live assertion |
| `fix/0.13-feather-denial` | 0.13 | Pushed 2026-10-11 (merge sixth). The Feather trigger checks isAuthorized before touching the payload: non-super POST /data/feather gets 401, not 500. **Reinstall Core after merging** (deployed service) |
| `fix/6.1-unhandled-rejection` | 6.1 | Pushed 2026-10-11 (merge seventh). `unhandledRejection` logs the stack and the server keeps serving (verified live: floated rejection, then HTTP 200). Hunting the floating rejections themselves stays with tenant plan E.5 |
| `fix/0.1-user-account-post` | 0.1, part of 1.1 | Pushed 2026-10-11 (merge eighth). The loop crash was already fixed on master (4254cf11) but the todo reporter masked two defects behind it: an unset `isActive` created the role NOLOGIN (user could never sign in), and adopting an existing cluster role ALTERed its password unconditionally -- adoption now requires proving the password, so test-and-production still works and takeover gets 409. Users-suite todos promoted, rewritten on Contact so they run on bare Core. **Reinstall Core after merging** |
| `fix/3.1-relation-indexes` | 3.1, 3.4 | Pushed 2026-10-11 (merge ninth). feathers.js indexes every relation column on feather save (walking the inheritance chain like 2.6), and a new install step `scripts/relation-indexes.js` sweeps the whole database, so existing databases backfill on reinstall. Schema-suite 3.1 todo promoted. **Reinstall Core after merging to backfill** |
| `fix/3.4-indexed-relation` | 3.4 | Pushed 2026-10-24. `isIndexed` on a relation property named `key.toSnakeCase()`, a column a relation does not have, and failed the whole feather save; relation properties are now left to the relation indexes (3.1). No shipped feather set the flag. Schema-suite test added. **Only half the fix**: the flag is pushed to the index list in two places and this changed one; the other is on `fix/stale-api-suites`, which the new test caught |
| `fix/quiet-test-output` | Test tooling | Pushed 2026-10-24. The default reporter prints one line per test file, each failure once (message cut to 240 characters, no SQL or stack dump), and one set of totals; todo tests are counted and any that now pass are named. `FB_TEST_REPORTER=spec` restores the old output. Unit path run; the integration path (tally across files) has since run too. Follow-up on `fix/stale-api-suites`: the runner names the file in flight, because this prints nothing until a file finishes, and `FB_TEST_SKIP` leaves one out |
| `fix/stale-api-suites` | Test suites | Pushed 2026-10-24. Thirty-odd claims across eleven API files, nearly all of them suites left behind by the users rework. Administering an organization is an appointment in `organization_admin`, read through `isOrgAdminOf`, and not `identity.is_org_admin`, which nothing reads any more; sixteen copies of a `flags` helper across fifteen suites set the column, so each granted nothing. They share `test/harness/authority.js` now, which writes the appointment and the platform flag and deliberately leaves `user_account.is_super` alone (the screen lowers it when somebody stands down, which in a suite takes away the super user the harness set up). Also: two fixture packages `deploy-failure.test.js` deploys were never committed (`fbtfail` writes a batch and then fails on a relation to a missing feather; `fbtseed` is an umbrella whose nested module seeds records into a feather it creates -- the shape the SupplyChain deploy failed on); the role a feather names is created now, so that claim asserts the grant rather than its absence; Core is its own package, so a module row with no package is made for the "answers from its row" claim; an installed catalog carries `inheritedFrom: ""`; and `user-contact-employee.test.js` uses the installed `Employee` where SupplyChain defines one. Carries 3.4's second half. *Two later commits: two suites that only passed while they ran alone (`fleet` counted every fleet-deploy audit row in the manager, `isolation` returned early from its own appoint helper on a row another suite had stood down), and the fixture packages themselves, which `.gitignore`'s bare `modules` pattern had been swallowing -- they existed only on this disk, so the suite passed here and would have failed anywhere else. The pattern is anchored to `/modules` now.* |
| `feat/4.1-named-statements` | 4.1 | Pushed 2026-10-24 **to be measured, not merged yet**. `tools.prepared` names the statements `doSelect` sends, by a hash of the text; `FB_UNNAMED_SQL=1` turns it off. 300 list reads on a fresh `demo`: 1309/1433 ms wall and 949/1038 ms planning unnamed against 496/516 ms and 274/285 ms named. `api/query` and `api/crud` unaffected; a view rebuilt under a cached plan behaves the same either way. Open: it cannot coexist with PgBouncer in transaction mode, and 4.2 would remove the cost rather than hide it |
| `fix/child-array-order` | — | Pushed 2026-10-24. A parent's child rows were started as a group and awaited together. They share the parent's connection, so nothing ran in parallel -- they interleaved in whatever order their awaits fell, which is what node-postgres warns about in every install log. Since 2.6 put a unique index behind a natural key that order is load-bearing: a work order operation's key is `<order number>#<sequence>`, so re-exploding a work order replaces each operation with a row carrying the same key, and the insert landing before the delete it replaces is refused. They run in listed order now, every delete before any insert. `supplychain/manufacturing` goes 33 to 34 of 34 |
| `fix/is-installing-stuck` | — | Pushed 2026-10-24. `isInstalling` was cleared only where an install finished, so after any failure the process believed it was installing until restart -- and SupplyChain's ShipEngine initialiser guards the whole definition of `f.shipEngine` on that flag. One line in `rollback`. No test; the flag is only visible to module code |
| `feat/minify-client-script` | 6.8 | Pushed 2026-10-26. `npm run build:client` bundles and minifies the modules `index_debug.html` names into `client/clientmin.js` (esbuild) and writes `index.html` from the debug page, so the two cannot drift. The committed bundle was missing nine components (ribbon, toolbar, dashboard, Users, Instances, connection banner and more) and `index.html` lacked `print.css`; both now match. Regenerated `clientmin.js` is part of the branch. Debug and bundled pages register identical components in headless Chromium; a signed-in run with `debug: false` is still to do. **No install or deploy needed**, so no version bump: pull, restart. `-- --check` for a release |
| `docs/test-readme` | — | Pushed 2026-10-24. Stop your own server before an integration run (the clone copes, but `api/deploy.test.js` makes a template copy of the source, which Postgres refuses while anything is connected -- nine failures that say nothing about the code); `FB_TEST_SKIP`; and what a killed run leaves behind |
| `fix/install-connection-leak` | 0.18 | Pushed 2026-10-24. `datasource.install` gave its pooled client back only where the work finished, so every failed install leaked one; eight failed deploys emptied a ten-connection pool and the next request to that instance waited for ever. Measured: +1 per failure to ten, then a deploy that never answered; flat at 3 across twelve with the fix. Claim in `deploy-failure.test.js`, which needs `fix/stale-api-suites`' fixtures, so that branch is merged in. **Merge it after that one** |
| `fix/0.11-money-formats-on-install` | 0.11 | Pushed 2026-10-24. `f.formats` was set in server.js alone, so an install run from the command line had none, SupplyChain's Common module had nowhere to register `unitCost`, `salesPrice` and `purchasePrice`, and the installer fell back to the property's type and wrote `json` where `mono` was meant -- every price and cost column. The registry is hung on `f` in `datasource.js`, which install.js loads too. Needs SupplyChain's `fix/money-formats-registered-on-load` for the other half. Verified on a fresh CLI install: 26 money columns `mono`, none `json` |
| `fix/0.11-cli-money-columns` | 0.11 | Pushed 2026-10-11 (merge tenth; doc note only). Could not reproduce without SupplyChain -- fixture money properties install as `mono` through `--dir` on current master. Reproduce with the real SupplyChain checkout before fixing |
| `feat/about-rest-api` | — | Pushed 2026-10-28, with SupplyChain's `feat/openapi` (**merge both**; either alone works, the reference just lacks SupplyChain's routes). Info button beside the bell opens About (framework, deployed modules with sub-modules in a tree under SupplyChain, collapsed until opened, Node/PostgreSQL/Express/node-postgres/Mithril/OS) with a REST API button to `/<db>/api`, where Redoc renders `GET /<db>/openapi.json`: core's `openapi.json` + a path set and schema per catalog feather + each deployed module's `openapi.json`, one tag group per source. Replaces `server/api-base.json`, the installer's `buildRestApi` and the root `/api.json`. Unit test keeps core's document and server.js's routes in step; `api/about.test.js`. Core 3.0.0-alpha.10, adds `redoc` 3.0.1: **`npm install`, restart, `node install.js --instance <name>`** for the version. Core 1097 pass; SupplyChain `common` 22 pass via `--package` |
| `feat/list-meta` | — | Pushed 2026-10-29. Formats and notes on list cells and rows. New `meta jsonb` on `object` (`isAlwaysLoad`, read only), written only by `POST /do/meta` (`server/services/meta.js`): needs update authorization, leaves `updated`/triggers/locks alone, one note per user per cell and only your own can be edited or cleared, note HTML sanitized (new dependency `sanitize-html`). Ordinary saves, copies, export, PDF and packaging ignore it. Right-click a cell: Format… (cell or row; background, text color, bold, italic, underline; swatches that switch with dark mode, or any color), Add/Edit note… (TinyMCE), Clear note, Clear cell/row format. A cell with notes gets a corner marker, its row a note icon in the lead column; hovering shows the notes under the cell's usual tooltip. User formats beat business styles (row over business, cell over row, per attribute set). Selected and hovered rows are now a tint over the row's own colors instead of replacing them. A meta-only change is announced as `meta`, so a list doesn't overwrite a row being edited. Also: the grid's context menu opens at the pointer under the page zoom. Core 3.0.0-alpha.11: **`npm install`, restart, `node install.js --manager` and `node install.js --instance <name>`** (adds the column and rebuilds every view, modules' included). Fresh and upgraded tables now differ in where `meta` sits, so **an `INSERT` without a column list into an object table breaks** -- three in Core fixed, and SupplyChain's one (`outside_process`, work orders) on its `fix/outside-process-insert-columns`, **merge with this**; Job Shop, Admin Console, CronJob and Finance not yet checked. Core api 631 pass (`api/meta.test.js` 17 of them; catalog and schema goldens regenerated, every view diff is the one `meta jsonb` column), unit 497 pass; clicked through in headless Chromium, light and dark, debug and minified, two sessions for the live update. Not run: SupplyChain's suites. **Second commit**, pushed 2026-10-29: click a header to sort by it (toggles direction when it's already the lone key), shift-click adds or flips an extra key, right-click opens a one-item "Clear sort" menu -- the pattern in `jrogelstad/ddom`'s `sort-state.js`, reusing the Sort dialog's own `filter().sort` so sorting itself doesn't change and nothing server-side does either. Header right-click reuses the row's context-menu plumbing behind a new `contextHeader` flag, so a row's own right-click menu is untouched. Core 3.0.0-alpha.12 (no install needed, client-only). Unit 498 pass (one new test driving every click / shift-click / right-click path through the render harness); golden `unit-component-form-widget-test-item.json` regenerated (two new handler attrs per header). Verified live against the running demo server with real data: ascending/descending toggle, two-column sort with order badges, the context menu's position and its single disabled-when-nothing-to-clear item, and column drag-and-drop reordering all confirmed unaffected by the new handlers. **Third commit**, 2026-10-29: the cell menu is two items, Format… and Note…, because five was too many on a screen already busy with its own actions -- each dialog carries the clearing it used to offer on the menu. Format's Clear was already in its dialog; the note dialog gains one (disabled, with the old "You have no note on this cell" wording, until `open` finds a note of your own); the header right-click menu goes entirely, and `contextHeader`, `headerActions` and `clearSort` with it, replaced by a Clear in the Sort dialog that writes `sort: []` straight to the grid's own `filter()` and closes without running `onOk`. Three defects found alongside it, two of them live on `demo`: (a) the note card's "Edit" read which note it was showing *after* `card.hide()`, which is the act that forgets it, so it threw `Cannot read properties of undefined` and did nothing, while "Clear" -- written the other way round -- worked; (b) `propagateViews` read the catalog from the settings cache, which is filled before `scripts/tables.js` patches that row in SQL, so the view rebuild at the end of an install left every view without `meta` while the tables and the stored catalog had it -- the client was told each feather carries `meta` and every read of one answered `column "meta" does not exist`. Now a forced read, which refills the cached object in place so the `getFeathers` calls behind each view see it too; **a database upgraded to alpha.11 or .12 is in that state and wants `node install.js --instance <name>` again** (`demo` had all 180 feather views short of the column, `db_manager` never upgraded and so consistent). (c) `packages.compareVersions` compared the prerelease as one string, so `3.0.0-alpha.9` sorted after `alpha.12`: an instance left on an earlier alpha counted as ahead of the server, `isBehind` said no and self-upgrade never offered it, and `newest()` picked the wrong package on disk -- now field by field, numeric fields as numbers. `openapi.json` was left at alpha.11 by the second commit, which `unit/openapi.test.js` catches; bumped with the rest. Core 3.0.0-alpha.14 (**restart**, plus the reinstall above for a database already upgraded). Unit 508 pass with master merged in, three new tests -- the two-item menu with each dialog's Clear, the card's Edit (confirmed failing on the old line with the error above), the sort dialog's Clear -- and `unit/packages.test.js` gains the two-digit prerelease case; golden regenerated (the note dialog's Clear, three header `oncontextmenu` gone). New `api/view-propagation.test.js` patches the column and the catalog in SQL behind the cache, propagates, asserts no feather view is short of it and rolls back: **not run -- no Postgres in this checkout's environment** |
| `feat/help-images` | ADR-003 | Pushed 2026-10-29, with SupplyChain's `feat/help-images` (**merge both**; each stands alone). Phase 1 of the help-images handover: the Job Shop knowledge base's pictures put back into the help. Each picture in `help/images/` (and each SupplyChain module's), named `<article-id>-<n>` so a reshot screenshot overwrites the file and no page changes; the italic caption becomes the alt text. Matched by the site's own figcaptions, not position. Core 50 pictures (`workbooks`, `worksheets`, `concepts`), SupplyChain 93. Seven captions are tables already in the Markdown and stay as text; two PDF invoices rendered to PNG; four screenshots the generator dropped put back after their "as shown below"; decorative stock photos left out. One picture is gone from the site itself (`workbooks-navigation-1`, "Workbook menu selected": attachment deleted from the media library) and stays a caption until phase 2. PNGs recompressed losslessly: 4.6 MB Core, 7.3 MB SupplyChain. Core 3.0.0-alpha.13 (no install needed: Core's help is read from disk). Unit 504 pass; every page opened in the help window in headless Chromium against a SupplyChain 2.2.47 deploy, 143 images loaded, none broken |
| `fix/help-where-you-are` | ADR-003 | Pushed 2026-10-29, **stacked on `feat/help-images`** (merge that first). Help goes last in the toolbar of whatever it is about (John: the immediate toolbar says "help for this list, this form", the corner by (i) says nothing). Worksheet: Help moves from the ribbon's top-right corner to the right end of the sheet's own toolbar, as on a form; `positionToolbarCenter` keeps the search group short of it. Home tab: Help (the Contents) moves out of Accounts to the right of the View group. Forms already had it right. Core 3.0.0-alpha.14, client only: no install. Unit 504 pass; the worksheet render test now pins Help as the toolbar's last item (fails without the fix). Checked in headless Chromium. Below about 850px wide the search group already runs off the window and now covers Help too |
| `fix/startup-error-swallowed` | 6.1 | Pushed 2026-10-29. `server.js` ended its startup chain with `.catch(process.exit)`, which hands the rejection itself to a function that wants an exit code: the handler threw its own `TypeError [ERR_INVALID_ARG_TYPE]` about the "code" argument, that became an unhandled rejection in its turn, and the reason the server would not start was discarded -- all anyone saw was the handler complaining about its own argument. In place since 2018 and harmless until startup gained a step that can fail: `buildClient.ensure()` throws when the bundle is both missing and unbuildable, which is reachable now that the bundle is no longer committed. Reproduced against a checkout without dev dependencies, where the discarded error read "The client bundle is missing and cannot be built: esbuild is not installed. Run `npm install`." -- which is how John met it. Now prints the stack and exits 1. With it, `esbuild` moves from `devDependencies` to `dependencies`, which empties the former: building the client is a startup step now, so the bundler is a runtime dependency in fact, and a server installed with `--omit=dev` could not start at all. Leaving `ensure()` non-fatal instead would trade a loud failure at boot for a client that is quietly absent. Lint at baseline, unit 508 pass; no test for the handler itself -- the top-level wiring is not reachable without starting a server |
| | ADR-002 remainder | **Mostly done 2026-10-16** -- see the ADR-002 rows at the top of this table and section 10 of the ADR. What is left: retiring the Admin Console's combined zip install in favour of Install then Deploy (a decision, not code), a fleet upgrade as one action, and section 7's two tiers for customer extension, where improvement item 0.14 still gates user columns (2.6 and 3.3 are merged) |
| | 0.1, 0.11 | After the above, one branch each (0.1 and the role-resolution part of 0.4 move to the tenant plan) |
| | 0.10 | SupplyChain repo; **done 2026-10-21 (PR #21)**, with Tier 2 -- see `featherbone-supplychain-fix-branches.md` |

## Notes from 2026-10-06 (checkout rebuilt)

- Fresh clone of `jrogelstad/featherbone` at master `920dee6`; `FeatherboneJS/Featherbone` master is the same plus one merge commit (#179). All branches on the org repo (`refactor`, `fresh_ui`, `test_suite`, `fix/test-battery`) are contained in master.
- `package.json` and `package-lock.json` were restored to master after an `npm audit fix --force` style update downgraded `pdfjs` to 0.5.4 (no `pdfjs/font/*`), which stopped the server starting. Do not use `--force` updates.
- `npm run test:unit`: 271 pass, 0 fail, 1 skipped, 16 todo (known defects, tests 0.8 and 0.9 in the plan).
- New default test reporter `test/harness/reporter.js` hides todo tests from the trailing "failing tests" block so the summary is last; `FB_TEST_REPORTER=spec` restores stock output.
- `server/config.json` is local and git-ignored: `clientPort` 3003 (browse `http://localhost:3003/demo/`), and `pgCryptoKey` must match the key `demo` was encrypted with.
