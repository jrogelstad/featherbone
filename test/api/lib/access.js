/*
    Helpers for the user, role, authorization, settings, workbook and
    security tests (test/api/users, authorization, settings, workbooks,
    security).

    Users are created in SQL (Postgres login role + user_account row)
    because POST /data/user-account is currently broken (see
    users.test.js). Postgres roles are cluster-wide, so every helper that
    creates one records it and dropAll() removes them.
*/
/*jslint node*/
"use strict";

const {Client} = require("pg");
const format = require("pg-format");
const settings = require("../../harness/env");
const db = require("../../harness/db");

const created = new Set();

function uniq(prefix) {
    return (
        (prefix || "fbt") + "_" + Date.now().toString(36) +
        Math.floor(Math.random() * 1296).toString(36)
    ).toLowerCase();
}

// Remember a cluster-wide role so dropAll() cleans it up
function track(name) {
    created.add(name);
    return name;
}

// Try a direct Postgres login with the given credentials
async function pgLogin(user, password) {
    const client = new Client({
        database: settings.testDb,
        host: settings.pgHost,
        password,
        port: settings.pgPort,
        user
    });
    try {
        await client.connect();
        await client.end();
        return true;
    } catch (ignore) {
        return false;
    }
}

async function sqlRole(name, password, opts) {
    opts = opts || {};
    track(name);
    await db.query(format(
        "CREATE ROLE %I " + (
            opts.login === false
            ? "NOLOGIN"
            : "LOGIN"
        ) + " PASSWORD %L",
        name,
        password
    ));
}

/*
    Create a user in SQL the same way the Admin Console would end up:
    login role, membership in "everyone", user_account row linked to an
    Employee contact (the Common module PATCHes Employee.userAccount when
    a user account is saved, so the contact has to be an employee).

    Databases with only the framework installed have no Employee feather.
    Fall back to a plain Contact there, so suites that just need an
    ordinary user are not limited to databases carrying Job Shop.

    opts: {name, password, isSuper, changePassword, admin (Session)}
*/
async function createUser(admin, opts) {
    opts = opts || {};
    let name = opts.name || uniq("fbt_user");
    let password = opts.password || settings.password;
    let email = name + "@example.com";
    let feather = "Employee";
    let emp;

    let probe = await admin.raw("GET", "/feather/employee");

    if (!(probe.status === 200 && probe.body && probe.body.name)) {
        feather = "Contact";
    }

    emp = await admin.create(feather, {
        firstName: "Test",
        lastName: name,
        email
    });

    let pk = await db.query(
        "SELECT _pk FROM contact WHERE id = $1",
        [emp.id]
    );
    let id = uniq("fbtu");

    await sqlRole(name, password);
    await db.query(format("GRANT everyone TO %I", name));
    let row = await db.query((
        "INSERT INTO user_account (" +
        "  id, name, is_super, is_active, is_login, change_password, " +
        "  sign_in_attempts, is_locked, is_deleted, owner, etag, " +
        "  password, _contact_contact_pk, " +
        "  created, created_by, updated, updated_by) " +
        "VALUES ($1, $2, $3, true, true, $4, 0, false, false, " +
        "  $5, $1, '', $6, now(), $5, now(), $5) RETURNING _pk"
    ), [
        id,
        name,
        Boolean(opts.isSuper),
        Boolean(opts.changePassword),
        settings.adminUser,
        pk.rows[0]._pk
    ]);
    await db.query((
        "INSERT INTO role_membership (" +
        "  id, _parent_role_pk, role, is_deleted, " +
        "  created, created_by, updated, updated_by) " +
        "VALUES ($1, $2, 'everyone', false, now(), $3, now(), $3)"
    ), [id + "m", row.rows[0]._pk, settings.adminUser]);

    return {name, password, id, email, contactId: emp.id};
}

async function account(name) {
    let resp = await db.query(
        "SELECT * FROM user_account WHERE name = $1",
        [name]
    );
    return resp.rows[0];
}

async function roleInfo(name) {
    let resp = await db.query(
        "SELECT rolname, rolcanlogin, rolcreatedb, rolsuper " +
        "FROM pg_roles WHERE rolname = $1",
        [name]
    );
    return resp.rows[0];
}

// Drop every role created through this module (and any extra names)
async function dropAll(extra) {
    let names = Array.from(created).concat(extra || []);
    let i = 0;
    while (i < names.length) {
        try {
            await db.query(
                "DELETE FROM \"$auth\" WHERE role = $1",
                [names[i]]
            );
        } catch (ignore) {
            // Database may be gone already
        }
        try {
            await db.withClient("postgres", (client) => client.query(
                format("DROP ROLE IF EXISTS %I", names[i])
            ));
        } catch (ignore) {
            // Still referenced; harness teardown drops the database
        }
        i += 1;
    }
    created.clear();
}

async function poll(fn, timeoutMs, intervalMs) {
    let started = Date.now();
    let last;
    while (Date.now() - started < (timeoutMs || 5000)) {
        last = await fn();
        if (last) {
            return last;
        }
        await new Promise((r) => setTimeout(r, intervalMs || 100));
    }
    return last;
}

// Like session.raw() but gives up after ms and resolves {timeout: true}
// instead of hanging (some endpoints never answer on bad input).
async function rawTimeout(session, method, path, body, ms) {
    let ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), ms || 3000);
    let opts = {
        method,
        headers: {"Content-Type": "application/json"},
        signal: ctl.signal
    };
    if (session.cookie) {
        opts.headers.Cookie = session.cookie;
    }
    if (body !== undefined) {
        opts.body = JSON.stringify(body);
    }
    try {
        let resp = await fetch(session.baseUrl + path, opts);
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
        return {status: resp.status, body: data};
    } catch (err) {
        if (err.name === "AbortError") {
            return {timeout: true};
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function toSpinal(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

// Create a throwaway feather and wait until the server has registered its
// data routes (that happens asynchronously through a subscription).
async function createFeather(admin, spec) {
    let feather = await admin.create("Feather", Object.assign({
        module: "",
        inherits: "Document",
        description: "Regression test feather",
        overloads: []
    }, spec));
    let ok = await poll(async function () {
        let resp = await admin.raw(
            "POST",
            "/data/" + toSpinal(spec.plural),
            {filter: {limit: 1}}
        );
        return resp.status === 200;
    }, 15000, 200);
    if (!ok) {
        throw new Error("Routes for feather " + spec.name + " never appeared");
    }
    return feather;
}

async function deleteFeather(admin, feather) {
    if (!feather) {
        return;
    }
    try {
        await admin.raw("DELETE", "/data/feather/" + feather.id);
    } catch (ignore) {
        // Best effort
    }
}

// Unique CamelCase feather name
function featherName(prefix) {
    let tail = uniq("x").slice(2);
    return prefix + tail.charAt(0).toUpperCase() + tail.slice(1);
}

module.exports = {
    account,
    createFeather,
    createUser,
    deleteFeather,
    dropAll,
    featherName,
    pgLogin,
    poll,
    rawTimeout,
    roleInfo,
    sqlRole,
    toSpinal,
    track,
    uniq
};
