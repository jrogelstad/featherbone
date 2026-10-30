/*
    The REST reference this package carries: each module's openapi.json
    documents exactly the routes its routes.json declares, and the
    server merges them into the instance's document under the module's
    prefix.
*/
/*jslint node*/
"use strict";

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {http} = require("featherbone-test");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Each module with routes: {dir, module, routes, spec}
function modules() {
    return fs.readdirSync(ROOT, {withFileTypes: true}).filter(
        (ent) => ent.isDirectory() &&
        fs.existsSync(path.join(ROOT, ent.name, "routes.json"))
    ).map(function (ent) {
        let dir = path.join(ROOT, ent.name);
        let file = path.join(dir, "openapi.json");

        return {
            dir,
            manifest: read(path.join(dir, "manifest.json")),
            routes: read(path.join(dir, "routes.json")).map(
                (item) => item.data || item
            ),
            spec: (
                fs.existsSync(file)
                ? read(file)
                : undefined
            )
        };
    });
}

function operations(spec) {
    let ops = [];

    Object.keys(spec.paths || {}).forEach(function (p) {
        Object.keys(spec.paths[p]).forEach(function (method) {
            ops.push({method, op: spec.paths[p][method], path: p});
        });
    });

    return ops;
}

function refs(node, found) {
    if (Array.isArray(node)) {
        node.forEach((item) => refs(item, found));
    } else if (node && typeof node === "object") {
        Object.keys(node).forEach(function (key) {
            if (key === "$ref") {
                found.push(node[key]);
            } else {
                refs(node[key], found);
            }
        });
    }
    return found;
}

describe("REST reference (SupplyChain)", function () {
    const mods = modules();
    let doc;

    before(async function () {
        let admin = await http.signedIn();

        doc = await admin.get("/openapi.json");
    });

    it("every module with routes carries one", function () {
        assert.deepEqual(
            mods.filter((mod) => !mod.spec).map((mod) => mod.dir),
            []
        );
    });

    it("documents each route once, and nothing else", function () {
        let problems = [];

        mods.forEach(function (mod) {
            let name = mod.manifest.module;
            let ops = operations(mod.spec);
            let declared = new Map(
                mod.routes.map((r) => [r.path, r.function])
            );

            ops.forEach(function (one) {
                if (one.method !== "post") {
                    problems.push(name + " " + one.path + ": not post");
                }
                if (!declared.has(one.path)) {
                    problems.push(name + " " + one.path + ": no such route");
                } else if (declared.get(one.path) !== one.op.operationId) {
                    problems.push(name + " " + one.path + ": operationId");
                }
            });
            declared.forEach(function (ignore, p) {
                if (!mod.spec.paths[p]) {
                    problems.push(name + " " + p + ": undocumented");
                }
            });
        });

        assert.deepEqual(problems, []);
    });

    it("declares the tags it uses", function () {
        let problems = [];

        mods.forEach(function (mod) {
            let name = mod.manifest.module;
            let tags = new Set((mod.spec.tags || []).map((t) => t.name));

            operations(mod.spec).forEach(function (one) {
                (one.op.tags || []).forEach(function (tag) {
                    if (!tags.has(tag)) {
                        problems.push(name + ": tag " + tag);
                    }
                });
            });
        });

        assert.deepEqual(problems, []);
    });

    it("is served under each module's prefix", function () {
        let missing = [];

        mods.forEach(function (mod) {
            let prefix = "/" + mod.manifest.module.replace(
                /([a-z0-9])([A-Z])/g,
                "$1-$2"
            ).toLowerCase();

            mod.routes.forEach(function (r) {
                let p = prefix + "/" + r.path.replace(/^\/+/, "");

                if (!doc.paths[p] || !doc.paths[p].post) {
                    missing.push(p);
                }
            });
        });

        assert.deepEqual(missing, []);
        assert.ok(
            doc["x-tagGroups"].some((g) => g.name === "Sell"),
            "Sell group"
        );
    });

    it("refers only to schemas the instance has", function () {
        let unresolved = refs(doc, []).filter(function (ref) {
            let node = doc;

            ref.replace(/^#\//, "").split("/").forEach(function (part) {
                node = (
                    node
                    ? node[part]
                    : undefined
                );
            });

            return !node;
        });

        assert.deepEqual([...new Set(unresolved)], []);
    });
});
