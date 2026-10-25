/*jslint node*/
/*
    Install script for the fbtcommit fixture. It does what a badly
    written module script can do -- issues its own COMMIT in the middle of
    the install's transaction -- and then fails. The table it made stays
    behind, committed, which is exactly the case where an instance must
    NOT be let go as though nothing had changed.
*/
(function (exports) {
    "use strict";

    exports.execute = async function (obj) {
        await obj.client.query(
            "CREATE TABLE IF NOT EXISTS fbt_commit_marker (id int);"
        );
        await obj.client.query("COMMIT;");
        return Promise.reject(new Error(
            "fbtcommit fails after committing part of its work"
        ));
    };
}(exports));
