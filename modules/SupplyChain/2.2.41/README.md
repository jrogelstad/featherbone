# Supply Chain
Supply chain modules for featherbone supporting design, inventory, purchasing, production and sales mangement.

Install Featherbone as described [here](https://github.com/FeatherboneJS/featherbone)

The following additional npm modules need to be installed:

```text
$ npm install cron@1.8.2
$ npm install node-downloader-helper@1.0.19
$ npm install pdf-lib@1.17.1
$ npm install shipengine@1.0.1
```
The [conifg.json](https://github.com/FeatherboneJS/featherbone/blob/master/server/config.json) file needs to be updated to load npm modules into the Featherbone server at runtime as follows:

```text
    "npmModules": [{
        "properties": [{
            "export": "CronJob",
            "property": "CronJob"
        }],
        "require": "cron"
    }, {
        "properties": [{
            "export": "DownloaderHelper",
            "property": "DownloaderHelper"
        }],
        "require": "node-downloader-helper"
    }, {
        "require": "fs"
    }, {
        "require": "pdfmake"
    }, {
        "require": "pdf-lib"
    }, {
        "require": "shipengine"
    }, {
        "properties": [{
            "export": "Client",
            "property": "PgClient"
        }],
        "require": "pg"
    }]
```

Clone this repository to your local machine, and zip the supply-chain folder. You may then install from the Featherbone client from the `Install` menu item in the Develop workbook.

## Tests

Each module's tests live in its own `test/` folder (`sell/test`, `buy/test`
and so on), with shared builders in `common/test/lib` and each area's
helpers in its `test/lib`. They run from the Featherbone checkout, against
the version of this package deployed in the source database (`demo` by
default):

```text
node test/run.js SupplyChain            # every module's tests
node test/run.js sell                   # one module
node test/run.js --package ~/Documents/SupplyChain [sell]   # this working copy
```

They reach Featherbone's test harness as `require("featherbone-test")`; see
`test/README.md` in Featherbone and its ADR-003.
