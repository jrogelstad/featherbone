/*
    Regression test harness: environment and configuration.

    All settings come from server/config.json (with the same environment
    variable overrides Featherbone itself honors) plus FB_TEST_* variables.
*/
/*jslint node*/
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const TEST_DIR = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(TEST_DIR, ".artifacts");

function readConfig() {
    let file = path.join(ROOT, "server", "config.json");
    let data = JSON.parse(fs.readFileSync(file, "utf8"));

    // Mirror server/config.js: env vars with the same name override
    Object.keys(data).forEach(function (key) {
        let val = process.env[key];
        if (val === undefined) {
            return;
        }
        if (val.toLowerCase() === "true") {
            data[key] = true;
        } else if (val.toLowerCase() === "false") {
            data[key] = false;
        } else if (!Number.isNaN(Number(val)) && val !== "") {
            data[key] = Number(val);
        } else {
            data[key] = val;
        }
    });

    return data;
}

const config = readConfig();
const env = process.env;

const settings = Object.freeze({
    root: ROOT,
    testDir: TEST_DIR,
    artifacts: ARTIFACTS,
    goldenDir: path.join(TEST_DIR, "golden"),
    config,
    // Database the test copy is cloned from
    sourceDb: env.FB_TEST_SOURCE_DB || "demo",
    // Throwaway database the suite runs against
    testDb: env.FB_TEST_DB || "featherbone_test",
    pgHost: env.FB_TEST_PGHOST || config.pgHost,
    pgPort: Number(env.FB_TEST_PGPORT || config.pgPort),
    // Must be able to CREATE/DROP DATABASE and CREATE ROLE
    pgUser: env.FB_TEST_PGUSER || config.pgUser,
    pgPassword: env.FB_TEST_PGPASSWORD || config.pgPassword,
    port: Number(env.FB_TEST_PORT || 3990),
    keepDb: env.FB_TEST_KEEP_DB === "1",
    updateGolden: env.FB_UPDATE_GOLDEN === "1",
    // Test users (cluster-wide Postgres roles, dropped on teardown)
    adminUser: env.FB_TEST_ADMIN_USER || "fbtest_admin",
    basicUser: env.FB_TEST_BASIC_USER || "fbtest_basic",
    password: env.FB_TEST_USER_PASSWORD || "Fbtest-Regression-1!",
    // Set by test/run.js for integration tests
    baseUrl: env.FB_TEST_URL || ""
});

module.exports = settings;
