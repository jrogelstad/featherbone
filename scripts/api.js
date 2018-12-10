/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
**/
/*global Promise*/
/*jslint node, es6*/
(function (exports) {
    "strict";

    const fs = require("fs");
    const f = require("../common/core");
    const datasource = require("../server/datasource");

    function processProperties(feather, properties) {
        var keys = Object.keys(feather.properties);

        feather.required = [];

        keys.forEach(function (key) {
            var property = feather.properties[key],
                newProperty,
                primitives = Object.keys(f.types),
                formats = Object.keys(f.formats);

            function props() {
                var obj = {};

                obj.id = {};
                obj.id.type = "string";

                property.type.properties.forEach(function (key) {
                    obj[key] = {};
                    obj[key].type = "string"; // TODO: Figure out what type really is based on feather
                });

                return obj;
            }

            // Bail if child property. Not necessary for api definition
            if (typeof property.type === "object" && property.type.childOf) {
                return;
            }

            newProperty = {};
            if (property.isRequired === true) {
                feather.required.push(key);
            }

            if (property.description) {
                newProperty.description = property.description;
            }

            if (typeof property.type === "object") {
                newProperty.type = property.type.parentOf
                    ? "array"
                    : "object";

                if (newProperty.type === "object") {
                    newProperty.required = ["id"];
                    newProperty.properties = props();
                } else {
                    newProperty.items = {
                        "$ref": "#/components/schemas/" + property.type.relation
                    };
                }
            } else {
                if (primitives.indexOf(property.type) !== -1) {
                    newProperty.type = property.type;
                } else {
                    throw new Error("Property type " + property.type +
                            " not supported on " + key + " for feather " + feather.name);
                }

                if (property.format) {
                    if (formats.indexOf(property.format) !== -1) {
                        newProperty.format = property.format.toSpinalCase();
                    } else {
                        throw new Error("Property format " + property.format +
                                " not supported on " + key + " for feather " + feather.name);
                    }
                }
            }

            properties[key] = newProperty;
        });
    }

    exports.API = function () {
        // ..........................................................
        // PUBLIC
        //

        var that = {};

        /**
          Build open api specification.

          @param {Object} client Database client
          @return {Object} Promise
        */
        that.build = function () {
            return new Promise(function (resolve, reject) {
                var api, catalog, payload, keys, name, path,
                        tags = [];

                function callback(resp) {
                    var schemas = api.components.schemas;

                    catalog = resp;

                    // Loop through each feather and append to api api
                    keys = Object.keys(catalog);
                    keys.sort(function (a, b) {
                        return a < b
                            ? -1
                            : 1;
                    });

                    keys.forEach(function (key) {
                        var schema, //tag,
                            feather = catalog[key],
                            properties = {},
                            inherits = feather.inherits || "Object",
                            pathName = "/data/" + key.toSpinalCase() + "/{id}";

                        name = key.toProperCase();

                        if (!tags.some((item) => item.name === feather.module)) {
                            tags.push({
                                name: feather.module,
                                description: feather.module + " module"
                            });
                        }

                        // Append singluar path
                        if (!feather.isChild) {
                            path = {
                                get: {
                                    tags: [feather.module],
                                    summary: "Info for a specific " + name,
                                    parameters: [
                                        {
                                            "name": "id",
                                            "in": "path",
                                            "description": "The id of the " + name + " to retrieve",
                                            "required": true,
                                            "schema": {
                                                "type": "string"
                                            }
                                        }
                                    ],
                                    responses: {
                                        "200": {
                                            "description": "Expected response to a valid request",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/" + key
                                                    }
                                                }
                                            }
                                        },
                                        "default": {
                                            "description": "Unexpected error",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/ErrorResponse"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            };

                            if (feather.readOnly !== true) {
                                path.patch = {
                                    tags: [feather.module],
                                    summary: "Update an existing " + name,
                                    operationId: "doPatch",
                                    parameters: [
                                        {
                                            "name": "id",
                                            "in": "path",
                                            "description": "The id of the " + name + " to retrieve",
                                            "required": true,
                                            "schema": {
                                                "type": "string"
                                            }
                                        }
                                    ],
                                    requestBody: {
                                        $ref: "#/components/requestBodies/JSONPatch"
                                    },
                                    responses: {
                                        "200": {
                                            "description": "Expected response to a valid request",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/JSONPatch"
                                                    }
                                                }
                                            }
                                        },
                                        "default": {
                                            "description": "Unexpected error",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/ErrorResponse"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                };
                                path.delete = {
                                    tags: [feather.module],
                                    summary: "Delete a " + name,
                                    operationId: "doDelete",
                                    parameters: [
                                        {
                                            "name": "id",
                                            "in": "path",
                                            "description": "The id of the " + name + " to retrieve",
                                            "required": true,
                                            "schema": {
                                                "type": "string"
                                            }
                                        }
                                    ],
                                    responses: {
                                        "200": {
                                            "description": "Boolean indicating succesful deletion",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "type": "boolean"
                                                    }
                                                }
                                            }
                                        },
                                        "default": {
                                            "description": "Unexpected error",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/ErrorResponse"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                };
                            }

                            api.paths[pathName] = path;

                            if (feather.readOnly !== true) {
                                path = {};
                                path.post = {
                                    tags: [feather.module],
                                    summary: "Add a new " + name + " to the database",
                                    operationId: "doInsert",
                                    requestBody: {
                                        "$ref": "#/components/requestBodies/" + key
                                    },
                                    responses: {
                                        "200": {
                                            "description": "Patch list of differences applied by the server to the request",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/JSONPatch"
                                                    }
                                                }
                                            }
                                        },
                                        "default": {
                                            "description": "Unexpected error",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/ErrorResponse"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                };

                                api.components.requestBodies[key] = {
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "$ref": "#/components/schemas/" + key
                                            }
                                        }
                                    },
                                    "description": name + " to be added",
                                    "required": true
                                };

                                pathName = "/data/" + key.toSpinalCase();
                                api.paths[pathName] = path;
                            }

                            // Append list path
                            if (feather.plural) {
                                path = {
                                    post: {
                                        tags: [feather.module],
                                        description: key + " data",
                                        operationId: "doSelect",
                                        requestBody: {
                                            "description": "Complex parameters",
                                            "required": false,
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "type": "object",
                                                        "properties": {
                                                            "showDeleted": {
                                                                "description": "Flag whether to show deleted records",
                                                                "required": false,
                                                                "schema": {
                                                                    "type": "boolean"
                                                                }
                                                            },
                                                            "subscription": {
                                                                "type": "object",
                                                                "description": "Subscription to auto subscribe to results",
                                                                "required": false,
                                                                "schema": {
                                                                    "type": "object",
                                                                    "required": [
                                                                        "id",
                                                                        "sessionId"
                                                                    ],
                                                                    "properties": {
                                                                        "id": {
                                                                            "description": "Subscription id",
                                                                            "type": "string"
                                                                        },
                                                                        "sessionId": {
                                                                            "description": "Client session id",
                                                                            "type": "string"
                                                                        },
                                                                        "merge": {
                                                                            "description": "Add results to prexisting subscription with matching id",
                                                                            "type": "boolean"
                                                                        }
                                                                    }
                                                                }
                                                            },
                                                            "filter": {
                                                                "description": "Define which objects and how to present",
                                                                "type": "object",
                                                                "properties": {
                                                                    "criteria": {
                                                                        "description": "filter criteria",
                                                                        "type": "array",
                                                                        "items": {
                                                                            "type": "object",
                                                                            "required": [
                                                                                "property",
                                                                                "value"
                                                                            ],
                                                                            "properties": {
                                                                                "property": {
                                                                                    "description": "Property to filter on. Dot notation for relations supported",
                                                                                    "type": "string"
                                                                                },
                                                                                "operator": {
                                                                                    "description": "Operator",
                                                                                    "type": "string",
                                                                                    "enum": [
                                                                                        "=",
                                                                                        "!=",
                                                                                        "~",
                                                                                        "!~",
                                                                                        "<",
                                                                                        ">",
                                                                                        "<=",
                                                                                        ">=",
                                                                                        "IN"
                                                                                    ],
                                                                                    "default": "="
                                                                                },
                                                                                "value": {
                                                                                    "description": "Value to filter for",
                                                                                    "type": "object",
                                                                                    "oneOf": [{
                                                                                        "type": "string"
                                                                                    }, {
                                                                                        "type": "integer"
                                                                                    }, {
                                                                                        "type": "number"
                                                                                    }, {
                                                                                        "type": "object"
                                                                                    }, {
                                                                                        "type": "boolean"
                                                                                    }]
                                                                                }
                                                                            }
                                                                        }
                                                                    },
                                                                    "sort": {
                                                                        "description": "Sort order",
                                                                        "type": "array",
                                                                        "items": {
                                                                            "type": "object",
                                                                            "required": [
                                                                                "property"
                                                                            ],
                                                                            "properties": {
                                                                                "property": {
                                                                                    "description": "Property to sort on",
                                                                                    "type": "string"
                                                                                },
                                                                                "order": {
                                                                                    "description": "Direction to sort on",
                                                                                    "type": "string",
                                                                                    "enum": [
                                                                                        "ASC",
                                                                                        "DESC"
                                                                                    ],
                                                                                    "default": "ASC"
                                                                                }
                                                                            }
                                                                        }
                                                                    },
                                                                    "offset": {
                                                                        "description": "Offset from first item",
                                                                        "type": "integer",
                                                                        "format": "int32"
                                                                    },
                                                                    "limit": {
                                                                        "description": "How many objects to return",
                                                                        "type": "integer",
                                                                        "format": "int32"
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        responses: {
                                            "200": {
                                                "description": "Array of " + feather.plural.toProperCase(),
                                                "content": {
                                                    "application/json": {
                                                        "schema": {
                                                            "$ref": "#/components/schemas/" + key
                                                        }
                                                    }
                                                }
                                            },
                                            "default": {
                                                "description": "Unexpected error",
                                                "content": {
                                                    "application/json": {
                                                        "schema": {
                                                            "$ref": "#/components/schemas/ErrorResponse"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                };

                                pathName = "/data/" + feather.plural.toSpinalCase();
                                api.paths[pathName] = path;
                            }
                        }
                        // Append singular feather definition
                        schema = {};

                        if (feather.description) {
                            schema.description = feather.description;
                        }

                        if (feather.discriminator) {
                            schema.discriminator = feather.discriminator;
                        }

                        processProperties(feather, properties);

                        if (key === "Object") {
                            delete schema.discriminator;
                            schema.type = "object";
                            schema.properties = properties;
                        } else {
                            schema.allOf = [{
                                $ref: "#/components/schemas/" + inherits
                            }];

                            if (Object.keys(properties).length) {
                                schema.allOf.push({
                                    properties: properties
                                });
                            }
                        }

                        if (feather.required.length) {
                            schema.required = feather.required;
                        }

                        schemas[key] = schema;
                    });

                    tags.sort(function (a, b) {
                        return a.name < b.name
                            ? -1
                            : 1;
                    });

                    api.tags = api.tags.concat(tags);

                    api = JSON.stringify(api, null, 4);

                    // Save api file
                    fs.writeFile("./api.json", api, function (err) {
                        if (err) {
                            console.error(err);
                            return;
                        }
                        resolve();
                    });
                }

                // Real work starts here
                console.log("Building Open API specification");

                // Load the baseline api file
                fs.readFile("./scripts/api-base.json", "utf8", function (err, data) {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    api = JSON.parse(data);

                    // Load the existing feather catalog from postgres
                    payload = {
                        method: "GET",
                        name: "getSettings",
                        data: {
                            name: "catalog"
                        }
                    };

                    datasource.request(payload, true)
                        .then(callback)
                        .catch(reject);
                });
            });
        };

        return that;
    };

}(exports));