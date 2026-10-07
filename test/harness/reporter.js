/*
    Test reporter: Node's "spec" output, except that known-defect (todo)
    tests are reported as passed-with-todo instead of failed.

    The runner already excludes todo tests from the failure count, but the
    stock spec reporter still lists each one, stack trace and all, in a
    "failing tests" block at the very end, burying the summary. Todo tests
    are still named in the run and still counted in the "todo" total.

    Use the stock reporter instead with FB_TEST_REPORTER=spec.
*/
/*jslint node*/
"use strict";

const {Readable} = require("node:stream");
const {spec} = require("node:test/reporters");

async function* hideTodoFailures(source) {
    for await (const event of source) {
        if (
            event.type === "test:fail" &&
            event.data.todo !== undefined &&
            event.data.todo !== false
        ) {
            let data = Object.assign({}, event.data);
            data.details = Object.assign({}, event.data.details);
            delete data.details.error;
            yield {type: "test:pass", data};
        } else {
            yield event;
        }
    }
}

module.exports = async function* (source) {
    yield* Readable.from(
        hideTodoFailures(source),
        {objectMode: true}
    ).compose(new spec());
};
