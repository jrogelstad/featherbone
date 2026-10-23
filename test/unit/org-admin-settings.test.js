/*
    Who may change the organization's global settings.

    A person appointed over an organization is not necessarily a super
    user of its instance: the profile made on first sign-in carries no
    authority. They administer the organization all the same, and the
    global settings (letterhead, mail account) are the organization's.
    Super users and anyone granted update on the row keep their
    access; no one else gains any, and no other settings row opens up.

    No database: the manager and the instance's client are stand-ins.
*/
/*jslint node, name*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const platformModule = require("../../server/services/platform");

function rows(list) {
    return Promise.resolve({rows: list});
}

/*
    A manager connection that knows one instance, "acme", owned by
    organization 77, and these identities: who they are, and whether
    each is a platform administrator or appointed over an organization.
*/
function fakeManager(people) {
    return {
        query: function (sql, params) {
            if (sql.indexOf("FROM tenant") !== -1) {
                return rows(
                    params[0] === "acme"
                    ? [{org: 77}]
                    : []
                );
            }
            if (sql.indexOf("FROM identity") !== -1) {
                let who = people[String(params[0]).toLowerCase()];

                return rows(
                    who
                    ? [{
                        _pk: who.pk,
                        is_platform_admin: Boolean(who.platform),
                        username: params[0]
                    }]
                    : []
                );
            }
            if (sql.indexOf("FROM organization_admin") !== -1) {
                let found = Object.values(people).some(
                    (who) => who.pk === params[0] && who.admin === params[1]
                );

                return rows(
                    found
                    ? [{}]
                    : []
                );
            }
            throw new Error("Unexpected query: " + sql);
        }
    };
}

const PEOPLE = {
    boss: {admin: 77, pk: 1},
    outsider: {admin: 99, pk: 3},
    staff: {pk: 4},
    wizard: {pk: 2, platform: true}
};

describe("administersInstance", function () {
    const platform = new platformModule.Platform();
    const mclient = fakeManager(PEOPLE);

    function ask(database, user) {
        return platform.administersInstance(mclient, database, user);
    }

    it("true for the organization administrator", async function () {
        assert.equal(await ask("acme", "boss"), true);
    });

    it("true for a platform administrator", async function () {
        assert.equal(await ask("acme", "wizard"), true);
    });

    it("false for another organization's administrator", async function () {
        assert.equal(await ask("acme", "outsider"), false);
    });

    it("false for an ordinary person or a stranger", async function () {
        assert.equal(await ask("acme", "staff"), false);
        assert.equal(await ask("acme", "nobody"), false);
    });

    it("false for a database that belongs to nobody", async function () {
        assert.equal(await ask("orphan", "boss"), false);
    });
});

describe("settingIsAuthorized", function () {
    /*
        settings.js takes its Platform at load, so the stand-in has to
        be in place first.
    */
    const RealPlatform = platformModule.Platform;
    let settings;

    function instanceClient(user, opts) {
        let options = opts || {};

        return {
            currentUser: () => user,
            database: "acme",
            query: function (sql) {
                if (sql.indexOf("SELECT is_super") !== -1) {
                    return rows([{is_super: Boolean(options.isSuper)}]);
                }
                // The settings row's own grants
                return rows(
                    options.granted
                    ? [{can_update: true}]
                    : []
                );
            }
        };
    }

    function ask(client, name) {
        return settings.settingIsAuthorized({
            client,
            data: {name}
        });
    }

    it("loads with a manager stand-in", function () {
        platformModule.Platform = function () {
            let real = new RealPlatform();

            real.run = (callback) => callback(fakeManager(PEOPLE));
            return real;
        };
        delete require.cache[require.resolve(
            "../../server/services/settings"
        )];
        let {Settings} = require("../../server/services/settings");

        settings = new Settings();
        platformModule.Platform = RealPlatform;
        assert.equal(typeof settings.settingIsAuthorized, "function");
    });

    it("allows an organization administrator", async function () {
        assert.equal(await ask(instanceClient("boss"), "globalSettings"), true);
    });

    it("allows a platform administrator", async function () {
        assert.equal(
            await ask(instanceClient("wizard"), "globalSettings"),
            true
        );
    });

    it("refuses outsiders and ordinary users", async function () {
        assert.equal(
            await ask(instanceClient("outsider"), "globalSettings"),
            false
        );
        assert.equal(
            await ask(instanceClient("staff"), "globalSettings"),
            false
        );
    });

    it("opens no other settings row to them", async function () {
        assert.equal(
            await ask(instanceClient("boss"), "someModuleSettings"),
            false
        );
    });

    it("keeps super users and granted roles", async function () {
        let sup = instanceClient("staff", {isSuper: true});
        let granted = instanceClient("staff", {granted: true});

        assert.equal(await ask(sup, "globalSettings"), true);
        assert.equal(await ask(granted, "someModuleSettings"), true);
    });
});
