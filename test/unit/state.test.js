/*
    client/state.js: the statechart library (port of burrows/statechart.js)
    behind every model, list, property-less view model and dialog.
    Tested as a library: define/state/goto/send/resolve/current, enter and
    exit handler order, relative paths, clustered vs concurrent states,
    condition states (C), history (H and H:"*"), canExit guards, context
    and force options, deferred transitions during send, errors, tracing.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {pathToFileURL} = require("url");
const env = require("./lib/browser-env");

let State;

async function loadState() {
    env.install();
    State = (await import(pathToFileURL(
        path.join(env.ROOT, "client", "state.js")
    ).href)).default;
}

// Statechart with logging enter/exit handlers on every state
function tracedChart(log, define) {
    let sc = State.define(define);
    sc.each(function (s) {
        let p = s.path();
        s.enter(() => log.push("enter " + p));
        s.exit(() => log.push("exit " + p));
    });
    return sc;
}

describe("client/state.js", function () {
    before(loadState);

    describe("structure", function () {
        it("define creates a root with named substates and paths",
                function () {
            let sc = State.define(function () {
                this.state("a", function () {
                    this.state("b");
                });
                this.state("c");
            });
            assert.equal(sc.name, "root");
            assert.equal(sc.isRoot(), true);
            assert.equal(sc.path(), "/");
            assert.equal(sc.resolve("/a/b").path(), "/a/b");
            assert.equal(String(sc.resolve("/a/b")), "State(/a/b)");
            assert.equal(sc.resolve("/a/b").root(), sc);
            assert.equal(sc.resolve("/a/b").isAttached(), true);
            assert.deepEqual(sc.substates.map((s) => s.name), ["a", "c"]);
            assert.deepEqual(sc.current(), [], "not entered before goto");
        });

        it("define accepts (opts), (fn) or (opts, fn)", function () {
            assert.equal(State.define({concurrent: true}).concurrent, true);
            assert.equal(State.define().concurrent, false);
            let sc = State.define({H: true}, function () {
                this.state("x");
            });
            assert.equal(sc.history, true);
            assert.ok(sc.resolve("/x"));
        });

        it("resolves absolute, relative, '.' and '..' paths", function () {
            let sc = State.define(function () {
                this.state("a", function () {
                    this.state("b", function () {
                        this.state("d");
                    });
                    this.state("c");
                });
            });
            let b = sc.resolve("/a/b");
            assert.equal(b.resolve("../c"), sc.resolve("/a/c"));
            assert.equal(b.resolve("."), b);
            assert.equal(b.resolve("./d"), sc.resolve("/a/b/d"));
            assert.equal(b.resolve("d"), sc.resolve("/a/b/d"));
            assert.equal(b.resolve("../../a/c"), sc.resolve("/a/c"));
            assert.equal(b.resolve("/a"), sc.resolve("/a"));
            assert.equal(b.resolve(["..", "c"]), sc.resolve("/a/c"));
            assert.equal(sc.resolve("/nope"), null);
            assert.equal(sc.resolve(".."), null);
            assert.equal(sc.resolve(""), null);
            assert.equal(sc.resolve(undefined), null);
        });

        it("state() accepts a prebuilt State and calls didAttach",
                function () {
            let attached = [];
            let s2 = new State("s2");
            s2.state("s21");
            s2.each(function (s) {
                s.didAttach = () => attached.push(s.path());
            });
            let sc = State.define(function () {
                this.state(s2);
            });
            assert.equal(sc.resolve("/s2/s21").path(), "/s2/s21");
            assert.deepEqual(attached, ["/s2", "/s2/s21"]);
        });

        it("each walks states depth-first in definition order", function () {
            let names = [];
            State.define(function () {
                this.state("a", function () {
                    this.state("a1");
                    this.state("a2");
                });
                this.state("b");
            }).each((s) => names.push(s.path()));
            assert.deepEqual(names, ["/", "/a", "/a/a1", "/a/a2", "/b"]);
        });

        it("rejects history on concurrent states and conditions on them",
                function () {
            assert.throws(
                () => State.define({concurrent: true, H: true}),
                /history states are not allowed on concurrent states/
            );
            assert.throws(
                () => State.define({concurrent: true}).C(() => "./x"),
                /a concurrent state may not have a condition state/
            );
        });
    });

    describe("goto", function () {
        it("enters default (first) substates top-down on initial goto",
                function () {
            let log = [];
            let sc = tracedChart(log, function () {
                this.state("a", function () {
                    this.state("b");
                    this.state("c");
                });
                this.state("z");
            });
            assert.equal(sc.goto(), true);
            assert.deepEqual(sc.current(), ["/a/b"]);
            assert.deepEqual(log, ["enter /", "enter /a", "enter /a/b"]);
        });

        it("exits bottom-up to the pivot then enters top-down", function () {
            let log = [];
            let sc = tracedChart(log, function () {
                this.state("a", function () {
                    this.state("b", function () {
                        this.state("b1");
                    });
                });
                this.state("x", function () {
                    this.state("y", function () {
                        this.state("y1");
                    });
                });
            });
            sc.goto();
            log.length = 0;
            sc.goto("/x/y/y1");
            assert.deepEqual(log, [
                "exit /a/b/b1", "exit /a/b", "exit /a",
                "enter /x", "enter /x/y", "enter /x/y/y1"
            ]);
            assert.deepEqual(sc.current(), ["/x/y/y1"]);
        });

        it("does not exit or re-enter the common ancestor", function () {
            let log = [];
            let sc = tracedChart(log, function () {
                this.state("a", function () {
                    this.state("b");
                    this.state("c");
                });
            });
            sc.goto();
            log.length = 0;
            sc.resolve("/a/b").goto("../c");
            assert.deepEqual(log, ["exit /a/b", "enter /a/c"]);
        });

        it("goto to the current state is a no-op unless forced", function () {
            let log = [];
            let sc = tracedChart(log, function () {
                this.state("a", function () {
                    this.state("b");
                });
            });
            sc.goto();
            log.length = 0;
            sc.goto("/a/b");
            assert.deepEqual(log, []);
            sc.goto("/a/b", {force: true});
            // force re-runs enter handlers from the pivot down, no exits
            assert.deepEqual(log, ["enter /", "enter /a", "enter /a/b"]);
        });

        it("passes opts.context to enter and exit handlers", function () {
            let seen = [];
            let sc = State.define(function () {
                this.state("a", function () {
                    this.exit((ctx) => seen.push(["exit a", ctx]));
                });
                this.state("b", function () {
                    this.enter((ctx) => seen.push(["enter b", ctx]));
                });
            });
            sc.goto({context: {n: 1}});
            seen.length = 0;
            sc.goto("/b", {context: {n: 2}});
            assert.deepEqual(seen, [["exit a", {n: 2}], ["enter b", {n: 2}]]);
        });

        it("accepts an array of paths", function () {
            let sc = State.define({concurrent: true}, function () {
                this.state("x", function () {
                    this.state("x1");
                    this.state("x2");
                });
                this.state("y", function () {
                    this.state("y1");
                    this.state("y2");
                });
            });
            sc.goto(["/x/x2", "/y/y2"]);
            assert.deepEqual(sc.current(), ["/x/x2", "/y/y2"]);
        });

        it("throws on unresolvable paths and non-current states",
                function () {
            let sc = State.define(function () {
                this.state("a");
                this.state("b", function () {
                    this.state("b1");
                });
            });
            sc.goto();
            assert.throws(
                () => sc.goto("/nope"),
                /could not resolve path \/nope from State\(\/\)/
            );
            assert.throws(
                () => sc.resolve("/b/b1").goto("/a"),
                /state State\(\/b\/b1\) is not current/
            );
        });

        it("throws when entering two substates of a clustered state",
                function () {
            let sc = State.define(function () {
                this.state("a");
                this.state("b");
            });
            assert.throws(
                () => sc.goto("/a", "/b"),
                /attempted to enter multiple substates of State\(\/\)/
            );
        });

        it("canExit returning false blocks the transition", function () {
            let allow = false;
            let sc = State.define(function () {
                this.state("a", function () {
                    this.state("a1", function () {
                        this.canExit = (dest) => (
                            allow || dest[0].path() === "/a/a2"
                        );
                    });
                    this.state("a2");
                });
                this.state("b");
            });
            sc.goto();
            assert.equal(sc.goto("/b"), false);
            assert.deepEqual(sc.current(), ["/a/a1"]);
            allow = true;
            assert.equal(sc.goto("/b"), true);
            assert.deepEqual(sc.current(), ["/b"]);
        });
    });

    describe("condition states (C)", function () {
        it("chooses the substate returned by the condition", function () {
            let target = "./c";
            let sc = State.define(function () {
                this.state("a", function () {
                    this.C(() => target);
                    this.state("b");
                    this.state("c");
                });
                this.state("z");
            });
            sc.goto();
            assert.deepEqual(sc.current(), ["/a/c"]);
            sc.goto("/z");
            target = undefined; // falls back to the first substate
            sc.goto("/a");
            assert.deepEqual(sc.current(), ["/a/b"]);
        });

        it("throws when the condition path does not resolve", function () {
            let sc = State.define(function () {
                this.state("a", function () {
                    this.C(() => "./missing");
                    this.state("b");
                });
            });
            assert.throws(
                () => sc.goto(),
                /could not resolve path '\.\/missing' returned by condition/
            );
        });

        it("receives the goto context", function () {
            let got;
            let sc = State.define(function () {
                this.state("a", function () {
                    this.C(function (ctx) {
                        got = ctx;
                    });
                    this.state("b");
                });
            });
            sc.goto({context: {why: "test"}});
            assert.deepEqual(got, {why: "test"});
        });
    });

    describe("history", function () {
        function chart(opts) {
            return State.define(function () {
                this.state("a", opts, function () {
                    this.state("b", function () {
                        this.state("b1");
                        this.state("b2");
                    });
                    this.state("c", function () {
                        this.state("c1");
                        this.state("c2");
                    });
                });
                this.state("z");
            });
        }

        it("without H re-enters default substates", function () {
            let sc = chart({});
            sc.goto("/a/c/c2");
            sc.goto("/z");
            sc.goto("/a");
            assert.deepEqual(sc.current(), ["/a/b/b1"]);
        });

        it("H: true remembers only the immediate substate", function () {
            let sc = chart({H: true});
            sc.goto("/a/c/c2");
            sc.goto("/z");
            sc.goto("/a");
            assert.deepEqual(sc.current(), ["/a/c/c1"]);
        });

        it("H: '*' remembers the full nested configuration", function () {
            let sc = chart({H: "*"});
            sc.goto("/a/c/c2");
            sc.goto("/z");
            sc.goto("/a");
            assert.deepEqual(sc.current(), ["/a/c/c2"]);
        });

        it("an explicit destination overrides history", function () {
            let sc = chart({H: "*"});
            sc.goto("/a/c/c2");
            sc.goto("/z");
            sc.goto("/a/b");
            assert.deepEqual(sc.current(), ["/a/b/b1"]);
        });
    });

    describe("concurrent states", function () {
        function chart(log) {
            return tracedChart(log, function () {
                this.state("x", {concurrent: true}, function () {
                    this.state("p", function () {
                        this.state("p1");
                        this.state("p2");
                        this.event("go", function () {
                            // Handler runs with `this` = the state that
                            // registered it (/x/p)
                            this.goto("./p2");
                            return true;
                        });
                    });
                    this.state("q", function () {
                        this.state("q1");
                        this.state("q2");
                    });
                });
                this.state("z");
            });
        }

        it("enters every region and reports all leaf states", function () {
            let log = [];
            let sc = chart(log);
            sc.goto();
            assert.deepEqual(sc.current(), ["/x/p/p1", "/x/q/q1"]);
            assert.deepEqual(log, [
                "enter /", "enter /x", "enter /x/p", "enter /x/p/p1",
                "enter /x/q", "enter /x/q/q1"
            ]);
        });

        it("sends events to every region; true only if all handle",
                function () {
            let log = [];
            let sc = chart(log);
            sc.goto();
            assert.equal(sc.send("go"), false, "q did not handle it");
            assert.deepEqual(sc.current(), ["/x/p/p2", "/x/q/q1"]);
        });

        it("exits all regions when leaving", function () {
            let log = [];
            let sc = chart(log);
            sc.goto();
            log.length = 0;
            sc.goto("/z");
            assert.deepEqual(log, [
                "exit /x/p/p1", "exit /x/p", "exit /x/q/q1", "exit /x/q",
                "exit /x", "enter /z"
            ]);
        });

        it("refuses a goto from one region into another", function () {
            let sc = chart([]);
            sc.goto();
            assert.throws(
                () => sc.resolve("/x/p/p1").goto("/x/q/q2"),
                /not reachable from state State\(\/x\/p\/p1\)/
            );
        });
    });

    describe("send", function () {
        it("bubbles from the leaf up until a handler returns truthy",
                function () {
            let calls = [];
            let sc = State.define(function () {
                this.event("e", () => calls.push("root"));
                this.state("a", function () {
                    this.event("e", function () {
                        calls.push("a");
                        return false;
                    });
                    this.state("b", function () {
                        this.event("e", function (x, y) {
                            calls.push("b:" + x + y);
                        });
                    });
                });
            });
            sc.goto();
            assert.equal(sc.send("e", 1, 2), true, "root push returns 3");
            assert.deepEqual(calls, ["b:12", "a", "root"]);
        });

        it("returns false for unhandled events", function () {
            let sc = State.define(function () {
                this.state("a");
            });
            sc.goto();
            assert.equal(sc.send("nothing"), false);
        });

        it("defers transitions until the handler returns", function () {
            let during;
            let sc = State.define(function () {
                this.state("a", function () {
                    this.event("go", function () {
                        this.goto("../b");
                        during = sc.current()[0];
                    });
                });
                this.state("b");
            });
            sc.goto();
            sc.send("go");
            assert.equal(during, "/a", "still in /a inside the handler");
            assert.deepEqual(sc.current(), ["/b"]);
        });

        it("throws when sending to a state that is not current",
                function () {
            let sc = State.define(function () {
                this.state("a");
                this.state("b");
            });
            sc.goto();
            assert.throws(
                () => sc.resolve("/b").send("x"),
                /attempted to send an event to a state that is not current/
            );
        });

        it("an event registered twice keeps only the last handler",
                function () {
            let calls = [];
            let sc = State.define(function () {
                this.state("a", function () {
                    this.event("e", () => calls.push(1));
                    this.event("e", () => calls.push(2));
                });
            });
            sc.goto();
            sc.send("e");
            assert.deepEqual(calls, [2]);
        });
    });

    describe("reset, isCurrent, trace", function () {
        it("reset exits every current state", function () {
            let log = [];
            let sc = tracedChart(log, function () {
                this.state("a", function () {
                    this.state("b");
                });
            });
            sc.goto();
            log.length = 0;
            sc.reset();
            assert.deepEqual(sc.current(), []);
            assert.deepEqual(log, ["exit /a/b", "exit /a", "exit /"]);
        });

        it("isCurrent is a boolean flag on each state", function () {
            let sc = State.define(function () {
                this.state("a");
                this.state("b");
            });
            sc.goto();
            assert.equal(sc.resolve("/a").isCurrent, true);
            assert.equal(sc.resolve("/b").isCurrent, false);
        });

        it("documented isCurrent(path) method is callable",
                {todo: "defect: constructor sets this.isCurrent = false, " +
                "shadowing State.prototype.isCurrent(path)"}, function () {
            let sc = State.define(function () {
                this.state("a");
            });
            sc.goto();
            assert.equal(sc.isCurrent("/a"), true);
        });

        it("State is frozen, so State.logger cannot be set", function () {
            assert.equal(Object.isFrozen(State), true);
            assert.throws(() => {
                State.logger = {};
            }, TypeError);
        });

        it("traces transitions to console.info when root.trace is on",
                function () {
            let lines = [];
            let sc = State.define(function () {
                this.state("a", function () {
                    this.event("go", function () {
                        this.goto("../b");
                    });
                });
                this.state("b");
            });
            let info = console.info;
            console.info = (msg) => lines.push(msg);
            try {
                sc.goto();
                assert.deepEqual(lines, [], "silent while trace is off");
                sc.trace = true;
                sc.send("go");
            } finally {
                console.info = info;
            }
            assert.deepEqual(lines, [
                "State: [EVENT]  : go",
                "State: [GOTO]   : State(/a) -> [State(/b)]",
                "State: [EXIT]   : /a",
                "State: [ENTER]  : /b"
            ]);
        });
    });
});
