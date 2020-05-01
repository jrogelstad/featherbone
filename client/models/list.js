/*
    Framework for building object relational database apps
    Copyright (C) 2020  John Rogelstad

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
/**
    @module List
*/
import f from "../core.js";
import catalog from "./catalog.js";
import State from "../state.js";

const Qs = window.Qs;
const m = window.m;
const console = window.console;

const LIMIT = 20;

// ..........................................................
// PRIVATE
//

/**
    @class List
    @static
*/
function createList(feather) {
    let state;
    let doFetch;
    let doSave;
    let doSend;
    let onClean;
    let onDirty;
    let onDelete;
    let models = catalog.store().models();
    let name = feather.toCamelCase();
    let isSubscribed = false;
    let ary = [];
    let dirty = [];
    let sid = f.createId();
    let isCheckUpdates = false;

    // ..........................................................
    // PUBLIC
    //

    /**
        Add a model to the list. Will replace existing
        if model with same id is already found in array.
        Pass subscribe option to automatically subscribe
        to server events on the model.

        @method add
        @param {Model} Model
        @param {Boolean} Subscribe flag.
    */
    ary.add = function (model, subscribe) {
        let mstate;
        let payload;
        let url;
        let query;
        let subid;
        let id = model.id();
        let idx = ary.index();
        let oid = Number(idx[id]);

        if (!Number.isNaN(oid)) {
            dirty.remove(ary[oid]);
            ary.splice(oid, 1, model);
        } else {
            idx[id] = ary.length;
            ary.push(model);
        }

        mstate = model.state();
        mstate.resolve("/Delete").enter(onDirty.bind(model));
        mstate.resolve("/Ready/Fetched/Dirty").enter(onDirty.bind(model));
        mstate.resolve("/Ready/Fetched/Clean").enter(onClean.bind(model));
        mstate.resolve("/Deleted").enter(onDelete.bind(model));

        if (model.state().current()[0] === "/Ready/New") {
            dirty.push(model);
            state.send("changed");
        }

        // Subscribe to events on new model if applicable
        if (subscribe) {
            subid = ary.subscribe();

            if (!subid) {
                return;
            }

            query = Qs.stringify({
                id: model.id(),
                subscription: {
                    id: subid,
                    eventKey: catalog.eventKey(),
                    merge: true
                }
            });
            url = "/do/subscribe/" + query;
            payload = {
                method: "POST",
                url: url
            };

            m.request(payload).catch(console.error);
        }
    };

    /**
        Set whether the array can have a filter. Turn
        off when list is not fetching.

        @method canFilter
        @param {Boolean} Can filter flag
        @return {Boolean}
    */
    ary.canFilter = f.prop(true);

    /**
        If turned on perform `checkUpdate` on all fetched
        models, or any newly fetched models. Do this if
        models are going to be edited.

        Note: only functions when `isEditable` is true.

        @method checkUpdate
        @param {Boolean} Enable or disable checking
    */
    ary.checkUpdate = function (enabled) {
        if (enabled === true) {
            isCheckUpdates = true;
            ary.forEach(function (model) {
                model.checkUpdate();
            });
        } else if (enabled === false) {
            isCheckUpdates = false;
        }
    };

    /**
        Fetch data. Returns a Promise.

        @method fetch
        @param {Filter} filter
        @param {Boolean} merge
        @param {Array} properties
        @return {Object}
    */
    ary.fetch = function (filter, merge) {
        ary.filter(filter || {});

        return doSend("fetch", merge);
    };

    /**
        Filter to use when fetching.

        @method filter
        @param {Filter} Filter
        @return {Filter}
    */
    ary.filter = f.prop({});

    /**
        Default fetch limit.

        @method defaultLimit
        @param {Integer} Limit
        @return {Integer}
    */
    ary.defaultLimit = f.prop(LIMIT);

    /**
        Model index.

        @method index
        @param {Object} Model index
        @return {Object}
    */
    ary.index = f.prop({});

    /**
        Flag whether data will be editable. If false
        models in list will be instantiated generically
        meaning no model specific business logic will
        be applied. It enables queries on specific
        properties, all of which improves performance.
        Models will also be set as read only.

        @method properties
        @param {Boolean} flag
        @return {Array}
    */
    ary.isEditable = f.prop(true);

    /**
        Model factory for creating new model instances.

        @method model
        @param {Object} Data
        @param {Object} Feather
        @return {Objects}
    */
    ary.model = models[feather.toCamelCase() || "Model"];

    /**
        The url path to data.

        @method path
        @param {String} Path
        @return {String}
    */
    ary.path = f.prop();

    /**
        Array of properties to fetch if only a subset required.
        If undefined, then all properties returned.

        @method properties
        @param {Array} Array of properties
        @return {Array}
    */
    ary.properties = f.prop();

    /**
        Remove a model from the list.

        @method remove
        @param {Model} Model
    */
    ary.remove = function (model) {
        let id = model.id();
        let idx = ary.index();
        let i = Number(idx[id]);

        if (!Number.isNaN(i)) {
            ary.splice(i, 1);
            Object.keys(idx).forEach(function (key) {
                if (idx[key] > i) {
                    idx[key] -= 1;
                }
            });
            delete idx[id];
        }
        dirty.remove(model);
    };

    /**
        Clear list.

        @method reset
    */
    ary.reset = function () {
        ary.length = 0;
        dirty.length = 0;
        ary.index({});
    };

    /**
        Toggle whether to show deleted records.

        @method showDeleted
        @param {Boolean} Whether to show deleted
        @return {Boolean}
    */
    ary.showDeleted = f.prop(false);

    /**
        Save dirty records in list. Returns a Promise.

        @method save
        @return {Promise}
    */
    ary.save = function () {
        return doSend("save");
    };

    /**
        List state.

        @method state
        @return {State}
    */
    ary.state = function () {
        return state;
    };

    /**
        Subscribe to change events on any records
        in the array. Returns subscription id when
        enabled by passing true at least once. Pass
        false to unsubscribe.

        @method subscribe
        @param {Boolean} Subscribe or unsubscribe.
        @return {String} Subcription id.
    */
    ary.subscribe = function (...args) {
        let query;
        let url;
        let payload;

        if (args.length) {
            if (args[0] === true) {
                isSubscribed = true;
                catalog.register("subscriptions", sid, ary);
            } else {
                if (isSubscribed) {
                    catalog.unregister("subscriptions", sid);

                    // Let the server know we're unsubscribing
                    query = {
                        subscription: {
                            id: sid
                        }
                    };

                    query = Qs.stringify(query);
                    url = "/do/unsubscribe/" + query;
                    payload = {
                        method: "POST",
                        url: url
                    };

                    return m.request(payload).catch(console.error);
                }

                isSubscribed = false;
            }
        }

        return (
            isSubscribed
            ? sid
            : false
        );
    };

    // ..........................................................
    // PRIVATE
    //

    onClean = function () {
        dirty.remove(this);
        state.send("changed");
    };

    onDelete = function () {
        ary.remove(this);
        state.send("changed");
    };

    onDirty = function () {
        dirty.push(this);
        state.send("changed");
    };

    dirty.remove = function (model) {
        let i = dirty.indexOf(model);

        if (i > -1) {
            dirty.splice(i, 1);
        }
    };

    doFetch = function (context) {
        let url;
        let payload;
        let subid = ary.subscribe();
        let body = {};
        let merge = true;
        let cfeather = catalog.getFeather(name.toCamelCase(true));

        // Undo any edited rows
        ary.forEach(function (model) {
            model.undo();
        });

        if (context.merge === false) {
            merge = false;
        }

        function callback(data) {
            let attrs;
            let props = {};
            let cache = [];

            if (!merge) {
                ary.reset();
            }

            if (ary.isEditable()) {
                data.forEach(function (item) {
                    let model = models[name](item);

                    model.state().goto("/Ready/Fetched");
                    if (isCheckUpdates) {
                        model.checkUpdate();
                    }
                    ary.add(model);
                });
            } else {
                // Strip dot notation
                if (body.properties) {
                    body.properties = body.properties.map(function (p) {
                        let i = p.indexOf(".");
                        let ret = p;

                        if (i !== -1) {
                            ret = p.slice(0, i);
                            if (cache.indexOf(ret) !== -1) {
                                ret = undefined;
                            }
                            cache.push(ret);
                        }
                        cache.push(ret);
                        return ret;
                    }).filter(function (p) {
                        return p !== undefined;
                    });
                }

                attrs = (
                    body.properties || Object.keys(cfeather.properties)
                );

                Object.keys(cfeather.properties).forEach(function (attr) {
                    let prop = cfeather.properties[attr];

                    if (prop.isAlwaysLoad || attrs.indexOf(attr) > -1) {
                        props[attr] = prop;
                    }
                });

                cfeather.properties = props;
                data.forEach(function (item) {
                    let model = models[name](item, cfeather);

                    model.state().goto("/Ready/Fetched");
                    ary.add(model);
                });
            }

            state.send("fetched");
            context.resolve(ary);
        }

        if (ary.properties()) {
            body.properties = ary.properties();
            // Make sure required properties are included
            Object.keys(cfeather.properties).forEach(function (key) {
                if (
                    cfeather.properties[key].isAlwaysLoad &&
                    body.properties.indexOf(key) === -1
                ) {
                    body.properties.push(key);
                }
            });
        }

        if (ary.filter()) {
            body.filter = f.copy(ary.filter());
            body.filter.limit = body.filter.limit || ary.defaultLimit();
        }

        if (body.filter && body.filter.showDeleted !== undefined) {
            ary.showDeleted(body.filter.showDeleted);
            delete body.filter.showDeleted;
        }

        body.showDeleted = ary.showDeleted();

        if (subid) {
            body.subscription = {
                id: subid,
                eventKey: catalog.eventKey(),
                merge: merge
            };
        }

        url = ary.path();
        payload = {
            method: "POST",
            url: url,
            body: body
        };

        return m.request(payload).then(callback).catch(console.error);
    };

    doSave = function (context) {
        let requests = [];

        dirty.forEach(function (model) {
            requests.push(model.save());
        });

        Promise.all(requests).then(function (resp) {
            state.send("changed");
            context.resolve(resp);
        }).catch(context.reject);
    };

    doSend = function (...args) {
        let evt = args[0];
        let merge = args[1];

        return new Promise(function (resolve, reject) {
            let context = {
                resolve: resolve,
                reject: reject
            };

            if (args.length > 1) {
                context.merge = merge;
            }

            state.send(evt, context);
        });
    };

    // Define statechart
    state = State.define(function () {
        this.state("Unitialized", function () {
            this.event("fetch", function (context) {
                this.goto("/Busy", {
                    context: context
                });
            });
        });

        this.state("Busy", function () {
            this.state("Fetching", function () {
                this.enter(doFetch);
            });
            this.state("Saving", function () {
                this.enter(doSave);
                this.event("changed", function () {
                    this.goto("/Fetched");
                });
            });
            this.event("fetched", function () {
                this.goto("/Fetched");
            });
        });

        this.state("Fetched", function () {
            this.event("changed", function () {
                this.goto("/Fetched", {
                    force: true
                });
            });
            this.c = this.C; // Squelch jslint complaint
            this.c(function () {
                if (dirty.length) {
                    return "./Dirty";
                }
                return "./Clean";
            });
            this.event("fetch", function (context) {
                this.goto("/Busy", {
                    context: context
                });
            });
            this.state("Clean", function () {
                this.enter(function () {
                    dirty.length = 0;
                });
            });
            this.state("Dirty", function () {
                this.event("save", function (context) {
                    this.goto("/Busy/Saving", {
                        context: context
                    });
                });
            });
        });
    });
    state.goto();

    return ary;
}

function list(feather) {
    // Instantiate the list, optionally auto fetch
    // and return a property that contains the array.
    return function (options) {
        options = options || {};
        let plural;
        let ary = options.value || createList(feather);
        let prop = f.prop(ary);

        if (options.path) {
            ary.path(options.path);
        } else {
            plural = catalog.getFeather(feather).plural.toSpinalCase();
            ary.path("/data/" + plural);
        }

        ary.showDeleted(options.showDeleted === true);
        ary.subscribe(options.subscribe === true);
        ary.isEditable(options.isEditable !== false);

        if (options.fetch !== false) {
            ary.fetch(options.filter, options.merge);
        } else {
            ary.filter(options.filter || {});
        }

        return prop;
    };
}

catalog.register("factories", "list", list);

export default Object.freeze(list);