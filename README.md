Featherbone
===========

A JavaScript based persistence framework for building object relational database applications.

# Prerequisites

* [PostgreSQL v14](http://www.postgresql.org/) or newer
* [NodeJS v20](https://nodejs.org/en/) or newer

# Install

Copy the `config.template.json` file under the `server` folder to `config.json` and set appropriate credentials -- `secret` and `pgCryptoKey` in particular; the server refuses to start with either blank. The file is optional: every setting has a built-in default (the template documents them but is never read), and an environment variable of the same name over-rides both, so a deployment can be configured entirely from its environment. Only `secret` and `pgCryptoKey` have no default.

Either download and unzip the latest release, or clone this repository and from the destination location:

```text
$ npm install
```

Every installation is one **manager** database plus one or more **instance** databases holding application data -- there is no single-database mode. "The manager and instances" just below has the build commands, and "Starting a new installation" has the full walkthrough: building the manager, building an instance, and the first sign-in. An installation from before 3.0 is not moved to it by copying files over; see "Moving an existing installation".

The browser client is served as one minified bundle, `client/clientmin.js`, unless `"debug": true` is set in `config.json`, which serves the unbundled source that `index_debug.html` lists instead. `index_debug.html` is the one list of what the client is: every module script it names goes into the bundle, in order.

**The bundle is built, not committed.** The server builds it as it starts, so `npm start` is all a deployment needs and there is nothing to remember after changing a client file. It takes about a third of a second and writes only when the sources say something different. It is in `.gitignore`: every merge that touched client code used to conflict on 400 KB of minified output.

`index.html` is still committed, since it is small, readable, and changes only when the script list does. Rebuild it after adding or removing a script in `index_debug.html`:

```text
$ npm run build:client
```

Add `-- --check` to change nothing and fail if either file is out of date, or `-- --sourcemap` to write `client/clientmin.js.map` for debugging the bundle. Edit `index_debug.html`, never `index.html` or `clientmin.js`.

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
manager. A username names one person across the whole installation, an
identity's organization says who owns the account, and an `access_grant`
row per instance says which databases the identity may enter -- so one
person is one password across every instance they reach, in whatever
organization. An email address works as a username, which is what people
reach for anyway. No Postgres login role is involved:
the service account in `config.json` is the only role Featherbone uses,
and it needs no `CREATEROLE`.

Managing users never touches the cluster. Creating a user account creates
the identity, owned by the organization of the instance it was created
in, and grants that instance; setting a password writes the identity's hash, so it
changes once for every instance the person can reach; deactivating or
deleting the account deactivates that instance's grant and leaves the
identity and the grant row in place, so the record of who could reach what
survives. Group roles and memberships are rows in `role` and
`role_membership`. Each of these writes a row to `admin_audit`.

**A grant is enough to get in.** Each instance keeps a local
`user_account` row -- the profile that holds preferences and the contact
link -- and somebody granted an instance they have never opened has
none. It is made for them the first time they sign in, on the strength
of the grant: active identity and an active grant to that instance. The profile joins `everyone` and nothing else, and the
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

A username is unique across the installation, so signing in asks
nothing about organizations: the name is one person, and what they may
reach is what they have been granted. Somebody granted instances in
three organizations sees all three listed, each marked with whose it
is. The picker still lists no organization to anybody who has not
signed in.

Two-factor organizations (`organization.isTwoFactorRequired`, ADR-001
C.2) can pick here but sign in at the instance: the code is sent by the
instance's own mail service, which the manager has none of. The picker
lists their instances and opening one lands on that instance's sign-in,
which asks for the factor. Nothing is admitted on a half-proved
identity.

### Single sign-on

An organization can sign in through an identity provider instead of,
or as well as, a local password. Microsoft Entra ID -- still called
Azure AD everywhere -- is the reference target, and any OpenID Connect
provider works the same way.

Set it up from the platform console: select the organization, press
**Single sign-on**, and give it the issuer, the client id and the
client secret. For Entra ID the issuer is
`https://login.microsoftonline.com/<directory>/v2.0`. Register
`<your address>/auth/sso/callback` as the redirect URI with the
provider, and set `ssoCallbackUrl` in `config.json` if the server sits
behind something that rewrites the host.

The organization's **sign-in** setting then decides what is allowed:
`password` ignores the provider, `sso` refuses local passwords (the
password is not even checked -- there is nothing to learn from the
answer), and `both` takes either. At the picker, **Sign in with single
sign-on** asks which organization and sends the browser on from there.

**Who somebody is** comes from the provider's subject, never the email:
an address can be reassigned to a new employee, `sub` at an issuer
cannot. The first time a subject arrives, one of three things happens.
It is already linked, and is that identity. Its user name is an
identity that already exists here, and the two are linked -- the person
who was here before the organization moved to single sign-on keeps
their account and everything granted to it. Or neither, and an identity
is **made** if the provider is set to make them, granted the databases
the provider names and nothing else. All three are audited.

A group claim can carry the organization-administrator flag, and it is
applied on every sign-in rather than only the first, so a group taken
away at the provider is taken away here. Platform administration is
never a claim: a provider belongs to one organization, and that flag
crosses all of them.

A suspended or locked identity is refused whatever the provider says --
it vouches for who somebody is, not for whether they may come in -- and
an organization that requires a second factor is satisfied by the
provider's own policy, since it applied that policy before it vouched
for anyone.

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
build it an instance. **Instances** is the Instances screen without
the organization boundary: every database on the installation with its
owner, its state and the connection it is reached through. Each list
carries its own toolbar, so the actions on an organization are never
mixed with the actions on an instance, and **Show selected
organization's instances** narrows the second list to the organization
selected in the first.

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
its users have been made identities. That one-time backfill is no longer
part of the tree: every installation in use has been moved, and the
script (`scripts/migrate-identities.js`) was removed. If you do hold an
older one, run the script from the `v3.0.0-alpha.1` tag against it, then
come back to this version. Take a backup first; the move was one way:

```bash
pg_dump <each instance> > <name>-before-cutover.sql
pg_dump <the manager>   > manager-before-cutover.sql
```

The login roles the old users had are left on the cluster; drop them when
you are satisfied, and revoke `CREATEROLE` from the service account, which
no longer needs it.

### Upgrading where there is no command line

A hosted installation is deployed by restarting the process, and there is
often nowhere to type the upgrade. Two switches do what `install.js
--manager` and `install.js --instance <name>` would have done, when the
server starts and before anything reads a database:

```jsonc
{
    "selfUpgradeManager": true,
    "selfUpgradeInstances": true
}
```

Both are off by default, and each can be supplied as an environment
variable of the same name. On, each one first compares the Core version a
database carries with this checkout's `manifest.json`, so an ordinary
restart of a current installation runs nothing and costs a few queries:

1. **`selfUpgradeManager`** — the manager database is absent, is not a
   manager, or carries a Core version behind this checkout's:
   `install.js --manager`. That applies the whole manifest to the manager,
   including the steps that reshape its data.
2. **`selfUpgradeInstances`** — every instance in the manager's registry
   whose Core version is behind this checkout's, or that carries none:
   `install.js --instance <name>`. There is no list to keep; the registry
   is the list. (A manager built by this very boot has no registry yet, so
   the instances follow on the next start.)

The manager goes first. The server does not listen until the upgrade
is done, so it prints what it is doing to the console as it goes -- the
plan, each step with the installer's own output, and how long each took --
whether or not `consolelog` is on. What runs is the command line itself, as a child
process, so there is one installer to keep right. Neither switch touches
identities or organizations.

One upgrade runs at a time across nodes, on an advisory lock taken on the
cluster's maintenance database; a node that loses waits, and then finds
nothing left to do. If the service account cannot reach that database the
upgrade says so and goes ahead without the lock.

A failed instance upgrade **holds that instance** (ADR-002 question 7) and
lets the server start, so a platform administrator can still sign in and
read what happened rather than watching a process restart forever. A
failed *manager* build stops the server: there is nothing to serve
without one.

#### Upgrading on demand, from the screen

A restart is not the only way. **Upgrade** on the Instances screen (one
instance, the one selected) and the same button grouped on the platform
console (whichever instances are ticked, even just one -- it never got
a second, single-row button of its own, any more than Deploy did)
applies the framework's manifest there and then — the same act, asked
for on purpose. Deploy beside it is for packages the server holds in
`modules/`, and the framework is not one of them, so Core has its own
button and, on the platform console's fleet table, its own **Core**
column -- separate from **Carries**, which is the modules' -- saying
which version each instance carries and whether it is behind this
server. The button's own tooltip says what it would bring that
instance up to.

The instance is held while the manifest is applied and let go afterwards,
and both ends are audited. One that fails stays held, like a failed
deployment. Ticking several instances and pressing **Upgrade** above the
list does them one after another, so the outage rolls; the first failure
stops the rest. Both are a platform administrator's alone.

Re-applying to an instance that is already current is allowed and is how
a changed script reaches it — the installer makes nothing twice.

Both screens show a progress meter while the install runs, polling a
percent complete under a process id the screen picked when it sent the
request -- so a long upgrade (or deploy, which gets the same meter) reads
as working rather than hung, fleet-wide ones especially.

Note that this upgrades a database that is **already registered**. A
database that predates the manager has no `"$db"` marker, so the console
refuses to register it; `install.js --instance <name>` converts and
registers it in one act. The self upgrade switches do not reach such a
database either: they upgrade what the registry already holds.

### Settings the organization owns

A customer's letterhead and their mail account are the same wherever
something is printed or sent from, so they belong to the organization
rather than to each instance: production, test and demo read one copy
instead of three that drift apart. They are stored against the
organization in the manager, and the screen that edits them does not
move — it is still **Settings** in the Home tab's Global group, beside
the other organization-level data.

A settings property says so for itself, with `"isOrganization": true` in
its definition, so one document can hold both kinds. In `globalSettings`
every property is the organization's.

Nothing is migrated. An organization that has never saved these has no
row of its own, and the instance's own values answer until the first
save, which is what moves them. Each instance also keeps a full copy of
what was saved, so a database detached from its organization still has
something to fall back on.

The mail password is encrypted at rest in the manager with the same
`pgCryptoKey` as everywhere else. An edit made in one instance is an edit
to what the organization's other instances read — which is the point, but
worth knowing before changing the SMTP account from a test database.
Other nodes pick the change up as their own caches turn over.

**The logo** is a pointer rather than a record: a URL, or the name of a
file uploaded to this server, which printing reads from `files/upload/`.
It used to relate to a `ResourceLink`, whose row lived in one instance
and nowhere else; as a pointer it travels with the rest of the
letterhead. An installation that already has the old shape keeps
printing — the old value is still read — and a local file name only
reaches a server that holds the file, so a multi-node installation wants
a URL.

Settings still takes a pasted URL in the box, but there is also an
**Upload** button beside it: choosing a file sends it through the same
upload the rest of the server already serves files from, and points the
setting at whatever name it was given. That upload is behind
`fileUpload`, off by default like the rest of the server's uploads, so
turn it on for the button to do anything.

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
* an **organization administrator** -- an appointment over that
  organization (`organization_admin`) -- may manage anyone in it and
  grant any of its instances. One person may hold as many appointments
  as they need, which is how a reseller administers several customers
  from one account;
* a **tenant super user** who is neither may only act on people who
  can already reach the instance they are signed in to.

Any existing user can be appointed, whichever organization owns their
account: appointing somebody is what brings them into an organization's
administration, and nobody needs a second account to be appointed. What
appointment does not hand over is the account itself -- its password and
whether it may sign in at all stay with the organization that owns it,
so appointing an outsider cannot become a way to take the account they
use elsewhere. Only a platform administrator crosses that line.

A session is established against one instance, so somebody who answers
for several organizations names the one they mean: the Users screen
offers an organization picker to platform administrators (every
organization, which is also how an organization whose only
administrator has left is rescued) and to anybody appointed over more
than one. Every change is audited against the organization acted on.

It is served from `client/components/admin-page.js`, which
`index_debug.html` lists and so `npm run build:client` bundles into
`client/clientmin.js`.

### Settings the platform owns

A settings row is normally the instance's own: its super user may
change it, and `$auth` can grant others the same. Some settings are not
the instance's to decide. The **edition** is the case this exists for
-- it says what an instance offers, which is the platform's to set and
not the customer's, even though the customer's administrator is super
user in their own instance.

A setting becomes the platform's in either of two ways:

* its definition says `"isPlatformOnly": true`, which is how a module
  declares one of its own settings; or
* `config.json`'s `platformOnlySettings` names it, which is how an
  installation locks a module's setting down without waiting for the
  module to declare it:

```json
"platformOnlySettings": ["jobShopSettings"]
```

Changing one then needs a platform administrator -- the identity flag
in the manager, not the instance's super user -- and anyone else is
told whose it is. Reading is unchanged: the platform decides who sets
it, not who sees it. The framework's own saves (the feather catalog
and the like) are internal and unaffected.

This is the answer to the plan's D.5: an edition is **not** a security
boundary. Every feather and route is installed whatever the edition, so
it decides what is offered rather than what is possible, and treating
it as a wall would mean a package per edition. What is a boundary is
*who may change it*, and that is here.

### Upgrading a fleet

Deploy from the Instances screen applies one package version to one
instance. The platform console (`/platform`) does the same across a
group: tick the instances in **Instances**, press **Deploy**, and
choose the package. A tick the organization filter has hidden drops out
of the deployment, so Deploy never acts on an instance that is not on
show.

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

### Which half a module is on

A module runs from its package when this server holds that module at
the version the database says it carries, and from the database's own
rows otherwise. It is decided per module and per database, so an
instance can have one of each, and the rows are not deleted when a
package takes over: they are the fallback for a module with no
package, and the record of what a database carried before it was
packaged.

They are no longer what runs, though, and they used to say nothing
about it. Two things now do.

**The rows refuse to be changed.** A change to `module.script` or to a
`data_service` row of a module this server serves from a package is
refused with a 405 naming the module and version, because the save
would look like it took and change nothing. The refusal is by where
the call came from rather than by who made it: Install and Deploy
write those rows as part of their work and arrive with a client of
their own, so they are unaffected, while a person at the Develop
workbook is refused -- including a super user, who is exactly who gets
past every other check.

**The screens say which.** The Instances screen and the platform
console mark each instance:

* **`N behind`** -- it carries a version older than one this server
  holds. Deploy it.
* **`N adrift`** -- it names a version this server does **not** hold,
  so it has quietly fallen back to running the code in its own tables.
  Nothing else tells you this. It happens when a server is rebuilt
  without its packages, or when a second node was never installed to,
  and it means two nodes can run different code for the same database.
  Install the package, or deploy a version this server has.
* **`N from rows`** -- modules with no package on this server at all.
  Core is one of these today: it is installed from the repository
  rather than as a package, so every instance says so until that
  changes.

### Install, and Deploy

These are two acts, and `install.js` does them separately.

**Install** puts a package's files on this server and changes no
database at all:

```bash
node install.js --package <zip-tarball-or-directory>   # [--force]
node install.js --packages                             # what is installed
```

The source is a **zip**, an `npm pack` tarball, or an unpacked
directory. Zip is Featherbone's own format -- it is what the packager
writes and what every package shipped before this looks like -- and a
zip made by compressing a folder is read as well as one holding its
files at the root. The format is taken from the file's own bytes
rather than its name, so a package that was renamed on the way still
reads. Where the package carries a `package.json`, that and
`manifest.json` must agree about the version, and
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

From the platform console, **Manage packages** on the top toolbar does
the same from a screen: it lists what this server holds, which
instances run each version, and whether a newer one is installed. **Add
package** uploads one; **Remove** takes one off. A version an instance
is running cannot be removed -- that version is the code the instance
executes, so removing it would drop the instance back to the rows in
its own database without anything saying so -- and nor can one while an
instance cannot be asked what it carries, since an instance that cannot
be seen may be running it. The refusal names the instances either way.

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

A regression suite lives under `test/` and needs no extra dependencies (Node 20+ and the PostgreSQL client tools).

```text
$ npm test                 # unit tests, then API and SupplyChain flows (about 5 minutes)
$ npm run test:unit        # unit tests only, no database
$ node test/run.js supplychain/purchasing   # one area
```

Integration runs clone the database named in `server/config.json` (`demo` by default) into a throwaway copy, start a server on port 3990 against the copy, and drop it afterwards; the source database is never written to. See [test/README.md](test/README.md) for the settings, layout, and how to read todo tests.
