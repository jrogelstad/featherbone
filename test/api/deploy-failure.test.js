/*
    A package install that fails, and one that seeds its own feather.

    A deploy of SupplyChain failed on `relation "_sales_region" does not
    exist` and the platform console said "Deployed" over it. Three
    separate things were wrong, and each is pinned here:

    - A batch of records for a feather the install itself creates ran
      before that feather's view existed, because an umbrella install
      makes views at the end. It now waits for them.
    - The installer's rollback never marked its progress record failed,
      so the record stayed "processing" until the next restart swept it.
    - The fleet routes answer 200 with `ok: false` results, which is
      what the platform console has to read. The console's own half of
      this (it said "Deployed" whatever the answer) is client code and
      is not covered here.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {flags} = require("../harness/authority");

const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const VALUE = "FBT Fail";


async function signedIn() {
    let session = new Session(ROOT);
    let resp = await session.signIn(
        settings.adminUser,
        settings.password,
        "FBTest"
    );

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

async function fleetEntry(session) {
    let overview = await session.get("/platform/overview");
    let fleet = overview.fleet || [];
    let found = fleet.find((one) => one.database === settings.testDb);

    assert.ok(found, "the instance is listed");
    return found;
}

/*
    How many connections this database has, to see whether a failure
    gave its own back. Counted from the server's side rather than from
    a pool report, because the client that leaked was checked out of
    the pool and still looked perfectly alive from inside it.
*/
function connectionCount() {
    return db.withClient("postgres", async function (client) {
        let resp = await client.query(
            (
                "SELECT count(*)::int AS n FROM pg_stat_activity " +
                "WHERE datname = $1"
            ),
            [settings.testDb]
        );

        return resp.rows[0].n;
    });
}

function failedLinks() {
    return db.withClient(settings.testDb, (client) => client.query(
        "SELECT id FROM help_link WHERE display_value = $1",
        [VALUE]
    ));
}

