# ADR-002: Packages on disk, and Install apart from Deploy

Status: **accepted**, 2026-10-11 -- every question in section 8 settled
the same day. Supersedes the choice offered in `tenant-management-plan.md`
section 10.
Author: John, written up by Claude from his direction of 2026-10-11.
Implementation status as of 2026-10-16 is the last section; the decision
itself is unchanged.

## 1. The question that forced this

Section 10 asked where a server's catalog and route table should come from
once the database it is configured against is a manager holding no
application modules. Three answers were offered: nominate a primary
instance, make the catalog per instance, or push every module's feathers
into the manager.

All three are wrong, because they assume the answer has to be *a database*.

The requirement is broader than section 10 framed it:

> We would like to support multiple applications and multiple versions of
> applications across databases, so routes need to register module+version
> for each type that exists. However, we should also assume that often there
> will be copies of the same database on the server (such as the test and
> production example), so we don't need to register routes by database --
> that would bloat memory and be redundant.

Register per database and a shop running production, test and demo of the
same application pays for three copies of identical code. Register per
database and you still cannot answer which database owns the canonical copy
of version 2.2.0. The question has no good answer because the premise is
wrong: **no database should own it.** The server should.

## 2. What is in the database today

Precisely, so the move is not guesswork:

| What | Where | Executed |
| --- | --- | --- |
| Server-side services | `Script.script`, a text column | `new Function("f", …)(f)` in `datasource.js` ~2497, in the server process |
| Client module scripts | `Module.script` | `new Function("f", …)(f)` in `client/main.js` ~1089, in every browser |
| Routes | `Route` (`module`, `path`, `function`) | `registerRoute` (`server.js` ~573) mounts `/:db/<module><path>`; `function` names a service registered by the scripts above |
| Feathers | the `catalog` settings row, plus `feather`, `feather_property`, `feather_authorization` | read into the process at boot; defines every table |
| Forms, print forms, styles, help | `Form`, `Style`, `HelpLink`, `ResourceLink` | rendered by the client |
| Module library dependencies | `ModuleNpm` (`module`, `package`, `version`, `property`, `export`) | loaded into the process at boot, globally |
| Workbooks and settings | `$workbook`, `$settings` | per database |

So two of these are not data at all. **`Script.script` and `Module.script`
are source code kept in a table and compiled at run time.**

## 3. Decision

Module code and schema definitions move to a versioned structure on the
server's file system. A database holds data, the things that are genuinely
per-database, and a record of which module versions have been deployed into
it. Installing a package and deploying it become two different acts.

## 4. Why

**It is the only answer that scales to versions.** Code loaded once per
`(module, version)` and dispatched by the requesting database's deployed
version costs one copy however many databases share it -- which is exactly
John's test-and-production case. The URL does not change; dispatch gains a
lookup from database to version.

**It closes a remote code execution path.** Today, write access to the
`Script` table is arbitrary code execution in the server process, and write
access to `Module.script` is arbitrary JavaScript in every user's browser.
No amount of `$auth` tightening changes the shape of that: the privilege
boundary for *running code on the server* is currently a row permission.
With code on disk the boundary becomes file system and deployment access,
which is where it belongs. This is a stronger argument than the performance
one and it should be stated first.

**It removes metadata reads from the request path.** Code and feather
definitions read from disk once at boot cannot be re-read per request.
Improvement item 4.3 found `form_attr_column` scanned 3,044 times in a few
minutes; 4.1 and 4.2 are the same family.

**The reason it was in the database no longer holds.** The original aim was
an embedded IDE: database-driven, edit and run in real time, the application
independent of the file system. With Claude writing most of the code, an
in-application editor for modules, services, routes, relations and feathers
earns nothing, and the reflective approach brings the performance and
security costs above.

## 5. What this answers that was open

* **Section 10** -- the catalog comes from disk, per `(module, version)`. A
  database's catalog is the union of the modules deployed into it. Options
  A, B and C are all withdrawn.
* **D.5 and improvement item 5.6** -- "are edition limits a real boundary?"
  becomes answerable, because two instances can genuinely carry different
  modules instead of sharing one catalog.
* **Improvement item 0.15** -- a catalog can gain a property setting but not
  lose one, so a type or a precision cannot really be changed. With versioned
  definitions on disk, Deploy computes the difference between the version a
  database is on and the version it is going to, and can express a removal
  explicitly. This is the structural fix rather than another workaround.

## 6. The model

### Install (the server)

Registers a package's files on the server: unpacked to
`modules/<name>/<version>/`, recorded so the server knows which versions
exist. Nothing about any database changes. A platform administrator does this
from the Admin Console, or it arrives by whatever mechanism puts files on a
server. The format and the layout are settled in section 8, question 1.

### Deploy (a database)

Applies a module version to one database: creates or alters its tables,
loads its workbooks and data, and records the version now deployed there.
This is the step that exists today inside `node install`, separated out and
named.

**The existing path is preserved.** Installing a package into a database
from within that database's instance keeps working exactly as it does now --
it simply becomes Install followed by Deploy in one action. What changes is
that the Admin Console's install does *only* the server half, and databases
are brought up separately and deliberately.

