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
/*jslint this, browser, unordered, devel*/
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
    let doSend;
    let onClean;
    let onDirty;
    let onDelete;
    let onSave = [];
    let onSaved = [];
    let models = catalog.store().models();
    let name = feather.toCamelCase();
    let isSubscribed = false;
    let ary = [];
    let dirty = [];
    let sid = f.createId();
    let isBackground = false;
    let pathname = "/" + location.pathname.replaceAll("/", "");
    let onEvents = [];

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
        @param {Boolean} Add to top of list if new.
    */
    ary.add = function (model, subscribe, at) {
        let mstate;
        let payload;
        let theUrl;
        let query;
        let subid;
        let id = model.id();
        let idx = ary.index();
        let oid = Number(idx[id]);
        let i;
        let iParent = false;
        let row;
        let indentOn = ary.indentOn();
        let level;
        let keys;
        let k;

        if (!Number.isNaN(oid)) {
            dirty.remove(ary[oid]);
            ary.splice(oid, 1, model);
        } else {
            if (at === true) {
                Object.keys(idx).forEach(function (k) {
                    idx[k] += 1;
                });
                idx[id] = 0;
                ary.unshift(model);
            } else if (typeof at === "number") {
                i = at;
                keys = Object.keys(idx);
                while (i < keys.length) {
                    k = keys[i];
                    idx[k] += 1;
                    i += 1;
                }
                idx[id] = at;
                ary.splice(at, 0, model);
            } else {
                idx[id] = ary.length;
                ary.push(model);
            }
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

        // Indent support
        if (indentOn) {
            // Set previous record as parent if applicable
            level = model.data[indentOn]();
            i = ary.indexOf(model);
            if (i > 0 && level > 0) {
                while (i > 0 && !iParent) {
                    i -= 1;
                    row = ary[i];
                    if (row.data[indentOn]() < level) {
                        iParent = row;
                        iParent.isTreeParent(true);
                    }
                }
            }
            // Set up current model indent properties
            model.isTreeParent = f.prop(false);
            model.treeParent = f.prop(iParent);
            model.collapsed = f.prop(false);
            model.hide = function () {
                let treeParent = model.treeParent();

                if (treeParent) {
                    if (treeParent.collapsed()) {
                        return true;
                    } else {
                        return treeParent.hide();
                    }
                }

                return false;
            };
            model.toggleCollapse = function (e) {
                model.collapsed(!model.collapsed());
                e.preventDefault();
                e.stopPropagation();
            };
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
            theUrl = pathname + "/do/subscribe/" + query;
            payload = {
                method: "POST",
                url: theUrl
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
        If indentation enabled, all parent rows collapsed.

        @method collapseAll
    */
    ary.collapseAll = function () {
        if (ary.indentOn()) {
            ary.forEach(function (model) {
                if (model.isTreeParent()) {
                    model.collapsed(true);
                }
            });
        }
    };

    /**
        If indentation enabled, all parent rows expanded.

        @method expanedAll
    */
    ary.expandAll = function () {
        if (ary.indentOn()) {
            ary.forEach(function (model) {
                if (model.isTreeParent()) {
                    model.collapsed(false);
                }
            });
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
    ary.fetch = function (filter, merge, background) {
        isBackground = Boolean(background);
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

    ary.inFilter = function (mdl) {
        let criteria = ary.filter().criteria;
        let rg;

        if (criteria && criteria.length) {
            return criteria.every(function (crit) {
                let prop;
                let val;

                // Search (OR)
                if (Array.isArray(crit.property)) {
                    return crit.property.some(function (p) {
                        prop = f.resolveProperty(mdl, p);
                        val = prop() || "";
                        rg = new RegExp(crit.value, "i");
                        return val.search(rg);
                    });
                }

                // Comparisons
                prop = f.resolveProperty(mdl, crit.property);
                val = prop();

                if (val === null) {
                    return false;
                }

                switch (crit.operator) {
                case "=":
                    return val === crit.value;
                case "!=":
                    return val !== crit.value;
                case "~":
                    rg = new RegExp(crit.value);
                    return val.match(rg);
                case "~*":
                    rg = new RegExp(crit.value, "i");
                    return val.match(rg);
                case "!~":
                    rg = new RegExp(crit.value);
                    return !val.match(rg);
                case "!~*":
                    rg = new RegExp(crit.value, "i");
                    return !val.match(rg);
                case ">":
                    return val > crit.value;
                case "<":
                    return val < crit.value;
                case ">=":
                    return val >= crit.value;
                case "<=":
                    return val <= crit.value;
                case "IN":
                    return crit.value.indexOf(val) !== -1;
                }
                return true;
            });
        }

        return true;
    };

    /**
        Default fetch limit.

        @method defaultLimit
        @param {Integer} Limit
        @return {Integer}
    */
    ary.defaultLimit = f.prop(LIMIT);

    /**
        Enables indented tree view. Tree
        will be indented based on integer
        value of property name passed. Top
        level should be zero.

        @method indentOn
        @param {String} Property Property with indentation level
        @return {String}
    */
    ary.indentOn = f.prop("");

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
        A function to call after a model is updated by a subscribed event.

        @method onEvent
        @param {Function} callback Callback function after subcription events
        @chainable
        @return {Object}
    */
    ary.onEvent = function (callback) {
        onEvents.push(callback);
    };
    /**
        A function to call before executing save. A view model will be
        passed in similar to static functions that allow for working with
        interactive dialogs or other presentation related elements.

        The callback function should return a Promise. Save will not complete
        untill the promises are resolved.

        @method onSave
        @param {Function} callback Callback function to call before save
        @param {Boolean} [flag] Put first in preprocess queue. Default false
        @chainable
        @return {Object}
    */
    ary.onSave = function (callback, prepend) {
        if (prepend) {
            onSave.unshift(callback);
        } else {
            onSave.push(callback);
        }
        return ary;
    };

    /**
        A function to call after executing save. A view model will be
        passed in similar to static functions that allow for working with
        interactive dialogs or other presentation related elements.

        The callback function should return a Promise. Note at this point
        the save(s) will be committed, so this handles user interactions as
        post processing such as prompts to print or continue on to next steps.

        @method onSaved
        @param {Function} callback Callback function to call on change
        @chainable
        @return {Object}
    */
    ary.onSaved = function (callback) {
        onSaved.push(callback);
        return ary;
    };
    /**
        The url path to data.

        @method path
        @param {String} Path
        @return {String}
    */
    ary.path = f.prop();

    /**
        Pending transactions.

        @method path
        @param {String} Path
        @return {String}
    */
    ary.pending = f.prop([]);

    /**
        Execute subscription event post processing.

        @method postProcess
    */
    ary.postProcess = function () {
        onEvents.forEach((evt) => evt());
    };

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
        ary.pending().length = 0;
        ary.length = 0;
        dirty.length = 0;
        ary.index({});
        state.goto("/Unitialized");
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
        @parameter {Object} [ViewModel] For save pre and post processing
        @return {Promise}
    */
    ary.save = function (vm) {
        return doSend("save", undefined, vm);
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
        let theUrl;
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
                    theUrl = pathname + "/do/unsubscribe/" + query;
                    payload = {
                        method: "POST",
                        url: theUrl
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
        let theUrl;
        let payload;
        let subid = ary.subscribe();
        let theBody = {};
        let isMerge = true;
        let cfeather = catalog.getFeather(name.toCamelCase(true));
        let pendId = f.createId();

        ary.pending().push(pendId);

        // Undo any edited rows
        if (!context.merge) {
            ary.forEach(function (model) {
                model.undo();
            });
        }

        if (context.merge === false) {
            isMerge = false;
        }

        function callback(data) {
            let attrs;
            let props = {};
            let cache = [];

            // If canceled, bail out
            if (ary.pending().indexOf(pendId) === -1) {
                context.resolve(ary);
                return;
            }

            if (!isMerge) {
                ary.reset();
            }

            if (ary.isEditable()) {
                data.forEach(function (item) {
                    let model = models[item.objectType.toCamelCase()](item);

                    model.state().goto("/Ready/Fetched");
                    ary.add(model);
                });
            } else {
                // Strip dot notation
                if (theBody.properties) {
                    theBody.properties = theBody.properties.map(function (p) {
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
                    theBody.properties || Object.keys(cfeather.properties)
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
            if (!isBackground) {
                m.redraw();
            }
            isBackground = false; // reset
            context.resolve(ary);
        }

        if (ary.properties()) {
            theBody.properties = ary.properties();
            // Make sure required properties are included
            Object.keys(cfeather.properties).forEach(function (key) {
                if (
                    cfeather.properties[key].isAlwaysLoad &&
                    theBody.properties.indexOf(key) === -1
                ) {
                    theBody.properties.push(key);
                }
            });
        }

        if (ary.filter()) {
            theBody.filter = f.copy(ary.filter());
            theBody.filter.limit = (
                theBody.filter.limit || ary.defaultLimit()
            );
        }

        if (theBody.filter && theBody.filter.showDeleted !== undefined) {
            ary.showDeleted(theBody.filter.showDeleted);
            delete theBody.filter.showDeleted;
        }

        theBody.showDeleted = ary.showDeleted();

        if (subid) {
            theBody.subscription = {
                id: subid,
                eventKey: catalog.eventKey(),
                merge: isMerge
            };
        }

        theUrl = pathname + ary.path();
        payload = {
            method: "POST",
            url: theUrl,
            body: theBody,
            background: true
        };
        return m.request(payload, {background: true}).then(
            callback
        ).catch(console.error);
    };

    async function doPreProcess(vm) {
        let idx = 0;
        let callback;
        while (idx < onSave.length) {
            callback = onSave[idx];
            idx += 1;
            await callback(vm);
        }
    }

    async function doPostProcess(vm) {
        let idx = 0;
        let callback;
        while (idx < onSaved.length) {
            callback = onSaved[idx];
            idx += 1;
            await callback(vm);
        }
    }

    async function doSave(context) {
        let requests = [];
        let resp = [];
        let r;
        let mdl;

        try {
            await doPreProcess(context.viewModel);

            // Save one by one if extra processing such
            // as user prompts set.
            if (dirty[0].hasExtraProcessing()) {
                while (dirty.length) {
                    mdl = dirty[0];
                    r = await mdl.save(context.viewModel);
                    resp.push(r);
                }
            // Otherwise save all at once which is faster
            } else {
                requests = dirty.map((mdl) => mdl.save(context.viewModel));
                resp = await Promise.all(requests);
            }
            state.send("changed");
            context.resolve(resp);

            await doPostProcess(context.viewModel);
        } catch (e) {
            context.reject(e);
        }
    }

    doSend = function (...args) {
        let evt = args[0];

        return new Promise(function (pResolve, pReject) {
            let context = {
                resolve: pResolve,
                reject: pReject
            };

            if (args.length > 1) {
                context.merge = args[1];
            }

            if (args.length > 2) {
                context.viewModel = args[2];
            }

            state.send(evt, context);
        });
    };

    // Define statechart
    state = State.define(function () {
        this.state("Unitialized", function () {
            this.event("fetched", function () {
                this.goto("/Fetched");
            });
            this.event("fetch", function (pContext) {
                this.goto("/Busy", {
                    context: pContext
                });
            });
        });

        this.state("Busy", function () {
            this.state("Fetching", function () {
                this.enter(doFetch);
                this.event("fetch", function (pContext) {
                    ary.pending().length = 0;
                    this.goto("/Busy", {
                        context: pContext,
                        force: true
                    });
                });
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
            this.event("fetch", function (pContext) {
                this.goto("/Busy", {
                    context: pContext
                });
            });
            this.state("Clean", function () {
                this.enter(function () {
                    dirty.length = 0;
                });
            });
            this.state("Dirty", function () {
                this.event("save", function (pContext) {
                    this.goto("/Busy/Saving", {
                        context: pContext
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
        ary.indentOn(options.indentOn || "");

        if (options.fetch !== false) {
            ary.fetch(options.filter, options.merge, options.background);
        } else {
            ary.filter(options.filter || {});
        }

        return prop;
    };
}

catalog.register("factories", "list", list);
catalog.register("lists");

export default Object.freeze(list);