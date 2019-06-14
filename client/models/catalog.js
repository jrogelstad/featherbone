/*
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*jslint this, browser*/
import f from "../core.js";
import State from "../state.js";
import datasource from "../datasource.js";
const store = {};
const auths = {};

const m = window.m;

store.feathers = f.prop({});

function settings() {
    let state;
    let doFetch;
    let that = {};

    that.feathers = f.prop({});

    // Send event to fetch feather data from the server.
    that.fetch = function (merge) {
        return new Promise(function (resolve) {
            state.send("fetch", {
                resolve: resolve,
                merge: merge
            });
        });
    };

    doFetch = function (context) {
        let payload = {
            method: "GET",
            path: "/settings/catalog"
        };

        function callback(result) {
            let merge;
            let data = result || {};

            data = data.data;
            if (context.merge) {
                merge = that.feathers();
                Object.keys(data).forEach(function (key) {
                    merge[key] = data[key];
                });
                data = merge;
            }
            that.feathers(data);
            state.send("fetched");
            context.resolve(data);
        }

        state.goto("/Busy");
        datasource.request(payload).then(callback);
    };

    state = State.define(function () {
        this.state("Ready", function () {
            this.event("fetch", function (context) {
                this.goto("/Busy", {
                    context: context
                });
            });
            this.state("New");
            this.state("Fetched", function () {
                this.state("Clean");
            });
        });

        this.state("Busy", function () {
            this.state("Fetching", function () {
                this.enter(doFetch);
            });
            this.event("fetched", function () {
                this.goto("/Ready/Fetched");
            });
            this.event("error", function () {
                this.goto("/Error");
            });
        });

        this.state("Error", function () {
            // Prevent exiting from this state
            this.canExit = function () {
                return false;
            };
        });
    });

    // Initialize
    state.goto();

    return that;
}

// Invoke catalog settings as an object
const catalog = (function () {
    let that = settings();

    /**
      Return a model specification (feather) including inherited and
      calculated properties.

      @param {String} Feather
      @param {Boolean} Include inherited or not. Default = true.
      @param {Boolean} Include calculated or not. Default = true.
      @return {String}
    */
    that.getFeather = function (
        feather,
        includeInherited,
        includeCalculated
    ) {
        let resultProps;
        let modelProps;
        let appendParent;
        let fmodel;
        let calculated;
        let feathers = that.feathers();
        let result = {
            name: feather,
            inherits: "Object"
        };

        appendParent = function (child, parent) {
            let model = feathers[parent];
            let parentProps = model.properties;
            let childProps = child.properties;
            let modelOverloads = model.overloads || {};
            let keys = Object.keys(parentProps);

            if (parent !== "Object") {
                appendParent(child, model.inherits || "Object");
            }

            // Inherit properties from parent
            keys.forEach(function (key) {
                if (childProps[key] === undefined) {
                    childProps[key] = parentProps[key];
                    childProps[key].inheritedFrom = parent;
                }
            });

            // Inherit overloads from parent
            child.overloads = child.overloads || {};
            keys = Object.keys(modelOverloads);
            keys.forEach(function (key) {
                child.overloads[key] = modelOverloads[key];
            });

            return child;
        };

        if (!feathers[feather]) {
            return false;
        }

        // Add other attributes after name
        Object.keys(feathers[feather]).forEach(function (key) {
            result[key] = feathers[feather][key];
        });

        // Want inherited properites before class properties
        if (includeInherited !== false && feather !== "Object") {
            result.properties = {};
            result = appendParent(result, result.inherits);
        } else {
            delete result.inherits;
        }

        // Now add local properties back in
        modelProps = feathers[feather].properties;
        resultProps = result.properties;
        Object.keys(modelProps).forEach(function (key) {
            resultProps[key] = modelProps[key];
        });

        // Add calculated
        if (includeCalculated !== false) {
            fmodel = store.models()[feather.toCamelCase()];

            if (fmodel && fmodel.calculated) {
                calculated = fmodel.calculated();
                Object.keys(calculated).forEach(function (key) {
                    resultProps[key] = calculated[key];
                });
            }
        }

        return result;
    };

    /**
        Check whether current is authorized to perform an action on a
        particular feather (class) or object.

        Allowable actions: `canCreate`, `canRead`, `canUpdate`, `canDelete`

        `canCreate` will only check feather names.

        @param {Object} Options
        @param {Object} [options] Payload
        @param {String} [options.action] Action name
        @param {String} [options.feather] Feather name
        @param {String} [options.id] Object id
        @return {Object} Promise
    */
    that.isAuthorized = function (opts) {
        return new Promise(function (resolve, reject) {
            let payload = {
                method: "GET",
                path: "/do/is-authorized",
                data: {
                    feather: opts.feather,
                    id: opts.id,
                    action: opts.action
                }
            };

            // Check if memozied
            if (
                opts.feather &&
                auths[opts.feather] &&
                auths[opts.feather][opts.action] !== undefined
            ) {
                resolve(auths[opts.feather][opts.action]);
                m.redraw();
                return;
            }

            function callback(resp) {
                // Memoize to reduce calls
                if (opts.feather) {
                    if (!auths[opts.feather]) {
                        auths[opts.feather] = {};
                    }
                    auths[opts.feather][opts.action] = resp;
                }

                resolve(resp);
            }

            datasource.request(payload).then(callback).catch(reject);
        });
    };

    /**
        Store global data.

        @param {String} Data type
        @param {String} Name of instance
        @param {Any} Value to store
        @return {Object} Instances of the data type
    */
    that.register = function (...args) {
        let property = args[0];
        let name = args[1];
        let value = args[2];

        if (!store[property]) {
            store[property] = f.prop({});
        }
        if (args.length > 1) {
            store[property]()[name] = value;
        }
        return store[property]();
    };

    /**
        Helper function for model creation. Does the following:
            * Adds a property "static" to the model factory which returns an
            object for holding static functions.
            * Adds a property "calculated" to the model factory which returns an
            object for storing calculated property definitions.
            * Adds a list function to the model factory if `createList` is true.
            * Registers the model in the catalog
            * Freezes the model

        @param {String} Feather name
        @param {Function} Model factory
        @param {Boolean} Flag whether to append list function to model
        @return {Function} model
    */
    that.registerModel = function (name, model, createList) {
        model.static = model.static || f.prop({});
        model.calculated = model.calculated || f.prop({});

        if (createList) {
            model.list = that.store().factories().list(name);
        }

        that.register("models", name.toCamelCase(), Object.freeze(model));

        return model;
    };

    that.unregister = function (property, name) {
        delete store[property]()[name];
    };

    that.feathers = store.feathers;

    /**
      Current instance event key.

      @param {String} Event key
      @return {String}
    */
    that.eventKey = f.prop();

    // Expose global store data
    that.store = function () {
        return store;
    };

    that.register("models");

    return that;
}());

export default Object.freeze(catalog);