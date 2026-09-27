/*
    Regression test harness: HTTP session against the running server.

    Each Session keeps its own cookie, so tests can act as different users.
    Paths are relative to the database root, e.g. "/data/contact/<id>".
*/
/*jslint node*/
"use strict";

const jsonpatch = require("fast-json-patch");
const settings = require("./env");

function toSpinal(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

class HttpError extends Error {
    constructor(method, url, status, body) {
        super(
            method + " " + url + " -> " + status + ": " +
            (
                typeof body === "string"
                ? body
                : JSON.stringify(body)
            ).slice(0, 500)
        );
        this.status = status;
        this.body = body;
    }
}

class Session {
    constructor(baseUrl) {
        this.baseUrl = baseUrl || settings.baseUrl;
        if (!this.baseUrl) {
            throw new Error(
                "FB_TEST_URL is not set. Run integration tests with " +
                "`npm run test:integration` (test/run.js)."
            );
        }
        this.cookie = "";
        this.user = undefined;
    }

    async raw(method, path, body, headers) {
        let url = this.baseUrl + path;
        let opts = {
            method,
            redirect: "manual",
            headers: Object.assign({
                "Content-Type": "application/json"
            }, headers)
        };
        if (this.cookie) {
            opts.headers.Cookie = this.cookie;
        }
        if (body !== undefined) {
            opts.body = (
                typeof body === "string"
                ? body
                : JSON.stringify(body)
            );
        }

        let resp = await fetch(url, opts);
        let setCookie = resp.headers.get("set-cookie");
        if (setCookie) {
            this.cookie = setCookie.split(";")[0];
        }

        let text = await resp.text();
        let data = text;
        try {
            data = (
                text
                ? JSON.parse(text)
                : undefined
            );
        } catch (ignore) {
            // Leave as text
        }

        return {status: resp.status, body: data, headers: resp.headers};
    }

    // Like raw() but throws unless 2xx
    async call(method, path, body) {
        let resp = await this.raw(method, path, body);
        if (resp.status < 200 || resp.status > 299) {
            throw new HttpError(method, path, resp.status, resp.body);
        }
        return resp.body;
    }

    async signIn(username, password) {
        let resp = await this.raw("POST", "/sign-in", {
            username: username || settings.adminUser,
            password: (
                password === undefined
                ? settings.password
                : password
            )
        });
        if (resp.status === 200) {
            this.user = resp.body;
        }
        return resp;
    }

    async signOut() {
        return this.raw("POST", "/sign-out");
    }

    get(path) {
        return this.call("GET", path);
    }

    post(path, body) {
        return this.call("POST", path, body || {});
    }

    // Generic data API ----------------------------------------------------

    // POST /data/<feather> creates a record. The server answers with a
    // JSON patch against what was sent; returns the merged record.
    async create(feather, data) {
        let sent = structuredClone(data);
        let diff = await this.post("/data/" + toSpinal(feather), sent);
        if (Array.isArray(diff)) {
            return jsonpatch.applyPatch(sent, diff, false, false).newDocument;
        }
        return diff;
    }

    read(feather, id) {
        return this.get("/data/" + toSpinal(feather) + "/" + id);
    }

    // ops: JSON patch array
    patch(feather, id, ops) {
        return this.call(
            "PATCH",
            "/data/" + toSpinal(feather) + "/" + id,
            ops
        );
    }

    // Read the record, apply fn(record) to a copy, PATCH the difference and
    // return the re-read record.
    async update(feather, id, fn) {
        let before = await this.read(feather, id);
        let after = structuredClone(before);
        let ret = fn(after);
        if (ret !== undefined) {
            after = ret;
        }
        let ops = jsonpatch.compare(before, after);
        if (ops.length) {
            await this.patch(feather, id, ops);
        }
        return this.read(feather, id);
    }

    remove(feather, id) {
        return this.call("DELETE", "/data/" + toSpinal(feather) + "/" + id);
    }

    // POST /data/<plural> queries. payload: {filter, properties, ...}
    list(plural, payload) {
        return this.post("/data/" + toSpinal(plural), payload || {});
    }

    // Find records by one property value
    async findBy(plural, property, value, properties) {
        return this.list(plural, {
            filter: {criteria: [{property, value}]},
            properties
        });
    }

    feather(name) {
        return this.get("/feather/" + toSpinal(name));
    }

    // Module route: POST /<module>/<path>
    route(path, body) {
        return this.post(path, body);
    }
}

async function signedIn(username, password) {
    let session = new Session();
    let resp = await session.signIn(username, password);
    if (resp.status !== 200) {
        throw new HttpError("POST", "/sign-in", resp.status, resp.body);
    }
    return session;
}

module.exports = {HttpError, Session, signedIn, toSpinal};
