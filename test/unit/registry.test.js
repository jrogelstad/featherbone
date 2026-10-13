/*
    The instance registry's reconciliation decision (tenant plan D.3).

    loadTenants used to only ever add, so a deleted or unregistered
    instance stayed in the registry with its connection pool and its
    LISTEN connection. The decision of what leaves is separated out
    here so it can be checked without a cluster; the release of the
    pool and the listener is covered by the manager API suite.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const datasource = require("../../server/datasource");

const MANAGER = {id: "-1", name: "Manager", pgDatabase: "db_manager"};
const ONE = {id: "i1", name: "One", pgDatabase: "inst_one"};
const TWO = {id: "i2", name: "Two", pgDatabase: "inst_two"};

function names(tenants) {
    return tenants.map((tenant) => tenant.id);
}

describe("the instance registry", function () {
    it("drops an instance the manager no longer holds", function () {
        assert.deepEqual(
            names(datasource.registryChanges([MANAGER, ONE, TWO], [ONE])),
            ["i2"]
        );
    });

    it("keeps every instance the manager still holds", function () {
        assert.deepEqual(
            names(datasource.registryChanges([MANAGER, ONE, TWO], [TWO, ONE])),
            []
        );
    });

    it("never drops the manager, which is not an instance", function () {
        assert.deepEqual(
            names(datasource.registryChanges([MANAGER], [])),
            []
        );
        assert.deepEqual(
            names(datasource.registryChanges([MANAGER, ONE], [])),
            ["i1"]
        );
    });

    it("matches on id, not on database name", function () {
        // A renamed database on the same Tenant row stays registered;
        // loadTenants is what refreshes the row's own properties.
        let renamed = {id: "i1", name: "One", pgDatabase: "inst_one_v2"};

        assert.deepEqual(
            names(datasource.registryChanges([MANAGER, ONE], [renamed])),
            []
        );
    });

    it("reports the registry without handing out its connections",
            function () {
        let registry = datasource.registeredTenants();

        assert.ok(Array.isArray(registry));
        registry.forEach(function (tenant) {
            assert.equal(tenant.listenerConn, undefined);
            assert.equal(typeof tenant.isListening, "boolean");
            assert.equal(typeof tenant.isPooled, "boolean");
        });
    });
});
