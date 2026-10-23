/*
    Which mail account a message goes out on.

    A module's own code (a trigger telling a team about a new ticket)
    calls `sendMail` with no account. It used to get the installation's
    `config.json` account alone, which is blank on a hosted installation,
    so every such message failed with 'Missing credentials for "PLAIN"'
    while the account entered under Settings went unused. The order is
    now: the account the caller names, the organization's, the
    installation's. The organization's is read as the installation's
    service account: its password is blanked for anyone who may not
    change Settings, which includes the reporter of a ticket.

    No server and no mail: nodemailer is replaced by a recorder and the
    organization's settings reader by a stand-in.
*/
/*jslint node*/
"use strict";

const {after, beforeEach, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const {Config} = require("../../server/config");

const realCreateTransport = nodemailer.createTransport;
const notifyPath = require.resolve("../../server/services/notify");
const realNotify = require.cache[notifyPath];

const ORG = {
    auth: {pass: "org-secret", user: "orgmail@example.com"},
    host: "smtp.org.example",
    port: 465,
    secure: true,
    type: "SMTP"
};
const CALLER = {
    auth: {pass: "caller-secret", user: "caller@example.com"},
    host: "smtp.caller.example",
    port: 465,
    secure: true,
    type: "SMTP"
};
const TENANT = {pgDatabase: "acme"};

/*
    Run a function with console.error silenced: the mailer reports what
    it could not do, which is the point of some of these tests.
*/
async function quietly(callback) {
    let realError = console.error;
    let failure;

    console.error = () => undefined;
    try {
        await callback();
    } catch (e) {
        failure = e;
    }
    console.error = realError;

    if (failure) {
        return Promise.reject(failure);
    }
}

let transports;
let sent;
let asked;
let answer;
let sendError;
let mail;

function client(tenant) {
    return {
        tenant: () => tenant
    };
}

function message() {
    return {html: "<p>hi</p>", subject: "s", to: "a@example.com"};
}

describe("mail a module sends", function () {
    beforeEach(async function () {
        transports = [];
        sent = [];
        asked = [];
        answer = () => ORG;
        sendError = undefined;

        nodemailer.createTransport = function (opts) {
            transports.push(opts);
            return {
                sendMail: function (msg) {
                    if (sendError) {
                        return Promise.reject(sendError);
                    }
                    sent.push(msg);
                    return Promise.resolve();
                }
            };
        };
        require.cache[notifyPath] = {
            children: [],
            exports: {
                Notify: function () {
                    return {
                        smtpFor: function (tenant, user) {
                            asked.push({tenant, user});
                            return Promise.resolve(answer());
                        }
                    };
                }
            },
            filename: notifyPath,
            id: notifyPath,
            loaded: true,
            paths: []
        };

        if (!mail) {
            let {Mail} = require("../../server/services/mailer");

            mail = new Mail();
            // Let the installation's account finish loading
            await new Promise((resolve) => setImmediate(resolve));
        }
    });

    after(function () {
        nodemailer.createTransport = realCreateTransport;
        if (realNotify) {
            require.cache[notifyPath] = realNotify;
        } else {
            delete require.cache[notifyPath];
        }
    });

    it("goes out on the organization's account", async function () {
        await mail.sendMail({
            client: client(TENANT),
            data: {message: message()}
        });

        assert.equal(transports.length, 1);
        assert.deepEqual(transports[0], ORG);
        assert.equal(asked.length, 1);
        assert.equal(asked[0].tenant, TENANT);
        assert.equal(sent[0].from, "orgmail@example.com");
    });

    it("reads the account as the service account", async function () {
        let conf = await new Config().read();

        await mail.sendMail({
            client: client(TENANT),
            data: {message: message()},
            user: "reporter"
        });

        assert.equal(asked.length, 1);
        assert.equal(asked[0].user, conf.pgUser);
        assert.notEqual(asked[0].user, "reporter");
    });

    it("takes the instance the message names", async function () {
        let named = {pgDatabase: "other"};

        await mail.sendMail({
            client: client(TENANT),
            data: {message: message(), tenant: named}
        });

        assert.equal(asked[0].tenant, named);
    });

    it("lets the caller's own account win", async function () {
        await mail.sendMail({
            client: client(TENANT),
            data: {message: message(), smtp: CALLER}
        });

        assert.deepEqual(transports[0], CALLER);
        assert.equal(asked.length, 0, "the organization is not asked");
    });

    it("falls back when the organization has no account", async function () {
        answer = () => undefined;
        await mail.sendMail({
            client: client(TENANT),
            data: {message: message()}
        });

        assert.equal(asked.length, 1);
        assert.equal(transports.length, 1);
        assert.notDeepEqual(transports[0], ORG);
    });

    it("falls back when the settings cannot be read", async function () {
        answer = function () {
            throw new Error("settings unreadable");
        };
        await quietly(() => mail.sendMail({
            client: client(TENANT),
            data: {message: message()}
        }));

        assert.equal(sent.length, 1, "the message still went");
        assert.notDeepEqual(transports[0], ORG);
    });

    it("does not look for an account without an instance", async function () {
        await mail.sendMail({
            client: client(undefined),
            data: {message: message()}
        });

        assert.equal(asked.length, 0);
        assert.equal(sent.length, 1);
    });

    it("says what is missing when no account signs in", async function () {
        // An installation whose account was left blank
        let blank = {
            auth: {pass: "", user: ""},
            host: "",
            port: 465,
            secure: true,
            type: "SMTP"
        };

        sendError = Object.assign(
            new Error("Missing credentials for \"PLAIN\""),
            {code: "EAUTH"}
        );
        await quietly(() => assert.rejects(
            mail.sendMail({
                client: client(TENANT),
                data: {message: message(), smtp: blank}
            }),
            /no user name or password/
        ));
    });
});
