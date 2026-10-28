/*
    The REST API reference: core's document, the instance's feathers and
    its modules' documents come together as one OpenAPI document, each
    source in its own tag group. No database: the pieces are passed in.
*/
/*jslint node unordered*/
"use strict";

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const {assemble} = require("../../server/services/openapi");

const ROOT = path.resolve(__dirname, "../..");
const METHODS = ["get", "post", "put", "patch", "delete"];
const CORE = require(path.join(ROOT, "openapi.json"));

const CATALOG = {
    Object: {
        module: "Core",
        properties: {id: {type: "string", description: "Id"}}
    },
    Contact: {
        module: "Core",
        inherits: "Object",
        plural: "Contacts",
        properties: {
            firstName: {type: "string", isRequired: true},
            birthDate: {type: "string", format: "date"}
        }
    },
    Widget: {
        module: "Sell",
        inherits: "Object",
        plural: "Widgets",
        description: "A thing sold",
        properties: {
            price: {type: "object", format: "money"},
            contact: {type: "object", isReadOnly: true, description: "Who"},
            buyer: {
                type: {relation: "Contact", properties: ["firstName"]}
            },
            parts: {type: {relation: "WidgetPart", parentOf: "widget"}}
        }
    },
    WidgetPart: {
        module: "Sell",
        inherits: "Object",
        isChild: true,
        properties: {
            widget: {type: {relation: "Widget", childOf: "parts"}},
            qty: {type: "number"}
        }
    },
    Ledger: {
        module: "Sell",
        inherits: "Object",
        isReadOnly: true,
        plural: "Ledgers",
        properties: {}
    }
};

const SELL = {
    openapi: "3.0.3",
    info: {title: "Sell", version: "2.1.18"},
    tags: [{name: "Sales order actions"}, {name: "contact"}],
    paths: {
        "/close-sales-order": {
            post: {
                tags: ["Sales order actions"],
                operationId: "doCloseSalesOrder",
                responses: {default: {"$ref": "#/components/responses/Error"}}
            }
        },
        "/who": {
            post: {
                tags: ["contact"],
                operationId: "getContact",
                responses: {default: {"$ref": "#/components/responses/Error"}}
            }
        }
    },
    components: {
        schemas: {SellThing: {type: "object"}, Contact: {type: "string"}}
    }
};

function build() {
    return assemble({
        catalog: CATALOG,
        core: CORE,
        database: "demo",
        modules: [
            {name: "SupplyChain", version: "2.2.44"},
            {name: "Sell", parent: "SupplyChain", spec: SELL, version: "2.1.18"}
        ],
        title: "Featherbone REST API"
    });
}

