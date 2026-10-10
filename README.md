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

## Database kinds and the control plane

Every database Featherbone installs into carries a one row `"$db"` marker recording what it is for, the schema version, and its mode. Running `node install` against an existing database adds the marker; nothing else about a single database install changes.

* `both` (default) -- one database holds the application and the tenant registry, as it always has.
* `tenant` -- an application database for one company. It does not install the tenant registry.
* `controlPlane` -- a dedicated tenant management database holding the tenant registry, tenant services and sessions, with no application data.

Install flags:

```text
$ node install --control-plane --username postgres --password <pw>   # the controlPlane.pgDatabase database
$ node install --instance acme --mode test ...                       # a database named "acme", registered
$ node install --tenant --mode test ...                              # the pgDatabase database as a tenant
$ node install --target <both|tenant|controlPlane> ...               # same thing, spelled out
```

`--instance <name>` installs an application database of that name and then
**registers it in the control plane**, so a server serves it at `/<name>/`
straight away. It also creates a `Default service` pointing at the Postgres
server in `config.json`, if one is not there already, and reuses it for every
later instance. Running it again for the same database changes nothing. This
is the only way to add an instance until the administration UI arrives, and
the control plane has to exist first.

`--mode` is `dev`, `test` or `prod`. It is stored in the database (`"$db".mode`) and shown as the banner across the top of the page after sign-in, so each database says for itself what it is. The `mode` setting in `config.json` is only used for databases that have no stored mode yet.

Server settings in `config.json`:

* `serverRole` -- `both` (default), `tenant` or `controlPlane`. The server checks at boot that each database it connects to has a marker of a matching kind and refuses to start otherwise.
* `controlPlane` -- connection for the control plane database. Any blank setting falls back to the matching `pg*` setting, so only `pgDatabase` is normally needed. Environment overrides take the form `controlPlanePgDatabase`.

Feathers in `scripts/feathers.json` install into every kind of database; those that belong only to the control plane live in `scripts/feathers-control-plane.json`. A workbook manifest may declare `"target": "controlPlane"` to install only there (the default is `tenant`).

To move an existing combined install onto a dedicated control plane, install the new database with `--control-plane`, set `controlPlane.pgDatabase`, then run `node scripts/split-control-plane.js` (a dry run; add `--apply` to copy). It copies tenant services and lists the tenants to be re-entered; tenant rows are not moved yet. Nothing is deleted from the source.

This is groundwork for the tenant management rewrite: there is no administration screen for the control plane yet.

# Tests

A regression suite lives under `test/` and needs no extra dependencies (Node 18+ and the PostgreSQL client tools).

```text
$ npm test                 # unit tests, then API and SupplyChain flows (about 5 minutes)
$ npm run test:unit        # unit tests only, no database
$ node test/run.js supplychain/purchasing   # one area
```

Integration runs clone the database named in `server/config.json` (`demo` by default) into a throwaway copy, start a server on port 3990 against the copy, and drop it afterwards; the source database is never written to. See [test/README.md](test/README.md) for the settings, layout, and how to read todo tests.
