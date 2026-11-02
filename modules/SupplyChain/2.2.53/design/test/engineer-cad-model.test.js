/*
    SupplyChain Design: engineering drawings (EngineerCadModel) and their
    engineering bill of material.

    A drawing is a 3D model that belongs to one product. Saving one
    points the product's drawing link at it, and reads the tree the model
    holds into a bill of material whose lines an engineer maps to products
    (a line whose name is exactly a product number is mapped for them).

    The trees here carry names and nothing to draw: the server only reads
    the names, and which leaves are bodies of a part.
*/
/*jslint node unordered*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fx = require("../../common/test/lib/fixtures");
const {db, fixtures, http} = require("featherbone-test");

const {uniq, ref} = fixtures;
const {signedIn} = http;

function part(name, source) {
    return {name, shape: {}, source_name: source || name};
}

function body(name) {
    return {body: true, name, shape: {}};
}

/*
    A cabinet: a top assembly under the file's wrapper, holding a panel,
    two knobs (the second named "Knob (2)" for the viewer), a hinge named
    for a product, a drawer assembly with two slides, and a housing made
    of two solids.
*/
function cabinetTree(hinge, opts) {
    let parts;

    opts = opts || {};
    parts = [
        part("Panel"),
        part(hinge),
        {
            name: "Drawer",
            parts: [part("Slide"), part("Slide (2)", "Slide")],
            source_name: "Drawer"
        },
        {
            name: "Housing",
            parts: [body("SOLID"), body("SOLID (2)")],
            source_name: "Housing"
        }
    ];
    if (!opts.noKnobs) {
        parts.splice(1, 0, part("Knob"), part("Knob (2)", "Knob"));
    }

    return JSON.stringify({
        name: "cabinet",
        parts: [{
            name: "Cabinet assembly",
            parts: parts.concat(opts.extra || []),
            source_name: "Cabinet"
        }]
    });
}