describe("a package install that fails", function () {
    let session;
    let target;
    let processId = "fbtfail" + Date.now().toString(36);

    before(async function () {
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        session = await signedIn();
        target = await fleetEntry(session);
    });

    after(async function () {
        // Whatever happened above, leave the instance open
        await session.raw("POST", "/platform/instance/maintenance", {
            id: target.id,
            isMaintenance: false
        });
        await flags(settings.adminUser, {});
    });

    it(
        "answers with an error that names the package and the reason",
        async function () {
            let resp = await session.raw("POST", "/platform/instance/deploy", {
                id: target.id,
                module: "fbtfail",
                processId,
                version: "1.0.0"
            });

            assert.ok(resp.status >= 400, "not a success: " + resp.status);
            assert.match(
                JSON.stringify(resp.body),
                /fbtfail 1\.0\.0 was not deployed/
            );
        }
    );

    it(
        "rolls back what the package had already written",
        async function () {
            let resp = await failedLinks();

            assert.equal(resp.rows.length, 0, "the first batch is undone");
        }
    );

    it(
        "marks the install's progress record failed, with the reason",
        async function () {
            let resp = await db.withClient(
                settings.testDb,
                (client) => client.query(
                    "SELECT status, error_message FROM server_process " +
                    "WHERE id = $1",
                    [processId]
                )
            );

            assert.equal(resp.rows.length, 1, "the record exists");
            assert.equal(resp.rows[0].status, "E", "failed, not processing");
            assert.ok(resp.rows[0].error_message, "and says why");
        }
    );

    /*
        The deployment rolled back before it committed, so the database
        is as it was and holding it would only lock everyone out. It is
        let go at once and the answer says so (John, Oct 2026: "auto
        release"). A failure AFTER the commit still holds it -- that is
        the case where there is something for a person to check.
    */
    it(
        "lets the instance go, because nothing was committed",
        async function () {
            let now = await fleetEntry(session);

            assert.equal(now.isMaintenance, false, "open again");
        }
    );

    it(
        "says in the answer that nothing was changed",
        async function () {
            let resp = await session.raw("POST", "/platform/instance/deploy", {
                id: target.id,
                module: "fbtfail",
                version: "1.0.0"
            });

            assert.equal(resp.status, 500, JSON.stringify(resp.body));
            assert.match(String(JSON.stringify(resp.body)), /Nothing was changed/);
            assert.match(String(JSON.stringify(resp.body)), /open again/);
        }
    );

    it(
        "still lets an administrator hold and release by hand",
        async function () {
            let resp = await session.raw(
                "POST",
                "/platform/instance/maintenance",
                {id: target.id, isMaintenance: true}
            );
            let now;

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            now = await fleetEntry(session);
            assert.equal(now.isMaintenance, true);

            resp = await session.raw("POST", "/platform/instance/maintenance", {
                id: target.id,
                isMaintenance: false
            });
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            now = await fleetEntry(session);
            assert.equal(now.isMaintenance, false);
        }
    );

    it(
        "reports the failure in the fleet answer, which is a 200",
        async function () {
            let resp = await session.raw("POST", "/platform/instances/deploy", {
                instances: [target.id],
                module: "fbtfail",
                version: "1.0.0"
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.equal(resp.body.failed, 1);
            assert.equal(resp.body.deployed, 0);
            assert.equal(resp.body.results[0].ok, false);
            assert.match(resp.body.results[0].message, /was not deployed/);
        }
    );

    /*
        The failure above left its connection checked out of the
        instance's pool for the life of the process, one per failure.
        A ten-connection pool survived eight failed deploys and then
        every request needing a connection to that instance waited for
        one that was never coming -- no error, no timeout. Three
        failures here: a leak shows as three more connections, and
        anything that is not a leak stays where it was.
    */
    it(
        "gives its connection back",
        async function () {
            let opened = await connectionCount();
            let at = 0;

            while (at < 3) {
                at += 1;
                await session.raw("POST", "/platform/instance/deploy", {
                    id: target.id,
                    module: "fbtfail",
                    version: "1.0.0"
                });
                await session.raw(
                    "POST",
                    "/platform/instance/maintenance",
                    {id: target.id, isMaintenance: false}
                );
            }

            let left = await connectionCount();

            assert.ok(
                left <= opened + 1,
                opened + " connections before three failed deploys, " +
                left + " after"
            );
        }
    );
});

/*
    The case that makes letting go automatically dangerous. A module's
    install script issues its own COMMIT -- the bug plan item 2.1 took
    out of four SupplyChain services -- and then fails. What came before
    the COMMIT is permanent, so the instance is NOT as it was, and must
    stay held for somebody to look at.
*/
describe("a package that commits some work and then fails", function () {
    let session;
    let target;

    before(async function () {
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        session = await signedIn();
        target = await fleetEntry(session);
    });

    after(async function () {
        await session.raw("POST", "/platform/instance/maintenance", {
            id: target.id,
            isMaintenance: false
        });
        await db.withClient(
            settings.testDb,
            (client) => client.query(
                "DROP TABLE IF EXISTS fbt_commit_marker;"
            )
        );
        await flags(settings.adminUser, {});
    });

    it("fails, and says the instance is held", async function () {
        let resp = await session.raw("POST", "/platform/instance/deploy", {
            id: target.id,
            module: "fbtcommit",
            version: "1.0.0"
        });
        let said = JSON.stringify(resp.body);

        assert.equal(resp.status, 500, said);
        assert.match(said, /fails after committing/);
        assert.match(said, /held in maintenance/);
        assert.doesNotMatch(said, /Nothing was changed/);
    });

    it("really did commit something", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT to_regclass('fbt_commit_marker') IS NOT NULL AS made"
            )
        );

        assert.equal(resp.rows[0].made, true, "the premise of this test");
    });

    it("keeps the instance held", async function () {
        let now = await fleetEntry(session);

        assert.equal(now.isMaintenance, true);
    });
});