### Dispatch

The server loads each installed `(module, version)` once: its services, its
routes and its feather definitions. A request names a database; the database
names its deployed versions; dispatch picks the matching handler. Routes stay
mounted at `/:db/<module><path>`, so no URL changes.

### What stays in the database

Forms, print forms, help, styles, **feather authorizations**, workbooks,
settings -- and the data. These are per-database by nature: two copies of one
application may legitimately differ in layout, in what is on a report, or in
who may read a column.

The "Develop" workbook therefore keeps forms, print forms, help and styles,
and **gains feather authorization editing**, which it needs because there
will otherwise be no way to set authorizations once feather editing leaves
the UI.

## 7. What is given up

Stated plainly, because these are real and some are John's to accept.

* **Editing feathers, services, routes and modules in the application is
  gone.** Accepted deliberately.
* **Adding a column through the UI is gone, and is replaced by two tiers**
  (settled 2026-10-11). This was the one question that could have changed
  what gets built, so it is written out in full rather than listed as a
  loss.

  **A package, for anything real.** A customer who needs more than fields
  gets a package of their own that builds on the ones they have, declaring a
  feather that inherits an existing one and adds columns. This needs a
  developer, which John judges warranted: companies are generally not expert
  enough to change a schema safely, and the discipline is the point.

  *This works on a mechanism that already exists.* Featherbone compiles
  `inherits` to Postgres table inheritance -- `feathers.js` ~1830 emits
  `INHERITS (%I)`, and `document` inherits `object`, `feather` inherits
  `document`, and so on all the way down. So `AcmeItem inherits Item`
  produces `acme_item INHERITS (item)`, and every query on `item` sees Acme
  items, while the added columns stay invisible to anything that only knows
  `Item`. A relation holding an `Item` can hold an `AcmeItem`. Nothing new
  is needed for the data model.

  *But the mechanism has known defects, and leaning on it harder makes them
  matter more.* Postgres does not propagate unique constraints or foreign
  keys to inheriting tables, which is improvement item 2.6 (natural keys are
  not unique in the database) and 3.3 (natural-key and status indexes sit on
  empty parents). Both should be fixed before extension-by-inheritance is
  offered to customers, or a customer's subclass will quietly escape the
  parent's natural key.

  **Spare user columns, for simple fields.** The classic approach: a fixed
  set of user columns on tables, which a customer aliases and places on
  forms themselves. The alias is per-database metadata and so lives with
  forms and styles, surviving Deploy. The limit is deliberate -- **no
  business logic on a user column without a package** -- so anything
  conditional, calculated or validated needs a development environment.

  *One gap to close first.* There is no column-level authorization today
  (improvement item 0.14), so a user column is readable by anyone who can
  read the row. That is fine for a label or a reference number and wrong for
  anything sensitive, and customers will reach for the second before being
  told.
* **Edit-and-run immediacy.** A development mode that watches the module
  directory and reloads would cover most of it.
* **`ModuleNpm` rows go away** (see section 8, question 1). Any module
  declaring its libraries that way needs them moved into its `package.json`.
* **Existing databases carrying hand-edited definitions.** Anyone who changed
  a feather or wrote a service through the UI has it only in their database.
  The migration needs to export what is there and reconcile it against the
  package it came from, and report what it cannot.

## 8. Questions, and the answers

1. **Settled 2026-10-11: npm is the package format and the transport;
   Featherbone owns the layout.**

   Every module becomes a valid npm package -- a real `package.json` with
   name, version and dependencies, and `"private": true` so `npm publish`
   refuses outright. It travels as an `npm pack` tarball, a git tag, or a
   private registry later; all three produce the same artifact, so the
   choice of channel can be deferred. Install unpacks it to
   `modules/<name>/<version>/`, one directory per version.

   *Why not npm's own installer.* npm is three things: a format, a
   transport, and a resolver that writes `node_modules/<name>` -- one
   version per name, driven by a single root `package.json`. Only the third
   is a poor fit, and only because of one requirement: two versions of a
   module must be live in **one process**, since test may run 2.1 while
   production runs 2.2. npm can express that only through aliasing
   (`"supplychain-2-1": "npm:@fb/supplychain@2.1.0"`), which means editing
   `package.json` every time a deployed combination changes -- a worse
   version of the problem this ADR exists to solve.

   The deeper reason is that **a module is not a dependency of Featherbone**.
   It is a runtime plugin: chosen by an administrator, installed after the
   fact, several versions at once. npm's installer solves build-time
   dependencies of one application, which is a different problem. VS Code
   does exactly this -- extensions are npm-format packages shipped as zips,
   placed in `extensions/<publisher>.<name>-<version>/` by its own
   installer. `require()` caches by resolved path, so one directory per
   version gives genuinely separate instances.

   *npm's installer is still used*, inside each module version, to install
   that module's own libraries into its own `node_modules`. Its
   one-version-per-name rule is exactly right at that scale.

   **This retires `ModuleNpm`.** Library dependencies are declared in the
   module's `package.json` instead of in rows, and
   `npm install --prefix modules/<name>/<version>` isolates them per
   version. That also fixes a live collision: today those rows are loaded
   globally into the process ("Applying npm packages..."), so two module
   versions needing different releases of the same library cannot both be
   satisfied.

   *What is given up, on the record:* `npm ls`, `npm outdated` and
   `npm audit` will not see Featherbone modules, so their equivalents have
   to be built -- the manager already needs "which instances are behind", so
   one mechanism serves both. There is no deduplication across module
   versions, which costs disk rather than correctness. And resolution is
   ours to do, using the `semver` package for comparison.
