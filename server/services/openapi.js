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
/*jslint node unordered*/
/**
    The REST API reference of one instance, as an OpenAPI document.

    Assembled on request from three sources, so it always describes the
    software that instance runs:

      1. the framework's own `openapi.json` at the checkout root,
      2. a path set and schema for every feather in the instance catalog,
      3. the `openapi.json` beside the manifest of each deployed module,
         read from the version the database deployed. Its paths are
         written as `routes.json` writes them; the module's prefix is
         added here.

    Each source gets a tag group, so the reader sees what came from
    where.

    @module OpenApi
*/
(function (exports) {
    "use strict";

    const fs = require("fs/promises");
    const path = require("path");
    // String helpers (toSpinalCase and kin)
    require("../../common/string");
    const {Config} = require("../config");
    const {Packages} = require("./packages");

    const CORE = path.resolve(__dirname, "../../openapi.json");
    const config = new Config();
    const ERR = {"$ref": "#/components/responses/Error"};
    const FORMATS = {
        date: "date",
        dateTime: "date-time",
        email: "email",
        password: "password",
        url: "uri"
    };

    function copy(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    async function readJson(file) {
        try {
            return JSON.parse(await fs.readFile(file, "utf8"));
        } catch (ignore) {
            return undefined;
        }
    }

    function json(schema) {
        return {"application/json": {schema}};
    }

    function ref(name) {
        return {"$ref": "#/components/schemas/" + name};
    }

    // One feather property as a schema
    function propertySchema(prop) {
        let ret = {};
        let type = prop.type;

        if (typeof type === "object") {
            if (type.parentOf) {
                ret = {type: "array", items: ref(type.relation)};
            } else {
                ret = {
                    type: "object",
                    description: type.relation + " reference",
                    required: ["id"],
                    properties: {id: {type: "string"}}
                };
                let shown = type.properties || [];

                shown.forEach(function (key) {
                    ret.properties[key] = {};
                });
            }
        } else if (prop.format === "money") {
            ret = ref("Money");
        } else {
            ret.type = type;
            if (FORMATS[prop.format]) {
                ret.format = FORMATS[prop.format];
            }
        }

        if (prop.description && !ret.$ref) {
            ret.description = (
                ret.description
                ? prop.description + " (" + ret.description + ")"
                : prop.description
            );
        }
        if (prop.isReadOnly && !ret.$ref) {
            ret.readOnly = true;
        }

        return ret;
    }

    function featherSchema(key, feather) {
        let props = {};
        let required = [];
        let schema = {};

        Object.keys(feather.properties || {}).forEach(function (name) {
            let prop = feather.properties[name];

            // A child's link back to its parent is not sent
            if (typeof prop.type === "object" && prop.type.childOf) {
                return;
            }
            if (prop.isRequired) {
                required.push(name);
            }
            props[name] = propertySchema(prop);
        });

        if (feather.description) {
            schema.description = feather.description;
        }

        if (key === "Object") {
            schema.type = "object";
            schema.properties = props;
        } else {
            schema.allOf = [ref(feather.inherits || "Object")];
            if (Object.keys(props).length) {
                schema.allOf.push({type: "object", properties: props});
            }
        }
        if (required.length) {
            schema.required = required;
        }

        return schema;
    }

    // Paths the server mounts for a feather (see registerDataRoute)
    function featherPaths(key, feather, tag) {
        let name = key.toName();
        let spinal = key.toSpinalCase();
        let idParam = {
            name: "id",
            in: "path",
            required: true,
            schema: {type: "string"}
        };
        let ret = {};
        let one = {};

        one.get = {
            tags: [tag],
            operationId: "get" + key,
            summary: "Get a " + name,
            parameters: [idParam],
            responses: {
                "200": {description: name, content: json(ref(key))},
                default: ERR
            }
        };

        if (!feather.isReadOnly) {
            ret["/data/" + spinal] = {
                post: {
                    tags: [tag],
                    operationId: "insert" + key,
                    summary: "Add a " + name,
                    requestBody: {required: true, content: json(ref(key))},
                    responses: {
                        "200": {
                            description: (
                                "Differences the server applied to the " +
                                "request, such as defaults and the id"
                            ),
                            content: json(ref("JSONPatch"))
                        },
                        default: ERR
                    }
                }
            };
            one.patch = {
                tags: [tag],
                operationId: "update" + key,
                summary: "Update a " + name,
                parameters: [idParam],
                requestBody: {"$ref": "#/components/requestBodies/JSONPatch"},
                responses: {
                    "200": {
                        description: "Differences the server applied",
                        content: json(ref("JSONPatch"))
                    },
                    default: ERR
                }
            };
            one.delete = {
                tags: [tag],
                operationId: "delete" + key,
                summary: "Delete a " + name,
                parameters: [idParam],
                responses: {
                    "200": {
                        description: "True when deleted",
                        content: json({type: "boolean"})
                    },
                    default: ERR
                }
            };
        }
        ret["/data/" + spinal + "/{id}"] = one;

        if (feather.plural) {
            ret["/data/" + feather.plural.toSpinalCase()] = {
                post: {
                    tags: [tag],
                    operationId: "query" + feather.plural.toCamelCase(true),
                    summary: "Query " + feather.plural.toName(),
                    requestBody: {"$ref": "#/components/requestBodies/Query"},
                    responses: {
                        "200": {
                            description: feather.plural.toName(),
                            content: json({type: "array", items: ref(key)})
                        },
                        default: ERR
                    }
                }
            };
        }

        return ret;
    }

    function eachOperation(paths, fn) {
        Object.keys(paths).forEach(function (p) {
            Object.keys(paths[p]).forEach(function (method) {
                let op = paths[p][method];

                if (op && typeof op === "object" && !Array.isArray(op)) {
                    fn(op, p, method);
                }
            });
        });
    }

    /**
        Put the pieces together. No database or file system: what an
        instance runs is passed in, so this is what tests exercise.

        @method assemble
        @param {Object} spec
        @param {Object} spec.core The framework's own document
        @param {Object} spec.catalog Feather catalog
        @param {Array} [spec.modules] [{name, version, parent, spec}] in
        display order; `spec` is the module's document or undefined
        @param {String} [spec.database] Instance, for the server url
        @param {String} [spec.title] Document title
        @return {Object} OpenAPI document
    */
    exports.assemble = function (spec) {
        let doc = copy(spec.core);
        let catalog = spec.catalog || {};
        let modules = spec.modules || [];
        let comps;
        let groups = {Core: doc.tags.map((t) => t.name)};
        let order = ["Core"];
        let tagNames = new Set(groups.Core);
        let shown = new Set(groups.Core);
        let opIds = new Set();
        let lines = [];
        let addSchema;

        doc.components = doc.components || {};
        comps = doc.components;
        comps.schemas = comps.schemas || {};
        doc.paths = doc.paths || {};
        eachOperation(doc.paths, (op) => opIds.add(op.operationId));

        // First come keeps a name; a clash is logged, never fatal
        addSchema = function (name, schema, from) {
            if (comps.schemas[name]) {
                console.error(
                    "OpenAPI: schema " + name + " from " + from +
                    " clashes with an existing one; ignored"
                );
                return;
            }
            comps.schemas[name] = schema;
        };

        function groupOf(module) {
            if (!groups[module]) {
                groups[module] = [];
                order.push(module);
            }
            return groups[module];
        }

        function uniqueOp(op, prefix) {
            if (op.operationId && opIds.has(op.operationId)) {
                op.operationId = prefix + op.operationId.toCamelCase(true);
            }
            opIds.add(op.operationId);
        }

        // Modules in display order first, so their groups line up
        modules.forEach((mod) => groupOf(mod.name));

        // Feathers
        Object.keys(catalog).sort().forEach(function (key) {
            let feather = catalog[key];
            let module = feather.module || "Core";
            let tag = key.toSpinalCase();

            addSchema(key, featherSchema(key, feather), "feather " + key);

            // The base of everything, never addressed by itself
            if (key === "Object") {
                return;
            }

            // Shown by name; one taken already gets a qualifier
            let display = key.toName();

            if (shown.has(display)) {
                display += " (data)";
            }
            shown.add(display);
            doc.tags.push({
                name: tag,
                "x-displayName": display,
                description: feather.description || ""
            });
            tagNames.add(tag);
            groupOf(module).push(tag);

            let paths = featherPaths(key, feather, tag);

            Object.keys(paths).forEach(function (p) {
                eachOperation({p: paths[p]}, (op) => uniqueOp(op, key));
                doc.paths[p] = paths[p];
            });
        });

        // Module documents
        modules.forEach(function (mod) {
            let mspec = mod.spec;
            let prefix = "/" + mod.name.toSpinalCase();
            let renamed = {};
            let group = groupOf(mod.name);

            lines.push(
                "| " + (
                    mod.parent
                    ? "&nbsp;&nbsp;" + mod.name + " (" + mod.parent + ")"
                    : mod.name
                ) + " | " + mod.version + " |"
            );

            if (!mspec) {
                return;
            }

            let mtags = mspec.tags || [];

            mtags.forEach(function (tag) {
                let t = copy(tag);

                if (tagNames.has(t.name)) {
                    renamed[t.name] = mod.name + " " + t.name;
                    t.name = renamed[tag.name];
                }
                tagNames.add(t.name);
                doc.tags.push(t);
                group.push(t.name);
            });

            Object.keys(mspec.paths || {}).forEach(function (p) {
                let item = copy(mspec.paths[p]);

                eachOperation({p: item}, function (op) {
                    let tags = op.tags || [];

                    op.tags = tags.map((t) => renamed[t] || t);
                    uniqueOp(op, mod.name);
                });
                doc.paths[prefix + "/" + p.replace(/^\/+/, "")] = item;
            });

            Object.keys(mspec.components || {}).forEach(function (kind) {
                let from = mspec.components[kind] || {};

                comps[kind] = comps[kind] || {};
                Object.keys(from).forEach(function (name) {
                    if (kind === "schemas") {
                        addSchema(name, from[name], "module " + mod.name);
                    } else if (!comps[kind][name]) {
                        comps[kind][name] = from[name];
                    }
                });
            });
        });

        doc["x-tagGroups"] = order.filter(
            (name) => groups[name].length
        ).map((name) => ({name, tags: groups[name]}));

        if (spec.database) {
            doc.servers = [{
                url: "/" + spec.database,
                description: "This instance"
            }];
        }

        if (spec.title) {
            doc.info.title = spec.title;
        }
        if (lines.length) {
            doc.info.description = (
                (doc.info.description || "") +
                "\n\n| Module | Version |\n| --- | --- |\n" +
                lines.join("\n")
            );
        }

        return doc;
    };

    /**
        Name and version of each module a database deployed, with the
        package that carries it when it came inside another (a
        SupplyChain sub-module). Umbrella packages sort before what they
        carry.

        @method deployed
        @param {Client} client
        @param {Object} packages Scanned package registry
        @return {Promise} [{name, version, parent, dir}]
    */
    exports.deployed = async function (client, packages) {
        let resp = await client.query(
            "SELECT name, version FROM module WHERE NOT is_deleted"
        );
        let rows = resp.rows.filter((row) => row.name !== "Core");

        rows = rows.map(function (row) {
            let pkg = packages.resolve(row.name, row.version);

            return {
                dir: (
                    pkg
                    ? pkg.dir
                    : undefined
                ),
                name: row.name,
                parent: (
                    (pkg && pkg.parent)
                    ? pkg.parent.name
                    : undefined
                ),
                version: row.version
            };
        });

        function top(row) {
            let name = row.parent || row.name;

            return name.toLowerCase();
        }

        return rows.sort(function (a, b) {
            if (top(a) !== top(b)) {
                return (
                    top(a) < top(b)
                    ? -1
                    : 1
                );
            }
            if (Boolean(a.parent) !== Boolean(b.parent)) {
                return (
                    a.parent
                    ? 1
                    : -1
                );
            }
            return (
                a.name.toLowerCase() < b.name.toLowerCase()
                ? -1
                : 1
            );
        });
    };

    /**
        @class OpenApi
        @constructor
        @namespace Services
    */
    exports.OpenApi = function () {
        let that = {};

        /**
            The instance's REST API reference.

            @method getSpec
            @param {Object} payload
            @param {Client} payload.client Database client
            @return {Promise} OpenAPI document
        */
        that.getSpec = async function (obj) {
            let client = obj.client;
            let conf = await config.read();
            let packages = new Packages();
            let core = await readJson(CORE);
            let cat;
            let mods;
            let specs = [];
            let i = 0;

            if (!core) {
                throw new Error("The framework's openapi.json is missing");
            }

            packages.scan(conf.modulesDir);
            mods = await exports.deployed(client, packages);
            while (i < mods.length) {
                specs.push(
                    mods[i].dir
                    ? await readJson(path.join(mods[i].dir, "openapi.json"))
                    : undefined
                );
                i += 1;
            }
            cat = await client.query(
                "SELECT data FROM \"$settings\" WHERE name = 'catalog'"
            );

            return exports.assemble({
                catalog: (
                    cat.rows.length
                    ? cat.rows[0].data
                    : {}
                ),
                core,
                database: client.database,
                modules: mods.map(
                    (mod, n) => Object.assign({}, mod, {spec: specs[n]})
                ),
                title: core.info.title + " REST API"
            });
        };

        return that;
    };

}(exports));