describe("a package that seeds records into its own feather", function () {
    let session;
    let target;

    before(async function () {
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        session = await signedIn();
        target = await fleetEntry(session);
    });

    /*
        The install script's table has no keys, so left behind it fails
        schema.test.js ("indexes the primary and surrogate keys of every
        table") for every later file in the same database.
    */
    after(async function () {
        await db.withClient(
            settings.testDb,
            (client) => client.query("DROP TABLE IF EXISTS fbt_seed_marker;")
        );
        await flags(settings.adminUser, {});
    });

    /*
        Installed through an umbrella manifest, as SupplyChain is: that
        is the only path that defers the views, so a flat package would
        pass without testing anything.
    */
    it(
        "deploys, rather than failing on a view that is not there yet",
        async function () {
            let resp = await session.raw("POST", "/platform/instance/deploy", {
                id: target.id,
                module: "fbtseed",
                version: "1.0.0"
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        }
    );

    it("ran the install script the package carried", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT to_regclass('fbt_seed_marker') AS found"
            )
        );

        assert.ok(resp.rows[0].found, "the script ran from the package");
    });

    it("has the records the package carried", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT code FROM fbt_seed WHERE NOT is_deleted " +
                "ORDER BY code"
            )
        );

        assert.deepEqual(
            resp.rows.map((row) => row.code),
            ["ALPHA", "BETA"]
        );
    });

    /*
        Deleting a record does not free its id -- the unique index on id
        covers deleted rows -- so deploying the package again used to
        fail the whole deployment on a raw duplicate key, with nothing
        to do but put the row back by hand (John, Oct 2026: the same
        deploy failure "for the umpteenth time"). The package is
        asserting its own records, so a deleted one comes back.
    */
    it("deploys again over a record somebody deleted", async function () {
        await db.withClient(
            settings.testDb,
            (client) => client.query(
                "UPDATE object SET is_deleted = true " +
                "WHERE id = 'fbtseedalpha1'"
            )
        );

        let resp = await session.raw("POST", "/platform/instance/deploy", {
            id: target.id,
            module: "fbtseed",
            version: "1.0.0"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let rows = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT code FROM fbt_seed WHERE NOT is_deleted " +
                "ORDER BY code"
            )
        );

        assert.deepEqual(
            rows.rows.map((row) => row.code),
            ["ALPHA", "BETA"],
            "the deleted record came back rather than being inserted twice"
        );
    });

    it("has the dashboard layout the package shipped", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT name, label, module, config FROM \"$dashboard\" " +
                "WHERE name = 'FbtSeedBoard' AND NOT is_deleted"
            )
        );
        let found = resp.rows[0];

        assert.ok(found, "the layout the package carried is there");
        assert.equal(found.label, "Seed Board");
        assert.equal(found.module, "fbtseed");
        // The whole spec travels, not just the name: a layout that
        // arrived without its tiles would be a board to assemble.
        assert.equal(found.config.tiles.length, 1);
        assert.equal(found.config.tiles[0].cols, 5);
        assert.equal(found.config.asOf, "2027-05-31");
    });

    it("makes the shipped layout the default", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT name FROM \"$dashboard\" " +
                "WHERE is_default AND NOT is_deleted ORDER BY name"
            )
        );

        assert.deepEqual(
            resp.rows.map((row) => row.name),
            ["FbtSeedBoard"],
            "exactly one default, and it is the one shipped"
        );
    });

    it("cannot take the default from an administrator", async function () {
        /*
            The administrator moves the default to a board of their own;
            the package is then deployed again. Its layout still ships
            and still updates, but its claim on the default is
            conditional -- honoured only where nobody has chosen -- so
            the administrator's choice stands. The spec's sentence is
            exactly this: a reinstall cannot override it.
        */
        let resp;

        await db.withClient(settings.testDb, (client) => client.query(
            "INSERT INTO \"$dashboard\" (" +
            "_pk, id, name, label, description, module, sequence, " +
            "is_default, config, created_by, updated_by, created, " +
            "updated, is_deleted) " +
            "VALUES (nextval('object__pk_seq'), 'fbtadminboard', " +
            "'FbtAdminBoard', 'Admin board', '', 'Core', 1, true, " +
            "'{}'::json, 'admin', 'admin', now(), now(), false);" +
            "UPDATE \"$dashboard\" SET is_default = false " +
            "WHERE name <> 'FbtAdminBoard';"
        ));

        resp = await session.raw("POST", "/platform/instance/deploy", {
            id: target.id,
            module: "fbtseed",
            version: "1.0.0"
        });
        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT name FROM \"$dashboard\" " +
                "WHERE is_default AND NOT is_deleted ORDER BY name"
            )
        );
        assert.deepEqual(
            resp.rows.map((row) => row.name),
            ["FbtAdminBoard"],
            "the administrator's board is still the default"
        );
    });

    it("leaves the instance open afterwards", async function () {
        let now = await fleetEntry(session);

        assert.equal(now.isMaintenance, false);
    });
});