describe("design: engineering drawings", function () {
    let s;
    let w;
    let assy;
    let other;
    let hinge;
    let rec;
    let label;

    function lineOf(drawing, name, treePath) {
        return drawing.ebom.find(
            (l) => l.name === name && (l.treePath || "") === (treePath || "")
        );
    }

    async function drawingOf(product) {
        return (await s.read("Product", product.id)).drawingLink;
    }

    before(async function () {
        s = await signedIn();
        await fx.configure(s);
        w = await fx.world(s);
        assy = await fx.manufacturedItem(s, w, {prefix: "CAB-ASSY"});
        other = await fx.manufacturedItem(s, w, {prefix: "CAB-OTHER"});
        hinge = await fx.manufacturedItem(s, w, {prefix: "HINGE"});
        label = uniq("Cabinet");
        rec = await s.create("EngineerCadModel", {
            label,
            model: cabinetTree(hinge.number),
            product: ref(assy),
            source: "cabinet.step",
            units: "mm"
        });
    });

    after(async function () {
        // A drawing out of the way of whatever runs next
        let drawings = await s.findBy("EngineerCadModels", "label", label);
        let i = 0;

        while (i < drawings.length) {
            await s.remove("EngineerCadModel", drawings[i].id);
            i += 1;
        }
    });

    describe("the drawing", function () {
        it("is a model that opens on its own page", function () {
            assert.equal(rec.objectType, "EngineerCadModel");
            assert.equal(rec.resource, "#!/edit/engineer_cad_model/" + rec.id);
            assert.equal(rec.displayValue, label + " rev 1");
            assert.equal(rec.icon, "cube");
        });

        it("is among the links a drawing can be chosen from", async function () {
            let links = await s.findBy("ResourceLinks", "id", rec.id, [
                "id",
                "objectType"
            ]);

            assert.equal(links.length, 1);
            assert.equal(links[0].objectType, "EngineerCadModel");
        });

        it("everyone views, engineers edit", async function () {
            let got = await db.query(
                "SELECT a.role, a.can_create, a.can_read, a.can_update, " +
                "  a.can_delete " +
                "FROM \"$auth\" a JOIN object o ON o._pk = a.object_pk " +
                "WHERE o.id = 'engineer_cad_model' ORDER BY a.role"
            );

            assert.deepEqual(got.rows.map((r) => [
                r.role,
                r.can_create,
                r.can_read,
                r.can_update,
                r.can_delete
            ]), [
                ["engineer", true, true, true, true],
                ["everyone", false, true, false, false]
            ]);
        });
    });

    describe("the product's drawing link", function () {
        it("points at the drawing once it is saved", async function () {
            let link = await drawingOf(assy);

            assert.equal(link.id, rec.id);
            assert.equal(link.resource, rec.resource);
        });

        it("takes the product's drawing over from another drawing",
                async function () {
            // The client asks first; what reaches the server is meant
            let second = await s.create("EngineerCadModel", {
                label: uniq("Other drawing"),
                model: cabinetTree(hinge.number)
            });

            second = await s.update("EngineerCadModel", second.id, function (r) {
                r.product = ref(assy);
            });
            assert.equal((await drawingOf(assy)).id, second.id);

            // Put it back for what follows
            await s.update("EngineerCadModel", rec.id, function (r) {
                r.product = ref(other);
            });
            await s.update("EngineerCadModel", rec.id, function (r) {
                r.product = ref(assy);
            });
            assert.equal((await drawingOf(assy)).id, rec.id);
            await s.remove("EngineerCadModel", second.id);
        });

        it("points the product at a newer revision of the same drawing",
                async function () {
            // A display value, "label rev n", is one drawing's alone
            let revised = uniq("Revised");
            let next = await s.create("EngineerCadModel", {
                label: revised,
                model: cabinetTree(hinge.number),
                product: ref(other),
                revision: 1
            });
            let newer;

            assert.equal((await drawingOf(other)).id, next.id);
            newer = await s.create("EngineerCadModel", {
                label: revised,
                model: cabinetTree(hinge.number),
                product: ref(other),
                revision: 2
            });
            assert.equal((await drawingOf(other)).id, newer.id);
            await s.remove("EngineerCadModel", newer.id);
            await s.remove("EngineerCadModel", next.id);
            assert.equal(await drawingOf(other), null,
                    "a product is not left pointing at a drawing that is gone");
        });

        it("moves with the product the drawing is for", async function () {
            await s.update("EngineerCadModel", rec.id, function (r) {
                r.product = ref(other);
            });
            assert.equal(await drawingOf(assy), null);
            assert.equal((await drawingOf(other)).id, rec.id);

            await s.update("EngineerCadModel", rec.id, function (r) {
                r.product = ref(assy);
            });
            assert.equal(await drawingOf(other), null);
            assert.equal((await drawingOf(assy)).id, rec.id);
        });
    });

    describe("the engineering bill of material", function () {
        let first;

        before(async function () {
            first = await s.read("EngineerCadModel", rec.id);
        });

        it("has a line for each part and assembly, and no more", function () {
            assert.deepEqual(
                first.ebom.map((l) => [l.treePath || "", l.name]).sort(),
                [
                    ["", "Drawer"],
                    ["", "Housing"],
                    ["", "Knob"],
                    ["", "Panel"],
                    ["", hinge.number],
                    ["Drawer", "Slide"]
                ].sort(),
                "no top assembly, no copy names, no solids of a part"
            );
        });

        it("counts a repeated part once, with its quantity", function () {
            assert.equal(lineOf(first, "Knob").quantity, 2);
            assert.equal(lineOf(first, "Slide", "Drawer").quantity, 2);
            assert.equal(lineOf(first, "Panel").quantity, 1);
        });

        it("says which lines are assemblies", function () {
            assert.equal(lineOf(first, "Drawer").isAssembly, true);
            assert.equal(lineOf(first, "Housing").isAssembly, false);
            assert.equal(lineOf(first, "Panel").isAssembly, false);
        });

        it("gives each line its level in the tree", function () {
            assert.equal(lineOf(first, "Drawer").level, 0);
            assert.equal(lineOf(first, "Panel").level, 0);
            assert.equal(lineOf(first, "Slide", "Drawer").level, 1);
        });

        it("marks only the first level to sync", function () {
            assert.deepEqual(
                first.ebom.map((l) => [l.level, l.sync]).sort(),
                [
                    [0, true], [0, true], [0, true], [0, true], [0, true],
                    [1, false]
                ]
            );
        });

        it("maps a line to the product whose number is its name",
                function () {
            let line = lineOf(first, hinge.number);

            assert.equal(line.product.id, hinge.id);
            assert.equal(lineOf(first, "Panel").product, null);
        });

        it("keeps what was mapped, and what is gone, on a re-import",
                async function () {
            let panel = await fx.manufacturedItem(s, w, {prefix: "PANEL"});
            let next;

            // An engineer maps the panel by hand, drops it from the sync
            // and asks for a part below the first level to be kept in step
            await s.update("EngineerCadModel", rec.id, function (r) {
                lineOf(r, "Panel").product = ref(panel);
                lineOf(r, "Panel").sync = false;
                lineOf(r, "Slide", "Drawer").sync = true;
            });

            // A new revision of the file: no knobs, a new latch
            next = await s.update("EngineerCadModel", rec.id, function (r) {
                r.model = cabinetTree(hinge.number, {
                    extra: [part("Latch")],
                    noKnobs: true
                });
            });

            assert.equal(lineOf(next, "Panel").product.id, panel.id);
            assert.equal(lineOf(next, "Panel").sync, false);
            assert.equal(lineOf(next, "Slide", "Drawer").sync, true);
            assert.equal(lineOf(next, hinge.number).product.id, hinge.id);
            assert.equal(lineOf(next, "Latch").isInModel, true);
            assert.equal(lineOf(next, "Latch").sync, true, "new, first level");
            assert.equal(lineOf(next, "Latch").product, null);
            assert.equal(lineOf(next, "Knob").isInModel, false);
            assert.equal(lineOf(next, "Panel").isInModel, true);
        });

        it("maps a line once there is a product it names", async function () {
            let later = await fx.manufacturedItem(s, w, {prefix: "LATER"});
            let name = uniq("NEWPART");
            let before;
            let after;

            await s.update("EngineerCadModel", rec.id, function (r) {
                r.model = cabinetTree(hinge.number, {extra: [part(name)]});
            });
            before = await s.read("EngineerCadModel", rec.id);
            assert.equal(lineOf(before, name).product, null);

            await s.update("Product", later.id, function (r) {
                r.number = name;
            });
            await s.update("EngineerCadModel", rec.id, function (r) {
                r.notes = "Parts are named for products now";
            });
            after = await s.read("EngineerCadModel", rec.id);
            assert.equal(lineOf(after, name).product.id, later.id);
        });

        it("refuses a model it cannot read", async function () {
            let resp = await s.raw(
                "PATCH",
                "/data/engineer-cad-model/" + rec.id,
                [{op: "add", path: "/model", value: "{not json"}]
            );

            assert.ok(resp.status >= 400);
            assert.match(JSON.stringify(resp.body), /could not be read/);
        });
    });
});