function operations(doc) {
    let ops = [];

    Object.keys(doc.paths).forEach(function (p) {
        Object.keys(doc.paths[p]).forEach(function (method) {
            ops.push(doc.paths[p][method]);
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

describe("OpenAPI document", function () {
    it("core's own document is valid enough to build on", function () {
        let manifest = require(path.join(ROOT, "manifest.json"));

        assert.match(CORE.openapi, /^3\.0\./);
        assert.equal(CORE.info.version, manifest.version);
        assert.ok(CORE.components.responses.Error);
        ["Error", "Money", "JSONPatch", "Query"].forEach(
            (name) => assert.ok(CORE.components.schemas[name], name)
        );
        assert.equal(CORE.servers, undefined, "servers are per instance");
    });

    it("is addressed to the instance", function () {
        let doc = build();

        assert.equal(doc.servers[0].url, "/demo");
        assert.equal(doc.info.title, "Featherbone REST API");
    });

    it("mounts the paths the server mounts for each feather", function () {
        let doc = build();

        assert.ok(doc.paths["/data/contact"].post);
        assert.deepEqual(
            Object.keys(doc.paths["/data/contact/{id}"]).sort(),
            ["delete", "get", "patch"]
        );
        assert.ok(doc.paths["/data/contacts"].post);
        assert.equal(
            doc.paths["/data/contacts"].post.responses["200"].content[
                "application/json"
            ].schema.type,
            "array"
        );
        // Read only: get, and query, but no writes
        assert.equal(doc.paths["/data/ledger"], undefined);
        assert.deepEqual(Object.keys(doc.paths["/data/ledger/{id}"]), ["get"]);
        // Object is the abstract base
        assert.equal(doc.paths["/data/object/{id}"], undefined);
    });

    it("describes feather properties", function () {
        let schemas = build().components.schemas;
        let widget = schemas.Widget.allOf[1].properties;

        assert.deepEqual(schemas.Widget.allOf[0], {
            "$ref": "#/components/schemas/Object"
        });
        assert.deepEqual(widget.price, {"$ref": "#/components/schemas/Money"});
        assert.equal(widget.buyer.type, "object");
        assert.ok(widget.buyer.properties.firstName);
        assert.equal(widget.parts.type, "array");
        assert.equal(widget.contact.readOnly, true);
        assert.equal(
            schemas.Contact.allOf[1].properties.birthDate.format,
            "date"
        );
        assert.deepEqual(schemas.Contact.required, ["firstName"]);
        // A child's link to its parent is not part of what is sent
        assert.equal(schemas.WidgetPart.allOf[1].properties.widget, undefined);
    });

    it("prefixes a module's paths as the server routes them", function () {
        let doc = build();

        assert.ok(doc.paths["/sell/close-sales-order"].post);
        assert.equal(doc.paths["/close-sales-order"], undefined);
    });

    it("groups tags by where they came from", function () {
        let groups = build()["x-tagGroups"];
        let names = groups.map((g) => g.name);
        let sell = groups.find((g) => g.name === "Sell");
        let core = groups.find((g) => g.name === "Core");

        assert.equal(names[0], "Core");
        assert.ok(core.tags.includes("contact"));
        assert.ok(sell.tags.includes("widget"));
        assert.ok(sell.tags.includes("Sales order actions"));
        // A package that only carries others gets no empty group
        assert.equal(names.includes("SupplyChain"), false);
    });

    it("keeps names unique when a module reuses one", function () {
        let doc = build();
        let ids = operations(doc).map((op) => op.operationId);
        let who = doc.paths["/sell/who"].post;

        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual(who.tags, ["Sell contact"]);
        assert.notEqual(who.operationId, "getContact");
        // The feather keeps its schema; the module's clash is dropped
        assert.equal(
            doc.components.schemas.Contact.allOf[0].$ref,
            "#/components/schemas/Object"
        );
        assert.ok(doc.components.schemas.SellThing);
    });

    it("lists module versions in the description", function () {
        let text = build().info.description;

        assert.match(text, /\| SupplyChain \| 2\.2\.44 \|/);
        assert.match(text, /Sell \(SupplyChain\) \| 2\.1\.18 \|/);
    });

    it("resolves every reference", function () {
        let doc = build();

        refs(doc, []).forEach(function (ref) {
            let parts = ref.replace(/^#\//, "").split("/");
            let node = doc;

            parts.forEach(function (part) {
                node = (
                    node
                    ? node[part]
                    : undefined
                );
            });
            assert.ok(node, "unresolved " + ref);
        });
    });

    it("every tag an operation uses is declared", function () {
        let doc = build();
        let declared = new Set(doc.tags.map((t) => t.name));

        operations(doc).forEach(function (op) {
            op.tags.forEach((tag) => assert.ok(declared.has(tag), tag));
        });
    });
});

/*
    Every route the server mounts under an instance is in core's
    document, or is one of the few that aren't API: pages, browser
    redirects, and what the feathers and modules document themselves.
*/
describe("core's document covers the server's routes", function () {
    let src;

    before(async function () {
        src = await fs.readFile(path.join(ROOT, "server.js"), "utf8");
    });

    const NOT_API = new Set([
        "get /",
        "get /api",
        "get /help",
        "get /oauth/google",
        "get /auth/magiclink/callback",
        "post /{module}/{path}"
    ]);

    // Feather data routes: the document generates these per feather
    function generated(route) {
        return (
            route === "/data" ||
            route.startsWith("/data/{collection}") ||
            route.startsWith("/data/user-account")
        );
    }

    function mounted() {
        let re = /dbRouter\.(get|post|put|patch|delete)\(\s*"(\/:db[^"]*)"/g;
        let found = [];
        let match = re.exec(src);

        while (match) {
            let route = match[2].replace(/^\/:db/, "").replace(
                /\/\*$/,
                "/:path"
            ).replace(/:(\w+)/g, "{$1}").replace(/(.)\/$/, "$1");

            found.push(match[1] + " " + route);
            match = re.exec(src);
        }

        return found;
    }

    it("documents each one", function () {
        let missing = mounted().filter(function (key) {
            let [method, route] = key.split(" ");

            return (
                !NOT_API.has(key) &&
                !generated(route) &&
                !(CORE.paths[route] && CORE.paths[route][method])
            );
        });

        assert.deepEqual(missing, []);
    });

    it("documents nothing the server doesn't mount", function () {
        let have = new Set(mounted());
        let stale = [];

        Object.keys(CORE.paths).forEach(function (route) {
            Object.keys(CORE.paths[route]).forEach(function (method) {
                if (
                    METHODS.includes(method) &&
                    !have.has(method + " " + route)
                ) {
                    stale.push(method + " " + route);
                }
            });
        });

        assert.deepEqual(stale, []);
    });
});
