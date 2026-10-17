Featherbone
===========

A JavaScript based persistence framework for building object relational database applications.

# Prerequisites

* [PostgreSQL v14.8.0](http://www.postgresql.org/)
* [NodeJS v16.20.1](https://nodejs.org/en/)

# Install



Copy the config.template.json file under the server folder to config.json and set appropriate credentials.

On the first install you will need to pass credentials of a postgres superuser that can create the database and grant permissions to your adminstrative service user defined [here](https://github.com/FeatherboneJS/featherbone/blob/master/server/config.json).

Either download and unzip the latest release, or clone this repository and from the destination location:

```text
$ npm install
$ node install --username postgres --password <your password>
$ node server
```

From your browser navigate to <http://localhost/demo> to run the application where the last part of the path is the name of your database. Use the same username and password as specified as in your PostgreSQL [configuration](https://github.com/FeatherboneJS/featherbone/blob/master/server/config.json) service user ("admin"/"password" by default) to sign in.

A documentation server may be installed from [here](https://github.com/jrogelstad/featherbone-docs)

## The manager and instances

Every Featherbone installation has the same shape: one **manager**
database holding the registry of instances, the shared services and the
sessions, and any number of **instance** databases holding application
data. Even the smallest deployment wants more than one instance --
production, test, and often a demo -- so there is no single-database
mode.

```text
$ node install --manager --username postgres --password <pw>   # the manager (default name "db_manager")
$ node install --instance acme --mode test ...                 # a database named "acme", registered in the manager
```

`--manager` builds or upgrades the manager database. Its name is
`db_manager` unless `managerDatabase` in `config.json` says otherwise; the
setting exists for developers keeping two installations on one cluster and
for the test harness, and ordinary deployments leave it alone.

`--instance <name>` installs an application database of that name and
**registers it in the manager**, so a server serves it at `/<name>/`
straight away. Run against an existing database -- including one installed
before the manager existed -- it converts the database's marker in place
and registers it, which is the upgrade path. It also creates a `Default
service` pointing at the Postgres server in `config.json`, if one is not
there already, and reuses it for every later instance. Running it again
for the same database changes nothing. This is the only way to add an
instance until the administration UI arrives, and the manager has to exist
first.

Each database carries a one row `"$db"` marker recording its kind
(`manager` or `instance`), the schema version and its mode. `--mode` is
`dev`, `test` or `prod`; it is stored in the marker and shown as the
banner across the top of the page after sign-in, so each instance says for
itself what it is. The `mode` setting in `config.json` is only used for
databases that have no stored mode yet.

The manager is never served as an application: `/db_manager/` answers 404.
Sessions for every instance live in the manager, so signing out of one
server signs out of all of its instances.

Feathers in `scripts/feathers.json` install into every database; those
that belong only to the manager live in `scripts/feathers-manager.json`.
A workbook manifest may declare `"target": "manager"` to install only
there (the default is `instance`).

## Identity sign-in

Sign-in is by identity (ADR-001, `docs/adr-001-identity-and-tenancy.md`):
the password is verified in Node against the `identity` table in the
manager. An identity belongs to an organization, a username is unique
within its organization, and an `access_grant` row per instance says which
databases the identity may enter -- so one person is one password across
their test and production instances. No Postgres login role is involved:
the service account in `config.json` is the only role Featherbone uses,
and it needs no `CREATEROLE`.

Managing users never touches the cluster. Creating a user account creates
the identity in the organization of the instance it was created in and
grants that instance; setting a password writes the identity's hash, so it
changes once for every instance the person can reach; deactivating or
deleting the account deactivates that instance's grant and leaves the
identity and the grant row in place, so the record of who could reach what
survives. Group roles and memberships are rows in `role` and
`role_membership`. Each of these writes a row to `admin_audit`.

**A grant is enough to get in.** Each instance keeps a local
`user_account` row -- the profile that holds preferences and the contact
link -- and somebody granted an instance they have never opened has
none. It is made for them the first time they sign in, on the strength
of the grant: active identity, same organization as the instance, active
grant to it. The profile joins `everyone` and nothing else, and the
making of it is audited as `user_account.provisioned`. Nothing is
created for a failed sign-in. A user who already exists in the
organization is granted access and keeps the password they already have.

### Choosing an instance

A URL with a database in it signs in to that database, as it always has.
A URL with **no** database -- the server's own root -- answers with the
**picker**: sign in once against the manager, see the instances your
grants reach, and open one. Nothing else is served there, since the
manager is not routable.

The picker proves the identity and nothing more. Opening an instance is
what proves access to *that* instance: the grant is read again at the
door, so a sign-in that now reaches several instances cannot walk into
one it was never granted, and revoking a grant shuts the door at the
next entry. An instance that is closed or down for maintenance is
listed and marked rather than hidden, so somebody who was working in it
yesterday is told why it will not open.

A username is unique within its organization, not across the
installation, so a name that exists in two organizations is asked which
one it means. The picker never lists the organizations to someone who
has not signed in -- that would say where a username exists -- and it
does not try the password against each candidate either, since a wrong
one would count a failure against every one of them and lock them all.
Type the organization's name and sign in again.

Two-factor organizations (`organization.isTwoFactorRequired`, ADR-001
C.2) can pick here but sign in at the instance: the code is sent by the
instance's own mail service, which the manager has none of. The picker
lists their instances and opening one lands on that instance's sign-in,
which asks for the factor. Nothing is admitted on a half-proved
identity.

### Administering the platform

The picker's **Administer the platform** opens the platform console, at
`/platform`, for a platform administrator. It is the only screen that
crosses organizations, and it is served where no database is named, so
it runs with no instance of its own: every act on it names what it
acts on. Authority is read from the identity each time, never taken
from the session.

It holds two lists. **Organizations** says what each one owns -- its
instances, its people, how many can administer it, and how it signs in
-- and carries the actions: create one, rename it or change its
sign-in, appoint its administrator, close it or open it again, and
build it an instance. **Every instance on this installation** is the
Instances screen without the organization boundary: each database with
its owner, its state and the connection it is reached through.

Onboarding a new organization is those actions in order:

1. **New organization** -- name it, and say whether it signs in by
   password, single sign-on or either.
2. **Appoint administrator** -- a username and a password. This makes
   the identity if there is none by that name, marks it the
   organization's administrator, and grants it no instance: who reaches
   what is that administrator's to say from the Users screen.
3. **New instance** -- build their first database from a template.

Before this, the only way was `node install.js --instance <name>
--organization "<name>"`, which made the organization and left the
service account from `config.json` as its administrator. That still
works, and is still how the first installation is built; what it can no
longer do is stay the only way.

Closing an organization stops its identities signing in anywhere --
the picker reads the organization as well as the identity -- and
touches neither its instances nor their data.

### Starting a new installation

```bash
node install.js --manager
node install.js --instance <name> --organization "<your organization>"
```

Installing an instance attaches it to the organization (created if it
does not exist; `--organization` defaults to "Default", and an instance
that already belongs to one keeps it), makes the service account from
`config.json` an identity in that organization with the password in
`pgPassword`, grants it the instance, and appoints it the organization's
administrator -- and, when it is the first identity on the platform, the
platform administrator. Sign in to `/<name>/` as that user and create the
others from the Users screen. Re-running the install on an instance is
safe: it updates the installed scripts and changes nothing in the manager
it already made.

### Moving an existing installation

An installation that predates identities has nobody who can sign in until
it has been migrated, since there is no longer any other way in. Run
`node scripts/migrate-identities.js` (a dry run; add `--apply` to write).
It creates the organization, attaches registered instances, and makes an
identity per existing user with an access grant per instance. Given
superuser credentials (`--username`/`--password`) it also copies each
user's password verifier from `pg_authid`, so every password keeps working
and is re-hashed to the application's own form (scrypt) on first sign-in.
`--org-admin <username>` appoints the organization's first administrator;
nothing else does. Then re-run `node install.js --instance <name>` on each
instance so it carries the current scripts, and restart.

```bash
node scripts/migrate-identities.js --apply \
    --username postgres --password <pw> \
    --organization "<your organization>" --org-admin admin
node install.js --instance <name>
```

The migration is one way: once an installation is on identities there is
no path back to Postgres login roles, and no tooling for one. The safety
net before it is a backup:

```bash
pg_dump <each instance> > <name>-before-cutover.sql
pg_dump <the manager>   > manager-before-cutover.sql
```

The login roles the old users had are left on the cluster; drop them when
you are satisfied, and revoke `CREATEROLE` from the service account, which
no longer needs it.

### Administering identities

The manager is not routable, so there is no database to point a browser
at to see who may sign in to what. The **Users** button in the Home
tab's Global group opens that screen inside whatever instance you are
signed in to, and shows that instance's organization: its identities,
the instances each may reach, when they last signed in, and the recent
privileged changes. From there you can add a user, set a password,
disable or release an account, and grant or revoke an instance.

What you may do depends on who you are (ADR-001):

* a **platform administrator** (`identity.is_platform_admin`) may do
  everything;
* an **organization administrator** (`identity.is_org_admin`) may manage
  anyone in their organization and grant any of its instances;
* a **tenant super user** with neither flag may only act on people who
  can already reach the instance they are signed in to.

Sign-in is organization-scoped, so a platform administrator is never
signed in to another organization's instance. For the emergency that
rule would otherwise block -- an organization whose only administrator
has left -- the Users screen offers platform administrators an
organization picker: pick the organization, suspend the departed
administrator, appoint the replacement. Every change is audited against
the organization acted on.

It is served from `client/components/admin-page.js`, which the
unbundled client (`index_debug.html`, `"debug": true` in `config.json`)
loads; the production bundle `client/clientmin.js` has to be rebuilt
before the page appears outside debug mode.

### Upgrading a fleet

Deploy from the Instances screen applies one package version to one
instance. The platform console (`/platform`) does the same across a
group: tick the instances in **Every instance on this installation**,
press **Deploy**, and choose the package.

A group is a sequence of single deployments, not a second way of
deploying: each instance is held, applied to and let go in turn, so
one is down at a time rather than all of them. That is why the
instances are named rather than implied -- trying a version in a test
database before production is the same action with one name in the
list, and an urgent patch is the same action with several.

By default the first failure stops the rest, leaving that instance
held and the ones after it untouched; the answer says how many were
deployed, which failed and how many were not attempted. Tick **Carry
on** and the instances that can take the deployment get it while the
one that could not stays held for someone to look at. Both the group
and each instance in it are audited.

### Expired demos

A demo instance (`isDemo` with an `expiration`) is closed by the sweep
once its expiration passes: sign-ins stop, the data stays, and the
close is audited. The server runs the sweep when the registry loads and
every hour after, and the Instances screen can run it early.

It is **dropped** once it has been expired for `demoGraceDays`, a month
by default. Closing is immediate and reversible because somebody may
yet ask for the instance back -- moving the expiration forward is how
they get it, since reopening one whose expiration is still in the past
only has it closed again on the next pass. Dropping is neither
immediate nor reversible, which is why it waits. The database and its
data go; the registry row stays, marked deleted, so what was there and
when it went outlives the instance. Set `demoGraceDays` to `0` in
`config.json` and an expired demo is only ever closed. A `config.json`
written before this setting existed has no such key, which reads the
same as zero: an installation being upgraded drops nothing until
somebody adds the key deliberately.

### Connection budget

Each instance the server loads gets **one** connection pool for the
whole process, capped by
`pgTenantPoolSize` (default 10) with idle clients closed after
`pgTenantIdleTimeout` milliseconds (default 60000), plus one held
connection listening for events. The manager's own pool is capped by
`pgMaxConnections` (default 10). The worst case for one node is

    instances x (pgTenantPoolSize + 1) + pgMaxConnections

One pool per database, not one per service: a dozen services each ask
for a connection pool, and until 2026-10-16 each got its own, so the
real figure was that budget times the number of services. Sharing them
is also what lets the server give a database up -- releasing an
instance before a template copy or a drop ends the pool everyone was
using, rather than one service's and nobody else's.

but a quiet instance holds only its listener, so the practical floor is
`instances + pgMaxConnections`. Size `max_connections` on the cluster
from the worst case across every node you run, with headroom; lower
`pgTenantPoolSize` or put PgBouncer in front when instances multiply.

### Administering instances

Actions on an instance work the way they do everywhere in Featherbone:
click a row to select it, and the buttons on the right of the toolbar
(Close/Open, Resume, Maintenance, Deploy, Template, Drop, Attach) enable
for what that row allows -- hover a disabled one to see why it is off --
or right-click the row for the same actions in a menu.

The **Instances** button, next to Users in the same group, is the other
half of administration: which databases this installation serves and
which organization they belong to. For each instance it shows the
database, the connection it is reached through, how many of the
organization's people may enter it, whether this server has it loaded
and listening, how many modules it carries and how many of those are
behind a package installed on the server, and whether sign-in is open.

The module count is the **fleet view**: the versions are read from each
instance itself rather than from the registry's cached copy, an
instance that cannot be asked says "unknown" rather than "none", and
hovering lists each module with its version and the newer one the
server holds. Upgrading a fleet is a rolling outage -- one instance
held at a time -- so the screen says how many are behind and leaves
the order to you.

From there an organization administrator can:

* **register** a database that already exists in the cluster -- one
  whose `"$db"` marker says it is an instance; anything else is refused
  with the reason -- so the server serves it at `/<database>/` and the
  organization's users can be granted access to it;
* **attach** an instance that belongs to no organization, as an
  installation that pre-dates ADR-001 has;
* **close** an instance to sign-in and open it again. Closing leaves
  the database alone -- nobody can enter it, everything in it stays --
  and the instance you are signed in to cannot be closed from inside
  itself. A demo instance (`isDemo`) whose `expiration` has passed is
  closed by the server itself, hourly, audited.

A **platform administrator** -- the cluster is Featherbone's, not a
tenant's -- can also:

* **create** an instance from a template, as a resumable build: clone,
  verify the clone's marker, grant every organization administrator
  access with a tenant-super-user profile, open for sign-in. Each step
  is recorded in the manager, so a build that stops resumes from where
  it left off ("Resume"), and two servers cannot build the
  same instance twice;
* **copy an instance into a template** ("Template"). The
  source must be quiet: this server lets go of its own connections,
  anyone else's make the copy refuse;
* **drop** an instance: the database and its registration, audited,
  never the one you are signed in to;
* **deploy** a package this server holds into an instance ("Deploy"): it holds the instance, applies the package, records the
  version in that instance's `module` row and lets it go. The same act
  as the command line's, audited at both ends, and a failed one leaves
  the instance held;
* **hold** an instance for a deployment ("Maintenance").
  Schema changes are not run under live traffic (ADR-002 question 7),
  so Deploy brackets itself with this state and it can also be thrown
  by hand when something stopped halfway. While it is on the instance
  answers `503` with an explanation -- not the `404` an unservable
  database used to give -- for everything except its own pages,
  sign-in and the administration routes, and only a platform
  administrator can sign in: on an installation with one instance, the
  screen that ends the maintenance is served from that instance.
  Beginning and ending are both audited.

The maintenance state is a column on the registry row, so a manager
database built before it needs `node install.js --manager` once. Until
that is run the screen reports no instance in maintenance and the
button says what to do, rather than failing: an upgrade is never
blocked by it.

Registering does not build a database: `node install.js --instance
<name>` does that, and it registers the instance as well, so the screen
is for databases that exist but are not registered here. Dropping a
database is the screen's now as well as the command line's.

A tenant super user with no organization flag sees the instance they
are signed in to and changes nothing: what a database is registered as
is not one tenant's decision. The page is served from
`client/components/admin-instances-page.js`, the same unbundled client
as the Users screen.

## Installed packages

Module code loads from packages installed on the server when they are
present (ADR-002, `docs/adr-002-packages-on-disk.md`):

```text
modules/<name>/<version>/      # npm-format package: package.json,
                               # manifest.json and the module's files
```

One directory per version, because two databases served by one process
may run different versions of one module: each database's `module` rows
say which version it deployed, and its requests dispatch to that
version's services. The module's **client** script comes from the
package too, so what the browser compiles is a file that changes only
by deployment access rather than a table row anyone with write access
could change. A module with no package on the server falls back
to the code deployed into the database, so existing installations work
unchanged until they are repackaged. `modulesDir` in `config.json`
moves the directory.

A service row belonging to **no module** is not loaded and is not
carried forward (ADR-002 question 6): such a row is source code in a
table, executed by the server, outside any module and so outside any
package. Loading only ever walked the modules, so these were never
executed; nothing said so, and the code sat there looking live. Each
database is now told once, by name, when its services load. Nothing is
deleted -- dropping someone's code is their decision:

```sql
SELECT name, module FROM data_service
WHERE NOT is_deleted
  AND module NOT IN (SELECT name FROM module WHERE NOT is_deleted);
```

### Install, and Deploy

These are two acts, and `install.js` does them separately.

**Install** puts a package's files on this server and changes no
database at all:

```bash
node install.js --package <directory-or-tarball>   # [--force]
node install.js --packages                         # what is installed
```

The source is a directory or an `npm pack` tarball. Its
`package.json` and `manifest.json` must agree about the version, and
the manifest's `module` is the directory name, because that name is
what a database's `module` row carries and what dispatch matches on. A
version already installed is left alone unless `--force` says to
replace it. If the package declares dependencies, `npm install` runs
inside its own version directory, so two versions of a module may need
different releases of the same library.

A module's **libraries** come from its own `package.json` and its own
`node_modules`, which is what lets two versions of a module need
different releases of the same library:

```json
"dependencies": {"big.js": "^6.1.1"},
"featherbone": {"libraries": {"money": {"package": "big.js"}}}
```

`featherbone.libraries` names the properties the libraries appear
under on `f`; with no such block every dependency is offered under its
own name in camel case (`big.js` as `f.bigJs`). They are loaded with
the database's modules, before the module's own code runs, so a
library that is missing is reported where it was needed instead of
stopping the server.

This retires **`ModuleNpm`**. Those rows are still honored for a module
the server holds no package for, with a line in the log saying so, and
they are read from the instance now rather than from the manager -- the
one-mode collapse had left that loader pointed at the manager, so an
instance's rows had quietly stopped being loaded at all.

**Deploy** applies one installed version to one database:

```bash
node install.js --deploy <module>[@<version>] --instance <database>
node install.js --deploy <module>[@<version>] --manager
```

It holds the instance while it works (see maintenance, above), applies
the manifest, records the version in that database's `module` row and
lets the instance go. With more than one version installed the version
must be named: holding several is the point, so the choice is not
guessed. **A deployment that fails leaves the instance held** -- the
schema is then in a state nobody has checked, and ending the
maintenance from the Instances screen is the deliberate act that says
someone has. The manager follows the same rules as any instance, but it
has no registry row of its own to hold and a manager deployment takes
the administration screens down while it runs, which is why it is a
command-line act.

`node install.js --instance <name>` with no `--deploy` is still the
whole framework install: Install and Deploy of Featherbone's own
manifest in one action, plus registering the instance and its first
identity. A failure now exits non-zero, so a script can tell.

# Tests

A regression suite lives under `test/` and needs no extra dependencies (Node 18+ and the PostgreSQL client tools).

```text
$ npm test                 # unit tests, then API and SupplyChain flows (about 5 minutes)
$ npm run test:unit        # unit tests only, no database
$ node test/run.js supplychain/purchasing   # one area
```

Integration runs clone the database named in `server/config.json` (`demo` by default) into a throwaway copy, start a server on port 3990 against the copy, and drop it afterwards; the source database is never written to. See [test/README.md](test/README.md) for the settings, layout, and how to read todo tests.
