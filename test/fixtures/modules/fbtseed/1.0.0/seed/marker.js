/*jslint node*/
// Install script for the fbtseed fixture: leaves a table as proof it ran.
(function (exports) {
    "use strict";

    exports.execute = function (obj) {
        return obj.client.query(
            "CREATE TABLE IF NOT EXISTS fbt_seed_marker (id int);"
        );
    };
}(exports));
