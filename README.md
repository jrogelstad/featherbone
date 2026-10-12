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

Sign-in has two strategies, chosen by `authStrategy` in `config.json`
(ADR-001, `docs/adr-001-identity-and-tenancy.md`):

* `role` (the default) -- today's path: the password is checked by
  opening a Postgres connection as the user's login role.
* `identity` -- the password is verified in Node against the `identity`
  table in the manager. An identity belongs to an organization, a
  username is unique within its organization, and an `access_grant` row
  per instance says which databases the identity may enter -- so one
  person is one password across their test and production instances,
  and no Postgres login role is involved.

To move an existing installation, run `node scripts/migrate-identities.js`
(a dry run; add `--apply` to write). It creates the organization, attaches
registered instances, and makes an identity per existing user with an
access grant per instance. Given superuser credentials
(`--username`/`--password`) it also copies each user's password verifier
from `pg_authid`, so every password keeps working and is re-hashed to the
application's own form (scrypt) on first sign-in. Then set
`"authStrategy": "identity"` and restart; setting it back to `"role"`
reverses the cutover until login roles are retired.

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
version's services. A module with no package on the server falls back
to the code deployed into the database, so existing installations work
unchanged until they are repackaged. `modulesDir` in `config.json`
moves the directory.

# Tests

A regression suite lives under `test/` and needs no extra dependencies (Node 18+ and the PostgreSQL client tools).

```text
$ npm test                 # unit tests, then API and SupplyChain flows (about 5 minutes)
$ npm run test:unit        # unit tests only, no database
$ node test/run.js supplychain/purchasing   # one area
```

Integration runs clone the database named in `server/config.json` (`demo` by default) into a throwaway copy, start a server on port 3990 against the copy, and drop it afterwards; the source database is never written to. See [test/README.md](test/README.md) for the settings, layout, and how to read todo tests.
