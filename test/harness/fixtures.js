/*
    Regression test harness: data builders.

    Generic builders over framework feathers. Every record gets a unique
    RT- prefix so tests never collide with demo data or with each other.
    A module's own builders live with its tests (ADR-003); SupplyChain's
    are in its common/test/lib/fixtures.js.
*/
/*jslint node*/
"use strict";

const {createId} = require("../../common/core");

let counter = 0;

// Unique, short, sortable suffix for natural keys
function uniq(prefix) {
    counter += 1;
    return (
        (prefix || "RT") + "-" +
        Date.now().toString(36).toUpperCase() +
        process.pid.toString(36).toUpperCase() +
        counter
    );
}

function money(amount, currency) {
    return {amount, currency: currency || "USD"};
}

function today(offsetDays) {
    let d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
}

function ref(rec) {
    return {id: rec.id};
}

async function findOne(session, plural, property, value) {
    let rows = await session.findBy(plural, property, value);
    return rows[0];
}

// Find by natural key or create
async function ensure(session, feather, plural, key, data) {
    let found = await findOne(session, plural, key, data[key]);
    if (found) {
        return found;
    }
    return session.create(feather, data);
}

// Address is a child feather: a Site, a Customer's billTo and shipTo carry
// their own, embedded in the record, so a fixture passes the values and
// never a reference to an Address made on its own. The server inserts the
// embedded record and then finds it by the id it arrived with, so each one
// carries an id of its own.
function addressData(overrides) {
    return Object.assign({
        id: createId(),
        type: "W",
        name: "Regression Test",
        street: "100 Test Way",
        city: "Springfield",
        state: "IL",
        postalCode: "62701",
        country: "United States"
    }, overrides);
}

async function address(session, overrides) {
    return session.create("Address", addressData(overrides));
}

/*
    The same address again, as its own record. A child address belongs
    to the one record that carries it, so handing a second record the
    first one's id does not point at it -- the server inserts what it
    was given, which for an id alone is an empty address, and the
    required street says so. Copying the values and taking a new id is
    what the client does when it fills a ship-to from a customer.
*/
function addressCopy(from) {
    let had = from || {};
    let fields = [
        "type", "name", "street", "unit", "city", "state",
        "postalCode", "country", "phone"
    ];
    let copy = {};

    fields.forEach(function (key) {
        if (had[key] !== undefined && had[key] !== null) {
            copy[key] = had[key];
        }
    });

    return addressData(copy);
}

async function currency(session, code) {
    let found = await findOne(session, "Currencies", "code", code || "USD");
    if (!found) {
        throw new Error("Currency " + (code || "USD") + " not found");
    }
    return found;
}

async function location(session, name) {
    return session.create("Location", {
        name: name || uniq("LOC"),
        description: "Regression test location"
    });
}

// Merge values into a settings record (GET/PUT /settings/<name>)
async function settings(session, name, values) {
    let current = await session.get("/settings/" + name) || {};
    let data = Object.assign({}, current.data || {}, values);
    await session.call("PUT", "/settings/" + name, {
        etag: current.etag,
        data
    });
    return data;
}

module.exports = {
    address,
    addressCopy,
    addressData,
    currency,
    ensure,
    findOne,
    location,
    money,
    ref,
    settings,
    today,
    uniq
};
