/*
    CadModel: a 3D model that is also a resource link to itself, so it
    turns up wherever a link to a drawing is chosen (a Product's
    drawing link, an item document) and opens on its own page, where
    three-cad-viewer draws it.

    The trailer is the three-cad-viewer file the unit tests also use. The
    claims here are the server's: the record is a resource link, the
    trigger writes its link and display value, the revision is a number
    that cannot drop below one, and the shapes survive the round trip.
*/
/*jslint node unordered name*/
"use strict";

const fs = require("fs");
const path = require("path");
const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const {uniq} = require("../harness/fixtures");

// The model is kept as text: the server camel-cases the keys of any
// object it returns, and the viewer's format is snake case
const TRAILER = JSON.stringify(JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "cad", "teardrop.cad.json"),
    "utf8"
)));

describe("CadModel", function () {
    let admin;
    let rec;
    let label;

    before(async function () {
        admin = await signedIn();
        label = uniq("Trailer");
        rec = await admin.create("CadModel", {
            label,
            units: "in",
            source: "teardrop.cad.json",
            model: TRAILER
        });
    });

    it("is a resource link to itself", function () {
        assert.equal(rec.objectType, "CadModel");
        assert.equal(rec.revision, 1);
        assert.equal(rec.resource, "#!/edit/cad_model/" + rec.id);
        assert.equal(rec.displayValue, label + " rev 1");
        assert.equal(rec.icon, "cube");
    });

    it("shows up in the resource link list", async function () {
        let links = await admin.findBy(
            "ResourceLinks",
            "id",
            rec.id,
            ["id", "label", "resource", "objectType"]
        );

        assert.equal(links.length, 1);
        assert.equal(links[0].objectType, "CadModel");
        assert.equal(links[0].resource, rec.resource);
    });

    it("keeps the shapes whole", async function () {
        let back = await admin.read("CadModel", rec.id);

        assert.equal(typeof back.model, "string");
        assert.equal(back.model === TRAILER, true);
        assert.equal(JSON.parse(back.model).normal_len, 0);
    });

    it("follows the revision in its display value", async function () {
        let next = await admin.update("CadModel", rec.id, function (r) {
            r.revision = 2;
        });

        assert.equal(next.revision, 2);
        assert.equal(next.displayValue, label + " rev 2");
        assert.equal(next.resource, rec.resource);
    });

    it("refuses a revision below one", async function () {
        let resp = await admin.raw("POST", "/data/cad-model", {
            label: uniq("Bad"),
            revision: 0
        });

        assert.ok(resp.status >= 400, "status " + resp.status);
    });

    it("keeps one record per name and revision", async function () {
        let twin = await admin.raw("POST", "/data/cad-model", {
            label,
            revision: 2
        });
        let next = await admin.raw("POST", "/data/cad-model", {
            label,
            revision: 3
        });

        assert.ok(twin.status >= 400, "twin status " + twin.status);
        assert.equal(next.status, 200);
    });

    it("can be listed without carrying every model", async function () {
        let rows = await admin.findBy(
            "CadModels",
            "id",
            rec.id,
            ["id", "label", "revision"]
        );

        assert.equal(rows.length, 1);
        assert.equal(rows[0].model, undefined);
        assert.equal(rows[0].revision, 2);
    });
});
