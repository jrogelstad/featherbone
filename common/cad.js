/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint this browser unordered for*/
/*global module, f*/
/**
    Turn CAD files into the shapes tree three-cad-viewer draws (version 3),
    which is what a CadModel keeps in `model`. Pure functions, no DOM: the
    browser feeds them file bytes, and the tests feed them the same.

    @module Cad
*/
(function () {
    "use strict";

    const cad = {};
    // The API takes bodies up to 5 MB; stay under it with room for the rest
    const MAX_BYTES = 4500000;
    const MAX_TRIANGLES = 100000;
    const FEATURE_DEGREES = 35;
    const SMOOTH_DEGREES = 35;
    const DEFAULT_COLOR = "#b8bcc2";
    const IDENTITY = [[0, 0, 0], [0, 0, 0, 1]];

    function round(n) {
        return Math.round(n * 10000) / 10000;
    }

    function cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    function unit(v) {
        let len = Math.hypot(v[0], v[1], v[2]);

        return (
            len > 0
            ? [v[0] / len, v[1] / len, v[2] / len]
            : [0, 0, 0]
        );
    }

    function point(arr, i) {
        return [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
    }

    function faceNormal(verts, a, b, c) {
        let p = point(verts, a);
        let q = point(verts, b);
        let r = point(verts, c);

        return cross(
            [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
            [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
        );
    }

    function bounds(verts) {
        let box = [
            Infinity, Infinity, Infinity,
            -Infinity, -Infinity, -Infinity
        ];
        let i;
        let d;

        for (i = 0; i < verts.length; i += 3) {
            for (d = 0; d < 3; d += 1) {
                box[d] = Math.min(box[d], verts[i + d]);
                box[d + 3] = Math.max(box[d + 3], verts[i + d + 0]);
            }
        }

        return box;
    }

    function boxToObject(box) {
        return {
            xmin: box[0],
            xmax: box[3],
            ymin: box[1],
            ymax: box[4],
            zmin: box[2],
            zmax: box[5]
        };
    }

    function mergeBox(a, b) {
        return [
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.min(a[2], b[2]),
            Math.max(a[3], b[3]),
            Math.max(a[4], b[4]),
            Math.max(a[5], b[5])
        ];
    }

    function corners(box) {
        let out = [];

        [0, 3].forEach(function (x) {
            [1, 4].forEach(function (y) {
                [2, 5].forEach(function (z) {
                    out.push(box[x], box[y], box[z]);
                });
            });
        });

        return out;
    }

    /*
        Give each position one number, so triangles that meet at a
        corner can be told apart from triangles that merely sit near it.
    */
    function weld(verts) {
        let box = bounds(verts);
        let diag = Math.hypot(
            box[3] - box[0],
            box[4] - box[1],
            box[5] - box[2]
        );
        let scale = 1 / Math.max(diag * 1e-6, 1e-9);
        let seen = new Map();
        let ids = new Array(verts.length / 3);
        let i;
        let key;

        for (i = 0; i < ids.length; i += 1) {
            key = (
                Math.round(verts[i * 3] * scale) + "," +
                Math.round(verts[i * 3 + 1] * scale) + "," +
                Math.round(verts[i * 3 + 2] * scale)
            );
            if (!seen.has(key)) {
                seen.set(key, seen.size);
            }
            ids[i] = seen.get(key);
        }

        return ids;
    }

    /**
        Segments (6 numbers each) along the creases and open borders of a
        triangle mesh: where neighbouring faces turn more than `degrees`,
        or where a triangle has no neighbour.

        @method featureEdges
        @param {Number[]} verts Flat x, y, z
        @param {Number[]} tris Flat vertex indices, three to a triangle
        @param {Number} [degrees]
        @return {Number[]}
    */
    cad.featureEdges = function (verts, tris, degrees) {
        let limit = Math.cos((degrees || FEATURE_DEGREES) * Math.PI / 180);
        let ids = weld(verts);
        let edges = new Map();
        let out = [];
        let t;

        function add(a, b, normal) {
            let lo = Math.min(ids[a], ids[b]);
            let hi = Math.max(ids[a], ids[b]);
            let key = lo + ":" + hi;
            let found = edges.get(key);

            if (!found) {
                found = {a, b, normals: []};
                edges.set(key, found);
            }
            found.normals.push(normal);
        }

        for (t = 0; t < tris.length; t += 3) {
            let a = tris[t];
            let b = tris[t + 1];
            let c = tris[t + 2];
            let n = unit(faceNormal(verts, a, b, c));

            if (n[0] !== 0 || n[1] !== 0 || n[2] !== 0) {
                add(a, b, n);
                add(b, c, n);
                add(c, a, n);
            }
        }

        edges.forEach(function (e) {
            let pair = e.normals;
            let sharp = pair.length !== 2;
            let p;
            let q;

            if (!sharp) {
                sharp = (
                    pair[0][0] * pair[1][0] +
                    pair[0][1] * pair[1][1] +
                    pair[0][2] * pair[1][2]
                ) < limit;
            }
            if (sharp) {
                p = point(verts, e.a);
                q = point(verts, e.b);
                p.concat(q).forEach((v) => out.push(round(v)));
            }
        });

        return out;
    };

    /**
        Normals for a mesh whose triangles each have their own three
        vertices: smooth across neighbours within `degrees`, sharp beyond.

        @method creaseNormals
        @param {Number[]} verts Flat x, y, z, three vertices per triangle
        @param {Number} [degrees]
        @return {Number[]}
    */
    cad.creaseNormals = function (verts, degrees) {
        let limit = Math.cos((degrees || SMOOTH_DEGREES) * Math.PI / 180);
        let ids = weld(verts);
        let count = verts.length / 9;
        let faceN = new Array(count);
        let around = new Map();
        let out = new Array(verts.length);
        let t;
        let k;

        for (t = 0; t < count; t += 1) {
            faceN[t] = faceNormal(verts, t * 3, t * 3 + 1, t * 3 + 2);
            for (k = 0; k < 3; k += 1) {
                if (!around.has(ids[t * 3 + k])) {
                    around.set(ids[t * 3 + k], []);
                }
                around.get(ids[t * 3 + k]).push(t);
            }
        }

        for (t = 0; t < count; t += 1) {
            let mine = unit(faceN[t]);

            for (k = 0; k < 3; k += 1) {
                let sum = [0, 0, 0];

                around.get(ids[t * 3 + k]).forEach(function (other) {
                    let n = unit(faceN[other]);

                    let dot = mine[0] * n[0] + mine[1] * n[1] + mine[2] * n[2];

                    if (dot >= limit) {
                        // Area weighted: the cross product keeps its size
                        sum[0] += faceN[other][0];
                        sum[1] += faceN[other][1];
                        sum[2] += faceN[other][2];
                    }
                });
                sum = unit(sum);
                out[(t * 3 + k) * 3] = round(sum[0]);
                out[(t * 3 + k) * 3 + 1] = round(sum[1]);
                out[(t * 3 + k) * 3 + 2] = round(sum[2]);
            }
        }

        return out;
    };

    function leaf(id, name, color, mesh) {
        let verts = mesh.vertices.map(round);
        let box = bounds(verts);
        let edges = cad.featureEdges(verts, mesh.triangles);
        let perFace = mesh.trianglesPerFace || [mesh.triangles.length / 3];
        let types = new Array(edges.length / 6).fill(0);

        return {
            box,
            part: {
                id,
                type: "shapes",
                subtype: "solid",
                name,
                shape: {
                    vertices: verts,
                    triangles: mesh.triangles,
                    normals: mesh.normals,
                    edges,
                    obj_vertices: corners(box),
                    face_types: new Array(perFace.length).fill(0),
                    edge_types: types,
                    triangles_per_face: perFace,
                    segments_per_edge: new Array(types.length).fill(1)
                },
                state: [1, 1],
                color: color || DEFAULT_COLOR,
                alpha: 1,
                texture: null,
                loc: IDENTITY,
                renderback: false,
                accuracy: null,
                bb: null
            }
        };
    }

    function cleanName(name) {
        return String(name || "").replace(/[\/\\]+/g, "-").trim() || "Model";
    }

    function stripExtension(name) {
        return cleanName(String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, ""));
    }

    function uniqueName(name, used) {
        let n = 2;
        let result = name;

        while (used.has(result)) {
            result = name + " (" + n + ")";
            n += 1;
        }
        used.add(result);

        return result;
    }

    function checkSize(triangles) {
        if (triangles > MAX_TRIANGLES) {
            throw new Error(
                "This model has " + triangles.toLocaleString() +
                " triangles; more than " + MAX_TRIANGLES.toLocaleString() +
                " is too large to keep as a record. " +
                "Export a coarser mesh or fewer parts."
            );
        }
    }

    /**
        The text a CadModel keeps in `model`. It is text rather than an
        object because the server camel-cases the keys of every object it
        returns (and drops those that start with an underscore), and the
        viewer's format is snake case: `obj_vertices`, `face_types`.

        @method toText
        @param {Object} tree Shapes tree
        @return {String}
    */
    cad.toText = function (tree) {
        let text = JSON.stringify(tree);
        let have = Math.round(text.length / 1e5) / 10;
        let most = Math.round(MAX_BYTES / 1e5) / 10;

        if (text.length > MAX_BYTES) {
            throw new Error(
                "This model comes to " + have + " MB; a record holds up to " +
                most + " MB. Export a coarser mesh or fewer parts."
            );
        }

        return text;
    };

    /**
        The shapes tree held in a CadModel's `model`, or undefined when
        it holds none.

        @method fromText
        @param {String} text
        @return {Object|undefined}
    */
    cad.fromText = function (text) {
        return (
            text
            ? JSON.parse(text)
            : undefined
        );
    };

    /**
        Classify a file by its name, and say what to do about the ones
        that cannot be read.

        @method kindOf
        @param {String} fileName
        @return {Object} `kind` ("step", "iges", "brep", "stl", "json",
        "solidworks", "drawing" or "unknown") and, when it cannot be read,
        a `message` for the person who dropped it
    */
    cad.kindOf = function (fileName) {
        let found = /\.([A-Za-z0-9]+)$/.exec(String(fileName || ""));
        let ext = (
            found
            ? found[1].toLowerCase()
            : ""
        );
        let kinds = {
            step: "step",
            stp: "step",
            iges: "iges",
            igs: "iges",
            brep: "brep",
            stl: "stl",
            json: "json"
        };

        if (kinds[ext]) {
            return {kind: kinds[ext]};
        }
        if (ext === "sldprt" || ext === "sldasm") {
            return {
                kind: "solidworks",
                message: (
                    "SolidWorks files can't be read directly. In SolidWorks " +
                    "choose File, Save As, STEP, then drop that file."
                )
            };
        }
        if (ext === "slddrw") {
            return {
                kind: "drawing",
                message: (
                    "A SolidWorks drawing is 2D. Save it as a PDF and add " +
                    "the PDF as a resource link; drop its part or assembly " +
                    "here as a STEP file for the 3D model."
                )
            };
        }

        return {
            kind: "unknown",
            message: (
                "Can't read ." + (ext || "this kind of file") +
                ". Use a STEP, STL or three-cad-viewer .json file."
            )
        };
    };

    /**
        Wrap triangles, three vertices apiece with no sharing, as a one
        part tree. Normals are smoothed across gentle angles and the
        creases get edge lines, so a mesh reads like CAD, not faceted.

        @method fromTriangles
        @param {Number[]} positions Flat x, y, z, nine numbers a triangle
        @param {String} name
        @return {Object} Shapes tree
    */
    cad.fromTriangles = function (positions, name) {
        let count = positions.length / 9;
        let tris = new Array(count * 3);
        let title = stripExtension(name);
        let made;
        let i;

        if (!count || count !== Math.floor(count)) {
            throw new Error("No triangles found in " + name);
        }
        checkSize(count);
        for (i = 0; i < tris.length; i += 1) {
            tris[i] = i;
        }
        made = leaf("/" + title + "/" + title, title, DEFAULT_COLOR, {
            vertices: Array.from(positions),
            normals: cad.creaseNormals(Array.from(positions).map(round)),
            triangles: tris
        });

        return {
            version: 3,
            name: title,
            id: "/" + title,
            loc: IDENTITY,
            normal_len: 0,
            bb: boxToObject(made.box),
            parts: [made.part]
        };
    };

    /**
        Read an STL file, binary or text.

        @method fromStl
        @param {ArrayBuffer|Uint8Array} data
        @param {String} name File name, for the model's name
        @return {Object} Shapes tree
    */
    cad.fromStl = function (data, name) {
        let bytes = (
            ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data)
        );
        let view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength
        );
        let count = (
            bytes.byteLength >= 84
            ? view.getUint32(80, true)
            : 0
        );
        let positions = [];
        let text;
        let re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
        let found;
        let i;
        let j;

        if (count > 0 && bytes.byteLength === 84 + 50 * count) {
            checkSize(count);
            for (i = 0; i < count; i += 1) {
                for (j = 0; j < 9; j += 1) {
                    positions.push(
                        view.getFloat32(84 + 50 * i + 12 + j * 4, true)
                    );
                }
            }
        } else {
            text = new TextDecoder().decode(bytes);
            found = re.exec(text);
            while (found) {
                positions.push(
                    parseFloat(found[1]),
                    parseFloat(found[2]),
                    parseFloat(found[3])
                );
                found = re.exec(text);
            }
            checkSize(positions.length / 9);
        }
        if (positions.some((n) => !Number.isFinite(n))) {
            throw new Error("The STL file has numbers that are not numbers");
        }

        return cad.fromTriangles(positions, name);
    };

    /**
        Turn what occt-import-js reads from a STEP, IGES or BREP file into
        a shapes tree, keeping the assembly's names.

        @method fromOcct
        @param {Object} result From ReadStepFile and its kin
        @param {String} name File name, for the model's name
        @return {Object} Shapes tree
    */
    cad.fromOcct = function (result, name) {
        let title = stripExtension(name);
        let total = 0;
        let box = null;
        let root;

        if (!result || !result.success || !result.root) {
            throw new Error("The file could not be read as a CAD model");
        }
        result.meshes.forEach(function (mesh) {
            total += mesh.index.array.length / 3;
        });
        checkSize(total);

        // The reader gives linear light; the viewer wants display colors
        function toDisplay(v) {
            v = Math.max(0, Math.min(1, v));

            return (
                v <= 0.0031308
                ? 12.92 * v
                : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
            );
        }

        function colorOf(mesh) {
            let c = mesh.color;

            return (
                (c && c.length >= 3)
                ? "#" + c.slice(0, 3).map(function (v) {
                    let hex = Math.round(toDisplay(v) * 255).toString(16);

                    return hex.padStart(2, "0");
                }).join("")
                : DEFAULT_COLOR
            );
        }

        function meshLeaf(index, id, name) {
            let mesh = result.meshes[index];
            let brepFaces = mesh.brep_faces || [];
            let faces = brepFaces.map((face) => face.last - face.first + 1);
            let made = leaf(id, name, colorOf(mesh), {
                vertices: Array.from(mesh.attributes.position.array),
                normals: Array.from(mesh.attributes.normal.array, round),
                triangles: Array.from(mesh.index.array),
                trianglesPerFace: (
                    faces.length
                    ? faces
                    : undefined
                )
            });

            box = (
                box
                ? mergeBox(box, made.box)
                : made.box
            );

            return made.part;
        }

        // A node with one mesh and nothing under it is the part itself
        function build(node, id, isTop) {
            let used = new Set();
            let parts = [];
            let meshes = node.meshes || [];
            let children = node.children || [];

            if (!isTop && meshes.length === 1 && !children.length) {
                return meshLeaf(meshes[0], id, cleanName(node.name || "Part"));
            }
            meshes.forEach(function (index) {
                let mesh = result.meshes[index];
                let leafName = uniqueName(
                    cleanName(mesh.name || node.name || "Part"),
                    used
                );

                parts.push(meshLeaf(index, id + "/" + leafName, leafName));
            });
            children.forEach(function (child) {
                let childName = uniqueName(
                    cleanName(child.name || "Part"),
                    used
                );
                let sub = build(child, id + "/" + childName, false);

                // Leaves carry their name; groups need it set
                sub.name = childName;
                if (!sub.shape && !sub.parts.length) {
                    return;
                }
                parts.push(sub);
            });

            return {
                version: 3,
                name: (
                    isTop
                    ? title
                    : cleanName(node.name || "Part")
                ),
                id,
                loc: IDENTITY,
                parts
            };
        }

        root = build(result.root, "/" + title, true);
        root.normal_len = 0;
        root.bb = boxToObject(box || [0, 0, 0, 0, 0, 0]);

        return root;
    };

    /**
        Accept a tree already in three-cad-viewer's format, or a CadModel
        record that holds one, and say what is wrong with it if anything.

        @method fromShapes
        @param {Object|String} data
        @return {Object} Shapes tree
    */
    cad.fromShapes = function (data) {
        let tree = (
            typeof data === "string"
            ? JSON.parse(data)
            : data
        );
        let box = null;
        let total = 0;

        if (tree && tree.model && !tree.parts) {
            tree = tree.model;
        }
        if (!tree || typeof tree !== "object" || !tree.id) {
            throw new Error("Not a three-cad-viewer shapes file");
        }

        function check(node) {
            let s = node.shape;
            let verts;
            let problem;

            if (Array.isArray(node.parts)) {
                node.parts.forEach(check);
                return;
            }
            if (!s || !s.vertices || !s.triangles || !s.normals) {
                throw new Error(
                    "Part " + node.id + " has no vertices, triangles or normals"
                );
            }
            verts = s.vertices.length;
            if (verts % 3 !== 0 || s.normals.length !== verts) {
                problem = "its normals do not match its vertices";
            } else if (s.triangles.length % 3 !== 0) {
                problem = "its triangles are not in threes";
            } else if (s.triangles.some((i) => i < 0 || i >= verts / 3)) {
                problem = "a triangle points past its vertices";
            }
            if (problem) {
                throw new Error("Part " + node.id + ": " + problem);
            }
            total += s.triangles.length / 3;
            box = (
                box
                ? mergeBox(box, bounds(s.vertices))
                : bounds(s.vertices)
            );
        }

        check(tree);
        checkSize(total);
        tree.version = tree.version || 3;
        if (!tree.bb && box) {
            tree.bb = boxToObject(box);
        }

        return tree;
    };

    /**
        Count the parts and triangles of a tree, for a one line summary.

        @method summarize
        @param {Object} tree
        @return {Object} `parts` and `triangles`
    */
    cad.summarize = function (tree) {
        let out = {parts: 0, triangles: 0};

        function walk(node) {
            if (Array.isArray(node.parts)) {
                node.parts.forEach(walk);
            } else if (node.shape) {
                out.parts += 1;
                out.triangles += node.shape.triangles.length / 3;
            }
        }

        if (tree) {
            walk(tree);
        }

        return out;
    };

    let isNode = typeof module;

    if (isNode !== "undefined") {
        module.exports = cad;
    } else {
        f.cad = cad;
    }
}());
