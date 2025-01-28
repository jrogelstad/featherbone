/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
/*jslint this, browser, unordered*/
/**
    @module Catalog
*/
import createProperty from "../property.js";
import State from "../state.js";
import datasource from "../datasource.js";
const store = {};
const auths = {};

const m = window.m;
const Qs = window.Qs;

store.feathers = createProperty({});

function settings() {
    let state;
    let doFetch;
    let that = {};

    /**
        @method feathers
        @for Catalog
    */
    that.feathers = createProperty({});

    // Send event to fetch feather data from the server.
    /**
        @method fetch
        @for Catalog
        @param {Boolean} merge
        @return {Promise}
    */
    that.fetch = function (pMerge) {
        return new Promise(function (pResolve) {
            state.send("fetch", {
                resolve: pResolve,
                merge: pMerge
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
            this.event("fetch", function (pContext) {
                this.goto("/Busy", {
                    context: pContext
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

/**
    Invoke catalog settings as an object.

    @class Catalog
*/
const catalog = (function () {
    let that = settings();

    /**
      Return a model specification (feather) including inherited and
      calculated properties.

      @method getFeather
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
                    resultProps[key].isCalculated = true;
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

        @method isAuthorized
        @param {Object} Options
        @param {Object} [options] Payload
        @param {String} [options.action] Action name
        @param {String} [options.feather] Feather name
        @param {String} [options.id] Object id
        @return {Promise} Promise will resolve to a boolean.
    */
    that.isAuthorized = function (opts) {
        return new Promise(function (resolve, reject) {
            let query = Qs.stringify({
                feather: opts.feather,
                id: opts.id,
                action: opts.action
            });
            let payload = {
                method: "GET",
                path: "/do/is-authorized?" + query,
                background: opts.background
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

        @method register
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
            store[property] = createProperty({});
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
            * Registers the model in the catalog
            * Freezes the model

        @method registerModel
        @param {String} Feather name
        @param {Function} Model factory
        @return {model} model factory
    */
    that.registerModel = function (name, model) {
        model.static = model.static || createProperty({});
        model.calculated = model.calculated || createProperty({});

        that.register("models", name.toCamelCase(), Object.freeze(model));

        return model;
    };

    /**
        Unregister a property from the store.

        @method unregister
        @param {String} Property
        @param {String} Name
    */
    that.unregister = function (property, name) {
        delete store[property]()[name];
    };

    /**
        Return feathers loaded in the catalog.

        @method feathers
        @return {Object} feathers
    */
    that.feathers = store.feathers;

    /**
        Current instance event key.

        @method eventKey
        @param {String} key Event key
        @return {String}
    */
    that.eventKey = createProperty();

    // Expose global store data
    /**
        Store.

        @method store
        @return {Object}
    */
    that.store = function () {
        return store;
    };

    that.register("models");

    return that;
}());

export default Object.freeze(catalog);