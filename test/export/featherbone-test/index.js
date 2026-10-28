/*
    The test harness as module tests see it (ADR-003). The runner puts
    test/export on NODE_PATH, so a package's tests, wherever the package
    is installed, reach the harness as require("featherbone-test").
    This is a public interface: changing it breaks every package's tests.
*/
/*jslint node*/
"use strict";

module.exports = {
    catalog: require("../../harness/catalog"),
    db: require("../../harness/db"),
    env: require("../../harness/env"),
    fixtures: require("../../harness/fixtures"),
    golden: require("../../harness/golden"),
    http: require("../../harness/http")
};
