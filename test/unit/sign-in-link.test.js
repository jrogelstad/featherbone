/*
    A sign-in link from an email that does not work.

    The link was two days old, or meant for an instance the server no
    longer serves, or the server was restarted: the person who clicked
    did nothing wrong and used to be handed the server's error page. They
    are taken to the instance's sign-in screen instead, with their user
    name in it and a line saying the link did not work. A confirmation
    code is the exception, because the client asks for it over XHR and
    reads the status.

    No server: passport, the response and the logger are stand-ins.
*/
/*jslint node*/
"use strict";

const {beforeEach, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {SignInLink} = require("../../server/services/sign-in-link");

function token(claims) {
    let body = Buffer.from(JSON.stringify(claims)).toString("base64url");

    return "eyJhbGciOiJIUzI1NiJ9." + body + ".signature";
}

let redirected;
let logged;
let nexted;
let loggedIn;

function run(outcome, query, logInError) {
    let handler;
    let passport = {
        authenticate: function (name, opts, done) {
            assert.equal(name, "magiclogin");
            assert.equal(opts.session, true);
            return () => done(...outcome);
        }
    };
    let req = {
        logIn: function (user, done) {
            loggedIn = user;
            done(logInError);
        },
        query
    };
    let res = {redirect: (url) => redirected.push(url)};

    handler = SignInLink.callback(passport, {
        error: (msg) => logged.push(msg)
    });
    handler(req, res, (err) => nexted.push(err));
}

describe("what a sign-in link claims", function () {
    it("names whose it is", function () {
        assert.deepEqual(
            SignInLink.claims(token({username: "ptyler"})),
            {confirm: false, expired: false, username: "ptyler"}
        );
    });

    it("knows a confirmation link", function () {
        assert.equal(
            SignInLink.claims(token({confirm: "abc", username: "u"})).confirm,
            true
        );
    });

    it("reads nothing from rubbish", function () {
        let none = {confirm: false, expired: false, username: ""};

        assert.deepEqual(SignInLink.claims(undefined), none);
        assert.deepEqual(SignInLink.claims("not a token"), none);
        assert.deepEqual(SignInLink.claims("a.%%%.c"), none);
        assert.deepEqual(SignInLink.claims(token({username: 7})), none);
    });

    it("knows a link past its time", function () {
        let late = Math.floor(Date.now() / 1000) - 60;
        let soon = Math.floor(Date.now() / 1000) + 60;

        assert.equal(SignInLink.claims(token({exp: late})).expired, true);
        assert.equal(SignInLink.claims(token({exp: soon})).expired, false);
    });

    it("keeps a name to a sensible length", function () {
        let name = "x".repeat(500);

        assert.equal(
            SignInLink.claims(token({username: name})).username.length,
            100
        );
    });
});

describe("following a sign-in link", function () {
    beforeEach(function () {
        redirected = [];
        logged = [];
        nexted = [];
        loggedIn = undefined;
    });

    it("signs in when the link is good", function () {
        run([null, {name: "ptyler"}], {token: token({username: "ptyler"})});

        assert.deepEqual(loggedIn, {name: "ptyler"});
        assert.deepEqual(redirected, ["../../"]);
        assert.deepEqual(logged, []);
    });

    it("goes to sign-in with the name on error", function () {
        run(
            [new Error("jwt expired")],
            {token: token({username: "ptyler"})}
        );

        assert.deepEqual(redirected, ["../../#link-failed=ptyler"]);
        assert.equal(loggedIn, undefined);
        assert.equal(nexted.length, 0);
        assert.equal(logged.length, 1);
        assert.match(logged[0], /ptyler.*jwt expired/);
    });

    it("does the same when the link is simply refused", function () {
        run(
            [null, false, {message: "bad token"}],
            {token: token({username: "ptyler"})}
        );

        assert.deepEqual(redirected, ["../../#link-failed=ptyler"]);
        assert.match(logged[0], /bad token/);
    });

    it("says in the log when the link had expired", function () {
        let late = Math.floor(Date.now() / 1000) - 60;

        run(
            [null, false, {message: "Unauthorized"}],
            {token: token({exp: late, username: "ptyler"})}
        );

        assert.match(logged[0], /the link had expired/);
    });

    it("does the same when signing in cannot be completed", function () {
        run(
            [null, {name: "ptyler"}],
            {token: token({username: "ptyler"})},
            new Error("session store down")
        );

        assert.deepEqual(redirected, ["../../#link-failed=ptyler"]);
    });

    it("still goes to sign-in for a rubbish link", function () {
        run([null, false], {});

        assert.deepEqual(redirected, ["../../#link-failed="]);
    });

    it("passes the name on safely", function () {
        run([new Error("x")], {token: token({username: "a b&c#d"})});

        assert.deepEqual(redirected, ["../../#link-failed=a%20b%26c%23d"]);
    });

    it("leaves a confirmation code's answer to the client", function () {
        run(
            [new Error("Invalid confirmation code")],
            {token: token({confirm: "abc", username: "ptyler"})}
        );

        assert.deepEqual(redirected, []);
        assert.equal(nexted.length, 1);
        assert.match(nexted[0].message, /Invalid confirmation code/);
    });
});
