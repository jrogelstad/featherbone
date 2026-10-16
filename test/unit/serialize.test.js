/*
    Calls that must not overlap (registry refresh).

    Reloading the registry looks for an instance it does not hold yet,
    connects to it, then adds it; listening then connects its event
    connection and takes an advisory lock for the node. Run twice at
    once, both calls found the instance missing and both went on to add
    it and listen to it. The second listener asked for a lock the first
    one -- from the same process -- already held, and waited for itself
    for good: the server stopped answering the request that was
    refreshing, and the lock stayed behind.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {serialize} = require("../../server/services/serialize");

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("serialize", function () {
    it("never runs two calls at once, and keeps their order",
            async function () {
        let running = 0;
        let most = 0;
        let order = [];
        let refresh = serialize(async function (id) {
            running += 1;
            most = Math.max(most, running);
            await pause(10);
            order.push(id);
            running -= 1;
            return id;
        });
        let results = await Promise.all([1, 2, 3, 4, 5].map(refresh));

        assert.equal(most, 1, "one at a time");
        assert.deepEqual(order, [1, 2, 3, 4, 5]);
        assert.deepEqual(results, [1, 2, 3, 4, 5], "each gets its own");
    });

    it("shows what the race did without it", async function () {
        /*
            The same shape as the registry: look, wait, then add.
            Unserialized, every caller finds the instance missing.
        */
        let held = [];
        let load = async function () {
            let found = held.indexOf("instance") !== -1;

            await pause(10);

            if (!found) {
                held.push("instance");
            }
        };

        await Promise.all([load(), load()]);
        assert.equal(held.length, 2, "added twice, which is the defect");

        held = [];

        let once = serialize(load);

        await Promise.all([once(), once()]);
        assert.equal(held.length, 1, "added once");
    });

    it("hands a failure to its own caller and goes on with the rest",
            async function () {
        let calls = 0;
        let flaky = serialize(async function () {
            calls += 1;

            if (calls === 1) {
                throw new Error("first one fails");
            }

            return calls;
        });
        let results = await Promise.allSettled([flaky(), flaky(), flaky()]);

        assert.equal(results[0].status, "rejected");
        assert.match(results[0].reason.message, /first one fails/);
        assert.equal(results[1].value, 2);
        assert.equal(results[2].value, 3);
    });
});
