/*
    common/cad.js: turns STEP, STL and three-cad-viewer files into the
    shapes tree a CadModel keeps, and says what is wrong with a file it
    cannot use. The fixtures are real files: the teardrop trailer in
    three-cad-viewer's own format, and a two part bracket written to STEP
    and STL by build123d.
*/
/*jslint node unordered name*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const cad = require("../../common/cad.js");

const READ_STEP = "ReadStepFile";
const FIXTURES = path.join(__dirname, "..", "fixtures", "cad");

function fixture(name) {
    return fs.readFileSync(path.join(FIXTURES, name));
}

function leaves(node, out) {
    out = out || [];
    if (node.parts) {
        node.parts.forEach((p) => leaves(p, out));
    } else {
        out.push(node);
    }

    return out;
}

function assertDrawable(tree) {
    leaves(tree).forEach(function (part) {
        let s = part.shape;

        assert.equal(s.vertices.length % 3, 0, part.id);
        assert.equal(s.normals.length, s.vertices.length, part.id);
        assert.equal(s.triangles.length % 3, 0, part.id);
        assert.ok(
            s.triangles.every((i) => i >= 0 && i < s.vertices.length / 3),
            part.id + " points past its vertices"
        );
        assert.equal(
            s.triangles_per_face.reduce((a, b) => a + b, 0),
            s.triangles.length / 3,
            part.id + " faces do not add up to its triangles"
        );
        assert.equal(s.edge_types.length, s.edges.length / 6, part.id);
        assert.equal(s.segments_per_edge.length, s.edges.length / 6, part.id);
        assert.equal(s.obj_vertices.length, 24, part.id);
        assert.deepEqual(part.state, [1, 1]);
        assert.match(part.color, /^#[0-9a-f]{6}$/);
    });
}

describe("cad.kindOf", function () {
    it("recognizes what can be read", function () {
        assert.equal(cad.kindOf("a.STEP").kind, "step");
        assert.equal(cad.kindOf("a.stp").kind, "step");
        assert.equal(cad.kindOf("a.igs").kind, "iges");
        assert.equal(cad.kindOf("a.brep").kind, "brep");
        assert.equal(cad.kindOf("a.stl").kind, "stl");
        assert.equal(cad.kindOf("a.cad.json").kind, "json");
        assert.equal(cad.kindOf("a.step").message, undefined);
    });

    it("tells a SolidWorks user what to do instead", function () {
        let part = cad.kindOf("hitch.sldprt");

        assert.equal(part.kind, "solidworks");
        assert.match(part.message, /STEP/);
        assert.equal(cad.kindOf("frame.SLDASM").kind, "solidworks");
        assert.match(cad.kindOf("sheet.slddrw").message, /PDF/);
    });

    it("refuses anything else by name", function () {
        assert.equal(cad.kindOf("notes.docx").kind, "unknown");
        assert.match(cad.kindOf("notes.docx").message, /\.docx/);
        assert.equal(cad.kindOf("").kind, "unknown");
        assert.equal(cad.kindOf(undefined).kind, "unknown");
    });
});

describe("cad.fromShapes (the trailer)", function () {
    it("accepts a three-cad-viewer file as it is", function () {
        let tree = cad.fromShapes(fixture("teardrop.cad.json").toString());

        assert.equal(tree.version, 3);
        assert.deepEqual(cad.summarize(tree), {parts: 32, triangles: 6300});
        assertDrawable(tree);
    });

    it("accepts a record that holds one", function () {
        let tree = JSON.parse(fixture("teardrop.cad.json"));
        let rec = cad.fromShapes({id: "x", model: tree});

        assert.equal(rec.id, tree.id);
    });

    it("says which part is wrong", function () {
        let tree = JSON.parse(fixture("teardrop.cad.json"));
        let part = leaves(tree)[0];

        part.shape.triangles.push(part.shape.vertices.length);
        part.shape.triangles.push(0);
        part.shape.triangles.push(0);
        assert.throws(
            () => cad.fromShapes(tree),
            function (err) {
                return (
                    err.message.includes(part.id) &&
                    (/past its vertices/).test(err.message)
                );
            }
        );

        delete part.shape;
        assert.throws(() => cad.fromShapes(tree), /no vertices/);
    });

    it("refuses what is not a shapes file", function () {
        assert.throws(() => cad.fromShapes({}), /Not a three-cad-viewer/);
        assert.throws(() => cad.fromShapes("not json"));
    });
});

describe("cad.fromStl", function () {
    it("reads a binary file", function () {
        let tree = cad.fromStl(fixture("plate.stl"), "plate.stl");

        assert.equal(tree.name, "plate");
        assert.equal(cad.summarize(tree).parts, 1);
        assert.equal(cad.summarize(tree).triangles, 520);
        assertDrawable(tree);
        assert.ok(leaves(tree)[0].shape.edges.length > 0);
    });

    it("reads a text file", function () {
        let text = [
            "solid t",
            "facet normal 0 0 1",
            "outer loop",
            "vertex 0 0 0",
            "vertex 1 0 0",
            "vertex 0 1 0",
            "endloop",
            "endfacet",
            "endsolid t"
        ].join("\n");
        let tree = cad.fromStl(Buffer.from(text), "tri.stl");

        assert.equal(cad.summarize(tree).triangles, 1);
        assert.deepEqual(tree.bb, {
            xmin: 0,
            xmax: 1,
            ymin: 0,
            ymax: 1,
            zmin: 0,
            zmax: 0
        });
        assertDrawable(tree);
    });

    it("refuses an empty file", function () {
        assert.throws(() => cad.fromStl(Buffer.from("nothing"), "x.stl"));
    });
});

describe("cad.fromOcct (STEP)", function () {
    let occt;

    it("keeps the assembly, names and colors", async function () {
        let result;
        let tree;
        let plate;

        occt = await require("occt-import-js")();
        result = occt[READ_STEP](
            new Uint8Array(fixture("bracket.step")),
            null
        );
        tree = cad.fromOcct(result, "bracket.step");

        assert.equal(tree.name, "bracket");
        assert.deepEqual(
            leaves(tree).map((p) => p.name).sort(),
            ["Plate", "Post"]
        );
        assertDrawable(tree);

        plate = leaves(tree).find((p) => p.name === "Plate");
        // Written as 0.8, 0.2, 0.2 (the reader hands back linear light)
        assert.equal(plate.color, "#cc3333");
        assert.equal(plate.shape.triangles_per_face.length, 7);
        assert.equal(tree.bb.zmax, 44);
        assert.equal(tree.bb.xmin, -30);
    });

    it("refuses a failed read", function () {
        assert.throws(
            () => cad.fromOcct({success: false}, "x.step"),
            /could not be read/
        );
    });
});

describe("cad.featureEdges", function () {
    // A square tent: two slopes meeting at a ridge, open at the ends
    const verts = [
        0, 0, 0, 1, 0, 0, 0, 1, 1,
        1, 0, 0, 1, 1, 1, 0, 1, 1,
        0, 1, 1, 1, 1, 1, 0, 2, 0,
        1, 1, 1, 1, 2, 0, 0, 2, 0
    ];
    const tris = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

    it("keeps creases and borders, drops flat joins", function () {
        let flat = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
        let edges = cad.featureEdges(flat, [0, 1, 2, 3, 4, 5]);

        // The square's four sides only; the diagonal is a flat join
        assert.equal(edges.length / 6, 4);
        assert.ok(cad.featureEdges(verts, tris).length > 0);
    });

    it("smooths gentle angles and keeps sharp ones", function () {
        let normals = cad.creaseNormals([
            0, 0, 0, 1, 0, 0, 0, 1, 0,
            1, 0, 0, 1, 1, 0, 0, 1, 0
        ]);

        // Coplanar triangles share one normal
        assert.deepEqual(normals.slice(0, 3), [0, 0, 1]);
        assert.deepEqual(normals.slice(9, 12), [0, 0, 1]);
    });
});

describe("size limit", function () {
    it("refuses a model with too many triangles", function () {
        let tris = new Array(100001 * 9).fill(0);

        assert.throws(
            () => cad.fromTriangles(tris, "huge.stl"),
            /too large/
        );
    });

    it("refuses text a record cannot hold", function () {
        let tree = cad.fromShapes(fixture("teardrop.cad.json").toString());
        let big = {
            id: "/big",
            parts: [],
            pad: "x".repeat(4600000)
        };

        assert.throws(() => cad.toText(big), /MB/);
        assert.ok(cad.toText(tree).length < 4500000);
    });
});

describe("cad text", function () {
    it("keeps snake case keys through text and back", function () {
        let tree = cad.fromShapes(fixture("teardrop.cad.json").toString());
        let back = cad.fromText(cad.toText(tree));

        assert.equal(back.normal_len, 0);
        assert.ok(leaves(back)[0].shape.obj_vertices);
        assert.equal(cad.fromText(""), undefined);
        assert.equal(cad.fromText(undefined), undefined);
    });
});
