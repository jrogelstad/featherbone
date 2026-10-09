/*
    Test reporter: Node's "spec" output, except that known-defect (todo)
    tests are reported as passed-with-todo instead of failed.

    The runner already excludes todo tests from the failure count, but the
    stock spec reporter still lists each one, stack trace and all, in a
    "failing tests" block at the very end, burying the summary. Todo tests
    are still named in the run and still counted in the "todo" total.

    Real failures are listed by Node after the summary. This reporter moves
    that "failing tests" block above the summary so the totals stay last.

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

const SUMMARY = "\nℹ tests ";
const FAILURES = "\n✖ failing tests:";

// Pass spec output through, but hold back everything from the summary on
// and, at the end, put the failure details ahead of the totals.
async function* summaryLast(source) {
    let held = "";
    let holding = false;
    let text;

    for await (const chunk of source) {
        text = String(chunk);
        if (!holding && ("\n" + text).includes(SUMMARY)) {
            holding = true;
        }
        if (holding) {
            held += text;
        } else {
            yield chunk;
        }
    }

    let at = ("\n" + held).indexOf(FAILURES);
    if (holding && at !== -1) {
        let all = "\n" + held;
        let summary = all.slice(0, at);
        let failures = all.slice(at);
        // Drop the leading newline added above
        yield failures.slice(1) + "\n";
        yield summary.slice(1);
    } else {
        yield held;
    }
}

module.exports = async function* (source) {
    yield* Readable.from(
        hideTodoFailures(source),
        {objectMode: true}
    ).compose(new spec()).compose(summaryLast);
};
