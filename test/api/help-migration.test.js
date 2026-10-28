/*
    Moving off the stored help link, one way (ADR-003,
    scripts/retire-help-links.js).

    A fresh install has nothing to move, so the old shape is built here
    -- the column the Form feather used to declare, a link the customer
    owned, a link the vendor shipped, and a worksheet that saved a copy
    of one -- and the script is run against it the way an upgrade runs
    it.
*/
/*jslint node, name, unordered*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {uniq} = require("../harness/fixtures");

const retire = require("../../scripts/retire-help-links");
const MARK = uniq("FBTMIG");
const COLUMN = "_help_link_help_link_pk";

// A form that is one of this test's, so nothing else is disturbed
const FORMS = [MARK + " One", MARK + " Two", MARK + " Vendor"];

function run() {
    return db.withClient(
        settings.testDb,
        (client) => retire.execute({client})
    );
}

/*
    The manifest runs the script twice, either side of the feathers,
    because that is where Form.helpLink is dropped. This is that, with
    the feathers' part of it done by hand.
*/
async function upgrade() {
    await run();
    await db.query("ALTER TABLE form DROP COLUMN IF EXISTS " + COLUMN);
    await run();
}

function link(id, module) {
    return db.query(
        "INSERT INTO help_link (" +
        "  _pk, id, created, created_by, updated, updated_by, is_deleted," +
        "  owner, etag, module, label, icon, resource, display_value" +
        ") VALUES (" +
        "  nextval('object__pk_seq'), $1, now(), 'fbt', now(), 'fbt'," +
        "  false, 'fbt', $1, $2, $3, 'open_in_new', $4, $3" +
        ") RETURNING _pk",
        [id, module, MARK + "-" + id, "https://example.com/" + id]
    );
}

function form(name, pk) {
    return db.query(
        "INSERT INTO form (" +
        "  _pk, id, created, created_by, updated, updated_by, is_deleted," +
        "  owner, etag, name, description, module, feather, is_active," +
        "  is_default, paper_size, font, " + COLUMN +
        ") VALUES (" +
        "  nextval('object__pk_seq'), $1, now(), 'fbt', now(), 'fbt'," +
        "  false, 'fbt', $1, $2, $2, 'Core', 'Contact', true, false," +
        "  'Letter', 'Helvetica', $3" +
        ")",
        [MARK + name, name, pk]
    );
}

async function links() {
    let resp = await db.query(
        "SELECT id, form, module, is_deleted, label FROM help_link " +
        "WHERE label LIKE $1 ORDER BY form, id",
        [MARK + "%"]
    );

    return resp.rows;
}

describe("retiring the stored help link", function () {
    let mine;
    let theirs;

    before(async function () {
        /*
            The column the Form feather used to declare. The feather no
            longer does, so an upgraded database is what this builds.
        */
        await db.query(
            "ALTER TABLE form ADD COLUMN IF NOT EXISTS " + COLUMN +
            " bigint DEFAULT -1"
        );

        mine = (await link(MARK + "mine")).rows[0]._pk;
        theirs = (await link(MARK + "theirs", "Design")).rows[0]._pk;

        // Two forms sharing the customer's one link, and one on the
        // vendor's
        await form(FORMS[0], mine);
        await form(FORMS[1], mine);
        await form(FORMS[2], theirs);

        await db.query(
            "INSERT INTO \"$workbook\" (" +
            "  _pk, id, created, created_by, updated, updated_by," +
            "  is_deleted, name, description, label, module, sequence," +
            "  default_config" +
            ") VALUES (" +
            "  nextval('object__pk_seq'), $1, now(), 'fbt', now(), 'fbt'," +
            "  false, $1, 'Migration', 'Migration', 'Core', 99, $2" +
            ")",
            [
                MARK,
                JSON.stringify([
                    {helpLink: {id: "x", resource: "y"}, name: "Sheet"},
                    {name: "Other"}
                ])
            ]
        );

        await upgrade();
    });

    after(async function () {
        await db.query(
            "DELETE FROM help_link WHERE label LIKE $1",
            [MARK + "%"]
        );
        await db.query("DELETE FROM form WHERE name LIKE $1", [MARK + "%"]);
        await db.query(
            "DELETE FROM \"$workbook\" WHERE name = $1",
            [MARK]
        );
    });

    it("keeps the customer's link as its form's supplement", async function () {
        let rows = await links();
        let mine_ = rows.filter((row) => !row.module && !row.is_deleted);

        assert.deepEqual(
            mine_.map((row) => row.form).sort(),
            [FORMS[0], FORMS[1]],
            "a link two forms shared becomes one supplement each"
        );
    });

    it("drops the copy a worksheet saved", async function () {
        let resp = await db.query(
            "SELECT default_config FROM \"$workbook\" WHERE name = $1",
            [MARK]
        );
        let sheets = resp.rows[0].default_config;

        assert.equal(sheets.length, 2);
        assert.equal(sheets[0].helpLink, undefined);
        assert.equal(sheets[0].name, "Sheet");
    });

    /*
        The bright line (John, Oct 2026): our standard help is files in
        a package, the customer's is records they keep in a workbook,
        and neither writes over the other. Nothing a package ships
        survives here; everything the customer made does.
    */
    it("clears every link that belongs to a module", async function () {
        let rows = await links();

        assert.deepEqual(
            rows.filter((row) => row.module).map((row) => row.label),
            [],
            "a vendor's link is the vendor's to ship, not ours to keep"
        );
        assert.equal(rows.length, 2, "the customer's two are still here");
    });

    it("leaves nothing behind to carry", async function () {
        let resp = await db.query(
            "SELECT to_regclass('\"$help_carry\"') IS NOT NULL AS held"
        );

        assert.equal(resp.rows[0].held, false);
    });

    it("changes nothing on a second upgrade", async function () {
        let was = await links();

        // What a fresh install does too: nothing is there to move
        await upgrade();

        assert.deepEqual(await links(), was);
    });
});