2. **Settled: a table beside `"$db"`, one row per module with its version.**
   The same record is what lets the manager show which instances are behind,
   so one mechanism serves Deploy and the fleet view. It is also what
   dispatch reads to pick a handler.

3. **Settled: yes, one process must hold two versions of a module whose
   feathers differ.** Otherwise test and production cannot run different
   versions, which is the whole point. The in-process catalog is therefore
   keyed by `(module, version)` rather than global -- the real work in this
   ADR, and the thing section 10 of the tenant plan was groping for.

4. **Settled: forward only. Rollback is restore from backup.** A migration
   forward can be expressed; the reverse often cannot. This has never been
   handled properly before either, so nothing is being given up. *Deploy
   should therefore confirm a restore point exists before it begins* --
   "forward only" is only safe if the backup is real.

5. **Settled: yes, the manager follows the same rules.** It is a Featherbone
   application with its own modules and its own version. *One consequence:
   upgrading the manager takes down the administration UI that would
   otherwise drive it, so a manager Deploy is a command-line operation.*

6. **Settled: dropped, deliberately.** `Script` rows that belong to no
   module are not carried forward. They were a loophole that could create
   problems rather than a feature worth preserving.

7. **Settled: a database is down, or in maintenance mode, for any install or
   upgrade.** Schema changes under live traffic are not attempted.

   *Three consequences.* The instance record needs a state -- active or in
   maintenance -- which Deploy sets and clears. The router must refuse an
   instance in maintenance, with something better than a 404. And a fleet
   upgrade across many instances is a rolling outage, which is an operational
   fact the manager's fleet view should make visible before someone starts
   one.

**Nothing in this ADR is open any more.** What remains is implementation,
and the order in section 9.

## 9. What this does to the existing plans

This is larger than anything left in `tenant-management-plan.md` and it
changes the shape of several items.

* **Section 10 is withdrawn** in favour of this ADR.
* **`wip/one-instance-mode`** is not wasted: configuration, the `"$db"`
  marker, Install targets, boot checks and the harness all stand. *Update:
  rebuilt on this ADR as `feat/one-mode` and merged; the wip branch is
  obsolete.*
* **D.4 and D.5** are partly absorbed: the Admin Console seam is now the
  Install/Deploy split, and editions become enforceable. *Update: D.4 is
  done (registry, provisioning, templates, sweep in the framework; the
  module keeps commerce). D.5 is still a decision, now cheaper because the
  per-database catalog exists.*
* **Improvement items 4.1, 4.3 and 0.15** are substantially addressed.
* Tier B (identity) is **untouched** by this and can proceed in parallel.

Suggested order: the deployed-version record first (section 8, question 2),
because dispatch, Deploy and the fleet view all hang off knowing which
version a database is on. Then the per-version catalog (question 3), which
is the bulk of the work. Improvement items 2.6, 3.3 and 0.14 should be
fixed before extension-by-inheritance or user columns are offered to
customers, for the reasons in section 7.

## 10. Implementation status, 2026-10-16

**Built and merged** (`feat/adr-002-packages`, `feat/one-mode`; see
`featherbone-fix-branches.md`):

* Every database has its own catalog (`settings.catalogFor`) and its own
  route and service registries; routes mount once through `mountedRoutes`
  and dispatch by what the requesting database deployed.
* Module server code loads from installed packages under
  `modules/<name>/<version>/`, the database's `module` row choosing the
  version, with the old table rows as the fallback. Proven by a fixture
  package at 1.0.0 and 1.1.0 served to two databases from one process
  (`test/api/modules.test.js`).
* Catalog loading is invalidation-based (the next request reloads), and the
  datasource refuses writes to a read-only package-defined feather (405).
* The manager is never routable and holds no application modules; the
  `"$db"` marker (schema 2: `manager` and `instance`) and Install targets
  stand.

**Not built:**

* Install/Deploy separation in the UI, and the fleet view (which instance is
  on which version, upgrade the ones behind).
* Client module scripts served from disk; they are still `Module.script`
  rows compiled in the browser.
* Manager Deploy via the CLI, and dropping the now-redundant module-less
  `Script` rows.
* D.5 (editions as a boundary) is enforceable on this foundation but not
  decided.
* Improvement items 2.6, 3.3 and 0.14 still gate offering extension by
  inheritance or user columns to customers (section 7).

**Known open:** the catalog-routes golden gained `/fbtest/version ->
fbtestVersion`; confirm it on a full install with SupplyChain and Job Shop,
which the sandbox lacks.
