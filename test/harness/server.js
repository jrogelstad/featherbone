/*
    Regression test harness: run a Featherbone server against the test
    database on its own port. Output goes to test/.artifacts/server.log.
*/
/*jslint node*/
"use strict";

const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const settings = require("./env");

let child;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilUp(url, timeoutMs, logFile) {
    const started = Date.now();
    let lastErr;

    while (Date.now() - started < timeoutMs) {
        if (child && child.exitCode !== null) {
            throw new Error(
                "Featherbone server exited with code " + child.exitCode +
                ". See " + logFile
            );
        }
        try {
            let resp = await fetch(url, {redirect: "manual"});
            if (resp.status < 500) {
                return;
            }
            lastErr = new Error("HTTP " + resp.status);
        } catch (err) {
            lastErr = err;
        }
        await sleep(250);
    }
    throw new Error(
        "Featherbone server did not start in " + timeoutMs + " ms (" +
        (lastErr && lastErr.message) + "). See " + logFile
    );
}

async function start() {
    fs.mkdirSync(settings.artifacts, {recursive: true});
    const logFile = path.join(
        settings.artifacts,
        "server-" + settings.testDb + ".log"
    );
    const out = fs.openSync(logFile, "w");

    child = spawn(process.execPath, ["server.js"], {
        cwd: settings.root,
        env: Object.assign({}, process.env, {
            pgDatabase: settings.testDb,
            PORT: String(settings.port),
            clientPort: String(settings.port),
            logSilent: "true",
            twoFactorAuth: "false"
        }),
        stdio: ["ignore", out, out]
    });

    const baseUrl = "http://127.0.0.1:" + settings.port;
    await waitUntilUp(
        baseUrl + "/" + settings.testDb + "/",
        Number(process.env.FB_TEST_START_TIMEOUT || 120000),
        logFile
    );

    return baseUrl + "/" + settings.testDb;
}

async function stop() {
    if (!child || child.exitCode !== null) {
        return;
    }
    const done = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await done;
    clearTimeout(timer);
}

function isAlive() {
    return Boolean(child) && child.exitCode === null;
}

module.exports = {isAlive, start, stop};
