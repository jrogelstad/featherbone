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
import datasource from "../datasource.js";
import catalog from "./catalog.js";
import State from "../state.js";

const jsonpatch = window.jsonpatch;
const Qs = window.Qs;

const store = catalog.store();

// ..........................................................
// PRIVATE
//

/**
    @private
    @method onFetching
*/
function onFetching() {
    this.state().goto("/Busy/Fetching");
}

/**
    @private
    @method onFetched
*/
function onFetched() {
    this.state().goto("/Ready/Fetched");
}

/**
    Function to extend child array
    @private
    @method extendArray
*/
function extendArray(model, prop, name, onChange, onChanged) {
    let state = model.state();
    let isNew = true;
    let cache = [];
    let ary = prop();

    // Bind parent events to array
    state.resolve("/Ready/New").enter(function (context) {
        if (context && context.clear === false) {
            return;
        }
        isNew = true;
        ary.clear();
    });

    state.resolve("/Ready/Fetched").enter(function () {
        isNew = false;
    });

    // Extend array
    ary.add = function (value) {
        let result;

        prop.state().send("change");
        if (value && value.isModel) {
            result = value;
        } else {
            // Create an instance
            result = catalog.store().models()[name](value);
        }

        result.parent(model);

        // Add bindings to change events
        if (onChange[prop.key]) {
            onChange[prop.key].forEach(function (item) {
                result.onChange(item.name, item.callback);
            });
        }

        if (onChanged[prop.key]) {
            onChanged[prop.key].forEach(function (item) {
                result.onChanged(item.name, item.callback);
            });
        }

        // Synchronize statechart
        state.resolve("/Busy/Fetching").enter(onFetching.bind(result));
        state.resolve("/Ready/Fetched").enter(onFetched.bind(result));

        // Remove original enter response on child
        result.state().resolve("/Busy/Fetching").enters.shift();
        result.state().resolve("/Ready/Fetched/Locking").enters.shift();
        result.state().resolve("/Delete").enters.shift();

        // Disable save event on child
        result.state().resolve("/Ready/New").event("save");
        result.state().resolve("/Ready/Fetched/Dirty").event("save");

        // Notify parent if child becomes dirty
        result.state().resolve("/Ready/Fetched/Locking").enter(function () {
            this.goto("../Dirty");
        });
        result.state().resolve("/Ready/Fetched/Dirty").enter(function () {
            state.send("changed");
        });
        result.state().resolve("/Delete").enter(function () {
            prop.state().send("change");
            prop.state().send("changed");
        });
        result.state().resolve("/Ready").enter(function () {
            prop.state().send("change");
            prop.state().send("changed");
        });

        // Notify parent properties changed
        ary.push(result);
        cache.push(result);
        prop.state().send("changed");

        return result;
    };

    ary.canAdd = f.prop(true);

    ary.clear = function () {
        prop.state().send("change");
        ary.length = 0;
        cache.length = 0;
        prop.state().send("changed");
    };

    ary.remove = function (value) {
        let result;
        let idx;
        let find;

        find = function (item, i) {
            if (value.id() === item.id()) {
                idx = i;
                return true;
            }
        };

        if (ary.some(find)) {
            prop.state().send("change");
            result = ary.splice(idx, 1)[0];
            cache.some(find); // Find index on cache
            if (isNew) {
                cache.splice(idx, 1);
            } else {
                delete cache[idx];
            }
            prop.state().send("changed");
        }

        return result;
    };

    ary.toJSON = function () {
        let item;
        let value;
        let isNotDeleting;
        let result = [];
        let len = cache.length;
        let i = 0;

        while (i < len) {
            item = cache[i];
            isNotDeleting = (item && item.state().current()[0] !== "/Delete");
            value = (
                isNotDeleting
                ? item.toJSON()
                : undefined
            );
            result.push(value);
            i += 1;
        }

        return result;
    };
}

/**
    @private
    @method handleDefault
*/
function handleDefault(prop, frmt) {
    if (!prop.default && !frmt) {
        return;
    }
    frmt = frmt || {};
    let def;

    // Handle default
    if (prop.default !== undefined && (
        prop.default !== null ||
        prop.type === "object" ||
        prop.type === "array" ||
        prop.format === "date" ||
        prop.format === "dateTime"
    )) {
        def = prop.default;
    } else if (typeof frmt.default === "function") {
        def = frmt.default();
    } else {
        def = frmt.default;
    }

    // Handle default that is a function
    if (
        typeof def === "string" &&
        def.match(/\(\)$/)
    ) {
        def = f[def.replace(/\(\)$/, "")];
    }

    return def;
}

/**
    @private
    @method isChild
    @param {Function} Property
*/
function isChild(p) {
    return p.type && typeof p.type === "object" && p.type.childOf;
}

/**
    @private
    @method isToOne
    @param {Function} Property
*/
function isToOne(p) {
    return (
        p.type && typeof p.type === "object" &&
        !p.type.childOf && !p.type.parentOf
    );
}

/**
    @private
    @method isToMany
    @param {Function} Property
*/
function isToMany(p) {
    return p.type && typeof p.type === "object" && p.type.parentOf;
}

/**
    A factory that returns a persisting object based on a definition
    called a `feather`. Can be extended by modifying the return object
    directly.

    @class model
    @constructor
    @param {Object} data Default data
    @param {Object} feather Feather specification
    @param {String} feather.name Class name of the object
    @param {String} [feather.inherits] Parent feather name
    @param {Object} feather.properties Properties to set on the
      data object
    @return {Model}
*/
function model(data, feather) {
    feather = (
        feather
        ? f.copy(feather)
        : {}
    );
    feather.overloads = feather.overloads || {};
    feather.inherits = feather.inherits || "Object";

    let that;
    let subcriptionId;
    let d;
    let doClear;
    let doDelete;
    let doError;
    let doFetch;
    let doInit;
    let doPatch;
    let doPost;
    let doSend;
    let doFreeze;
    let doThaw;
    let doRevert;
    let doLock;
    let doUnlock;
    let lastError;
    let state;
    let superclass;
    let errHandlers = [];
    let validators = [];
    let deleteChecks = [];
    let stateMap = {};
    let lastFetched = {};
    let freezeCache = {};
    let onChange = {};
    let onChanged = {};
    let isFrozen = false;
    let naturalKey;
    let canUpdate;
    let canDelete;

    // Inherit parent logic via traversal
    if (feather.inherits && feather.inherits !== "Object") {
        superclass = catalog.getFeather(feather.inherits);
        feather.inherits = superclass.inherits || "Object";
        return store.models()[superclass.name.toCamelCase()](
            data,
            feather
        );
    }

    data = data || {};

    /**
        Holder of getter/setter functions for all model data attributes as
        defined by the feather passed in.

        @example
            let instance;
            let catalog = f.catalog();
            let data = {
                name: "foo"
            };
            let feather = {
                name: "MyFeather",
                properties: {
                    name: {
                        type: "string"
                    }
                }
            }

            instance = f.model(data, feather);
            instance.data.name(); // foo
            instance.data.name("bar"); // bar
            instance.data.name(); // bar

        @property data
        @type Object
    */
    that = {
        data: {}
    };

    d = that.data;

    // ..........................................................
    // PUBLIC
    //

    /**
        Add a calculated property to "data."

        @method addCalculated
        @param {Object} options Options
        @param {String} options.name Name
        @param {String} [options.description] Description
        @param {Function} options.function Function
        @param {String} [options.type] Return type (default "string")
        @param {String} [options.format] Return format
        @param {Boolean} [options.isReadOnly] Read only (default true)
        @param {String} [options.style] Style name
        @chainable
        @return {Object}
    */
    that.addCalculated = function (options) {
        let fn = options.function;

        fn.isCalculated = true;
        fn.isChild = f.prop(false);
        fn.isParent = f.prop(false);
        fn.key = options.name;
        fn.description = options.description || "";
        fn.type = options.type || "string";
        fn.format = options.format;
        fn.isRequired = f.prop(false);
        fn.isReadOnly = f.prop(options.isReadOnly || false);
        fn.isToMany = isToMany.bind(null, fn);
        fn.isToOne = isToOne.bind(null, fn);
        fn.style = f.prop(options.style || "");
        d[options.name] = fn;

        return this;
    };

    /**
        Check whether changes in model can be saved in its
        current state.

        @method canSave
        @return {Boolean}
    */
    that.canSave = function () {
        return state.resolve(state.current()[0]).canSave();
    };

    /**
        Check whether model can undo changes in its current state.

        @method canUndo
        @return {Boolean}
    */
    that.canUndo = function () {
        return state.resolve(state.current()[0]).canUndo();
    };

    /**
        Check whether model can be updated according to
        authorization check.

        @method canUpdate
        @return {Boolean}
    */
    that.canUpdate = () => canUpdate;

    /**
        Check whether model can be deleted in its current state.

        @method canSave
        @return {Boolean}
    */
    that.canDelete = function () {
        return deleteChecks.every(function (check) {
            return check();
        });
    };

    /**
        Perform an authorization check whether the model
        can be deleted form the server. The result of
        `canCheck` will be based on the response of this query.

        @method checkDelete
    */
    that.checkDelete = function () {
        if (canDelete === undefined) {
            that.onCanDelete(function () {
                return Boolean(canDelete);
            });

            catalog.isAuthorized({
                id: that.id(),
                action: "canDelete"
            }).then(function (resp) {
                canDelete = resp;
            }).catch(doError);
        }
    };

    /**
        Will freeze model until it is confirmed the current user has
        authorization to update it. Without this action, editing will
        seem to be allowed until saving when an error will be thrown by
        the server. We wait as long as possible to check this to reduce
        overhead since most records fetched are not going to be updated.

        @method checkUpdate
    */
    that.checkUpdate = function () {
        let wasFrozen = that.isFrozen();

        if (canUpdate === undefined) {
            if (!wasFrozen) {
                doFreeze();
                catalog.isAuthorized({
                    id: that.id(),
                    action: "canUpdate"
                }).then(function (resp) {
                    canUpdate = resp;

                    if (canUpdate && !wasFrozen) {
                        doThaw();
                    }
                }).catch(doError);
            }
        }
    };

    /**
        Send event to clear properties on the object and set it to
        "/Ready/New" state.

        @method clear
    */
    that.clear = function () {
        state.send("clear");
    };

    /**
        Send event to delete the current object from the server.
        Returns a promise with a boolean passed back as the value.

        @method delete
        @param {Boolean} autoSave Automatically commit. Default false.
        @return {Promise}
    */
    that.delete = function (autoSave) {
        state.send("delete");
        if (autoSave) {
            return doSend("save");
        }
        return new Promise(function (resolve) {
            resolve(true);
        });
    };

    /**
        Send event to fetch data based on the current id from the server.
        Returns a promise with model.data passed back as the value.

        @method fetch
        @return {Promise}
    */
    that.fetch = function () {
        return doSend("fetch");
    };

    /**
        Return the unique identifier value for the model.

        @method id
        @return {String}
    */
    that.id = function (...args) {
        let prop = that.idProperty();

        if (args.length) {
            return d[prop](args[0]);
        }

        return d[prop]();
    };

    /**
        The data property that is the unique identifier for the model.
        Default is "id".

        @method idProperty
        @param {String} property Id property
        @return {String}
    */
    that.idProperty = f.prop("id");

    /**
        Indicates if model is in  a frozen state.

        @method isFrozen
        @return {Boolen}
    */
    that.isFrozen = function () {
        return isFrozen;
    };

    /**
        Property that indicates object is a model instance.

        @property isModel
        @default true
        @type boolean
    */
    that.isModel = true;

    /**
        Indicates whether the model is read only.

        @method isReadOnly
        @param {Boolean} isReadyOnly Read only flag
        @return {Boolean}
    */
    that.isReadOnly = f.prop(feather.isReadOnly === true);

    /**
        Returns whether the object is in a valid state to save.
        `lastError` value will be set by this if any are found.

        @method isValid
        @return {Boolean}
    */
    that.isValid = function () {
        try {
            validators.forEach(function (validator) {
                validator();
            });
        } catch (e) {
            doError(e);
            return false;
        }

        lastError = "";
        return true;
    };

    /**
        Return the last error raised.

        @method lastError
        @return {String}
    */
    that.lastError = function () {
        return lastError;
    };

    /**
        Lock record. To be applied when notification of locked status.
        Prevents other users from editing the record.

        @method lock
        @param {Object} object Lock object
        @return {Promise}
    */
    that.lock = function (lock) {
        state.send("lock", lock);
    };

    /**
        Feather name of model.

        @property name
        @type String
    */
    that.name = feather.name || "Object";

    /**
        Returns natural key property name.

        @method naturalKey
        @return {String}
    */
    that.naturalKey = function () {
        if (naturalKey === undefined) {
            naturalKey = Object.keys(feather.properties).find(
                function (key) {
                    if (feather.properties[key].isNaturalKey) {
                        return true;
                    }
                }
            );
            if (!naturalKey) {
                naturalKey = false;
                return "";
            }
        } else if (naturalKey === false) {
            return "";
        }

        return that.data[naturalKey]();
    };

    /**
        Add a function that returns a boolean to execute when the
        `canDelete` function is called. The function should validate
        whether a record will be allowed to be deleted.

        @example
            let catalog = f.catalog();

            function contact(data, feather) {
                feather = feather || catalog.getFeather("Contact");
                let that = f.model(data, feather);

                function deleteCheck () => !that.data.isPosted();

                // Add a check
                that.onCanDelete(deleteCheck);
            }

        @method onCanDelete
        @param {Function} callback Test function to execute when running canDelete
        @chainable
        @return {Object}
    */
    that.onCanDelete = function (callback) {
        deleteChecks.push(callback);

        return this;
    };

    /**
        Add an event binding to a property that will be triggered before a
        property change. Pass a callback in and the property will be
        passed to the callback. The property will be passed to the
        callback as the first argument. Dot notation is supported to
        traverse child properties.

        @example
            let catalog = f.catalog();
            let msg;
            let instance;

            function contact(data, feather) {
                feather = feather || catalog.getFeather("Contact");
                let that = f.model(data, feather);

                // Add a change event to a property
                that.onChange("firstName", function (prop) {
                    msg = (
                        "First name changing from " +
                        (prop.oldValue() || "nothing") + " to " +
                        prop.newValue() + "!"
                    );
                    console.log(msg);
                });
            }

            instance = contact();
            instance.data.firstName("Fred");
            // Contact changing from nothing to Fred

        @method onChange
        @param {String} name Property name to call on cahnge
        @param {Function} callback Callback function to call on change
        @chainable
        @return {Object}
    */
    that.onChange = function (name, callback) {
        let attr;
        let idx = name.indexOf(".");

        function func() {
            callback(this);
        }

        if (idx > -1) {
            attr = name.slice(0, idx);
            if (!onChange[attr]) {
                onChange[attr] = [];
            }
            onChange[attr].push({
                name: name.slice(idx + 1),
                callback: callback
            });
            return this;
        }

        stateMap[name].substateMap.Changing.enter(func.bind(d[name]));

        return this;
    };

    /**
        Add an event binding to a property that will be triggered after
        a property change. Pass a callback in and the property will be
        passed to the callback. The property will be passed to the
        callback as the first argument. Dot notation is supported to
        traverse child properties.

        @example
            let instance;
            let catalog = f.catalog();

            function contact(data, feather) {
                feather = feather || catalog.getFeather("Contact");
                let that = f.model(data, feather);

                // Add a changed event to a property
                that.onChanged("firstName", function (prop) {
                    console.log("First name is now " + prop() + "!");
                });
            }

            instance = contact();
            instance.data.name("Aiden"); // First name is now Aiden!

        @method onChanged
        @param {String} name Property name to call on cahnge
        @param {Function} callback Callback function to call on change
        @chainable
        @return {Object}
    */
    that.onChanged = function (name, callback) {
        let attr;
        let idx = name.indexOf(".");

        function func() {
            callback(this);
        }

        if (idx > -1) {
            attr = name.slice(0, idx);
            if (!onChanged[attr]) {
                onChanged[attr] = [];
            }
            onChanged[attr].push({
                name: name.slice(idx + 1),
                callback: callback
            });
            return this;
        }

        stateMap[name].substateMap.Changing.exit(func.bind(d[name]));

        return this;
    };

    /**
        Add an error handler binding to the object. Pass a callback
        in and the error will be passed as an argument.

        @example
            let instance;
            let catalog = f.catalog();

            function contact(data, feather) {
                feather = feather || catalog.getFeather("Contact");
                let that = f.model(data, shared);

                that.onValidate(function () {
                    if (that.data.phone().length <> 12) {
                        throw new Error("Phone number must be 12 characters");
                    }
                });

                // Add an error handler
                that.onError(function (err) {
                    console.log("Error->", err);
                });
            }

            instance = contact();
            instance.data.phone("555-1212");
            instance.isValid(); // False
            // Error->Phone number must be 12 characters

        @method onError
        @param {Function} callback Callback to execute on error
        @chainable
        @return {Object}
    */
    that.onError = function (callback) {
        errHandlers.push(callback);

        return this;
    };

    /**
        Execute a function whenever the state changes to `Ready/Fetched/Clean`
        or in other words right after model data has been fetched and loaded.

        @method onLoad
        @param {Function} callback Callback function to execute on load
        @chainable
        @return {Object}
    */
    that.onLoad = function (callback) {
        that.state().resolve("/Ready/Fetched/Clean").enter(callback);

        return this;
    };

    /**
        Add a validator to execute when the `isValid` function is
        called, which is also called after saving events. Errors thrown
        by the validator will be caught and passed through `onError`
        callback(s). The most recent error may also be access via
        `lastError`.

        @example
            let instance;
            let catalog = f.catalog();

            function contact(data, feather) {
                feather = feather || catalog.getFeather("Contact");
                let that = f.model(data, shared);

                that.onValidate(function () {
                    if (that.data.phone().length <> 12) {
                        throw new Error("Phone number must be 12 characters");
                    }
                });
            }

            instance = contact();
            instance.data.phone("555-1212");
            instance.isValid(); // False
            instance.lastError(); // Phone number must be 12 characters

        @method onValidate
        @param {Function} callback Callback to execute when validating
        @chainable
        @return {Object}
    */
    that.onValidate = function (callback) {
        validators.push(callback);

        return this;
    };

    /**
        Returns parent object if applicable.

        @method parent
        @return {Object}
    */
    that.parent = f.prop();

    /**
        Returns a path to execute server requests.

        @method path
        @param {String} name Name
        @param {String} [id] Id
        @return {String}
    */
    that.path = function (name, id) {
        let ret = "/data/" + name.toSpinalCase();

        if (id) {
            ret += "/" + id;
        }

        return ret;
    };

    /**
        Plural name of feather.

        @property plural
        @type String
    */
    that.plural = feather.plural;

    /**
        Send the save event to persist current data to the server.
        Only results in action in the "/Ready/Fetched/Dirty" and
        "/Ready/New" states.

        Returns a promise with model.data as the value.

        @method save
        @return {Promise}
    */
    that.save = function () {
        return doSend("save");
    };

    /**
        Send an event to all properties.

        @method sendToProperties
        @param {String} str Event name.
        @chainable
        @return {Object}
    */
    that.sendToProperties = function (str) {
        let keys = Object.keys(d);

        keys.forEach(function (key) {
            if (d[key].state) {
                d[key].state().send(str);
            }
        });

        return this;
    };

    /**
        Set properties to the values of a passed object. In
        other words deserialize an object.

        @method set
        @param {Object} data Data to set
        @param {Boolean} [silent] Silence change events
        @param {Boolean} [isLastFetched] Flag set from fetch
        @chainable
        @return {Object}
    */
    that.set = function (data, silent, islastFetched) {
        data = data || {};
        let keys;
        let climateChange = islastFetched && that.isFrozen();

        if (islastFetched) {
            lastFetched = data;
        }

        if (typeof data === "object") {
            if (climateChange) {
                doThaw();
            }

            keys = Object.keys(data);

            // Silence events if applicable
            if (silent) {
                that.sendToProperties("silence");
            }

            // Loop through each attribute and assign
            keys.forEach(function (key) {
                if (typeof d[key] === "function") {
                    d[key](data[key]);
                }
            });

            that.sendToProperties("report");

            if (climateChange) {
                doFreeze();
            }
        }

        return this;
    };

    /**
        Model statechart.

        @method state
        @param {Object} state Statechart
        @return {Object}
    */
    that.state = function (...args) {
        if (args.length) {
            state = args[0];
        }

        return state;
    };

    /**
        The style of the model when displayed in rows. Should be the
        name of a style.

        @method style
        @param {String} style Style name
        @return {String}
    */
    that.style = f.prop("");

    /**
        Subscribe or unsubscribe model to external events. If no flag
        passed and already subscribed, subscription id returned.

        @method subscribe
        @param {Boolean} Flag whether or not to subscribe to events.
        @return {Boolean | String} False or subscription id.
    */
    that.subscribe = function (...args) {
        let query;
        let url;
        let payload;
        let flag = args[0];

        if (!args.length) {
            if (subcriptionId) {
                return subcriptionId;
            }
            return false;
        }

        if (flag) {
            subcriptionId = f.createId();

            query = Qs.stringify({
                id: that.id(),
                subscription: {
                    id: subcriptionId,
                    eventKey: catalog.eventKey()
                }
            });

            catalog.register("subscriptions", subcriptionId, [that]);

            url = "/do/subscribe/" + query;
            payload = {
                method: "POST",
                path: url
            };

            datasource.request(payload).catch(doError);
        } else if (flag === false && subcriptionId) {
            catalog.unregister("subscriptions", subcriptionId);

            // Let the server know we're unsubscribing
            query = {
                subscription: {
                    id: subcriptionId
                }
            };

            query = Qs.stringify(query);
            url = "/do/unsubscribe/" + query;
            payload = {
                method: "POST",
                path: url
            };

            datasource.request(payload).catch(doError);

            subcriptionId = undefined;
            return false;
        }
    };

    /**
        Serialize data to a simple JavaScript object.

        @method toJSON
        @return {Object}
    */
    that.toJSON = function () {
        let keys = Object.keys(d);
        let result = {};

        keys.forEach(function (key) {
            if (!d[key].isCalculated) {
                result[key] = d[key].toJSON();
            }
        });

        return result;
    };

    /**
        Undo changes since last fetch.

        @method undo
    */
    that.undo = function () {
        state.send("undo");
    };

    /**
        Unlock record. To be applied when notification of unlocked status.

        @method unlock
        @return {Promise}
    */
    that.unlock = function () {
        state.send("unlock");
    };

    // ..........................................................
    // PRIVATE
    //

    doClear = function (context) {
        let keys = Object.keys(that.data);
        let values = {};

        // Bail if event that sent us here doesn't want to clear
        if (context && context.clear === false) {
            return;
        }

        // If first entry here with user data, clear for next time and bail
        if (data) {
            context.clear = false;
            data = undefined;
            return;
        }

        keys.forEach(function (key) {
            if (!that.data[key].isCalculated) {
                let value = that.data[key].default;

                values[key] = (
                    typeof value === "function"
                    ? value()
                    : value
                );
            }
        });

        that.set(values, true); // Uses silent option
    };

    doDelete = function (context) {
        let payload;

        function callback(result) {
            that.set(result, true, true);
            state.send("deleted");
            context.resolve(true);
        }

        payload = {
            method: "DELETE",
            path: that.path(that.name, that.id()),
            data: {
                eventKey: catalog.eventKey()
            }
        };

        datasource.request(payload).then(
            callback
        ).catch(
            doError.bind(context)
        );
    };

    doError = function (err) {
        if (err.message && err.message.slice(0, 1) === "\"") {
            err.message = err.message.slice(1, err.message.length - 1);
        }

        lastError = err;
        errHandlers.forEach(function (handler) {
            handler(err);
        });
        state.send("error");

        if (this && this.reject) {
            this.reject(err);
        }
    };

    doFetch = function (context) {
        let payload = {
            method: "GET",
            path: that.path(that.name, that.id())
        };

        function callback(result) {
            that.set(result, true, true);
            state.send("fetched");
            context.resolve(d);
        }

        datasource.request(payload).then(
            callback
        ).catch(
            doError.bind(context)
        );
    };

    doFreeze = function () {
        let keys = Object.keys(d);

        // Make all props read only, but remember previous state
        keys.forEach(function (key) {
            let prop = d[key];
            let value = prop();

            if (prop.isToMany() && !prop.isCalculated) {
                value.forEach(function (item) {
                    item.state().goto("/Ready/Fetched/ReadOnly");
                });
                return;
            }

            if (prop.state) {
                freezeCache[key] = {};
                freezeCache[key].isReadOnly = prop.isReadOnly();
                prop.isReadOnly(true);
                prop.state().send("disable");
            }
        });

        isFrozen = true;
    };

    doLock = function () {
        let lock;
        let query;
        let payload;

        function callback() {
            lock = {
                created: f.now()
            };
            state.send("locked", {
                context: lock
            });
        }

        function error(err) {
            doError(err);
            state.send("clean");
        }

        lock = {
            id: that.id(),
            eventKey: catalog.eventKey()
        };
        query = Qs.stringify(lock);
        payload = {
            method: "POST",
            path: "/do/lock/" + query
        };

        datasource.request(payload).then(callback).catch(error);
    };

    doUnlock = function () {
        let unlock;
        let query;
        let payload;

        function callback() {
            d.lock(null);
            state.send("unlocked");
        }

        function error(err) {
            doError(err);
            state.send("error");
        }

        unlock = {
            id: that.id(),
            eventKey: catalog.eventKey()
        };
        query = Qs.stringify(unlock);
        payload = {
            method: "POST",
            path: "/do/unlock/" + query
        };

        datasource.request(payload).then(callback).catch(error);
    };

    doPatch = function (context) {
        let patch = jsonpatch.compare(lastFetched, that.toJSON());
        let payload = {
            method: "PATCH",
            path: that.path(that.name, that.id()),
            data: patch
        };

        function callback(result) {
            // Update to sent changes
            jsonpatch.applyPatch(lastFetched, patch);
            // Update server side changes
            jsonpatch.applyPatch(lastFetched, result);
            that.set(lastFetched, true);
            state.send("fetched");
            context.resolve(d);
        }

        if (that.isValid()) {
            datasource.request(payload).then(
                callback
            ).catch(
                doError.bind(context)
            );
        }
    };

    doPost = function (context) {
        let cache = that.toJSON();
        let payload = {
            method: "POST",
            path: that.path(that.name),
            data: cache
        };

        function callback(result) {
            jsonpatch.applyPatch(cache, result);
            that.set(cache, true, true);
            state.send("fetched");
            context.resolve(d);
        }

        if (that.isValid()) {
            datasource.request(payload).then(
                callback
            ).catch(
                doError.bind(context)
            );
        }
    };

    doRevert = function () {
        that.set(lastFetched, true);
    };

    doSend = function (evt) {
        return new Promise(function (resolve, reject) {
            state.send(evt, {
                resolve: resolve,
                reject: reject
            });
        });
    };

    doThaw = function () {
        let keys = Object.keys(d);

        // Return read only props to previous state
        keys.forEach(function (key) {
            let prop = d[key];
            let value = prop();

            if (prop.isToMany() && !prop.isCalculated) {
                value.forEach(function (item) {
                    item.state().goto("/Ready/Fetched/Clean");
                });
            }

            if (prop.state) {
                prop.state().send("enable");
                if (freezeCache[key] !== undefined) {
                    prop.isReadOnly(freezeCache[key].isReadOnly);
                    prop.state().send("enable");
                }
            }
        });

        freezeCache = {};
        isFrozen = false;
    };

    doInit = function (data) {
        let props = feather.properties;
        let overloads = feather.overloads;
        let keys = Object.keys(props || {});

        // Loop through each model property and instantiate a data property
        keys.forEach(function (key) {
            let prop;
            let defaultValue;
            let name;
            let cFeather;
            let cKeys;
            let cArray;
            let relation;
            let toType;
            let scale;
            let overload = overloads[key] || {};
            let alias = overload.alias || props[key].alias || key;
            let p = props[key];
            let min = p.min;
            let max = p.max;
            let type = p.type;
            let value = data[key];
            let formatter = {};

            p.default = overload.default || p.default;
            alias = alias.toName();

            // Create properties for relations
            if (typeof p.type === "object") {
                if (isChild(p)) {
                    return;
                } // Ignore child properties on client level

                relation = type.relation;
                name = relation.toCamelCase();

                if (isToOne(p)) {

                    // Need to to make sure transform knows to ignore
                    // inapplicable props
                    if (type.properties && type.properties.length) {
                        cFeather = f.copy(catalog.getFeather(relation));
                        cKeys = Object.keys(cFeather.properties);
                        cKeys.forEach(function (key) {
                            if (
                                type.properties.indexOf(key) === -1 &&
                                key !== "id"
                            ) {
                                delete cFeather.properties[key];
                            }
                        });
                        delete cFeather.inherits;
                    }

                    // Create a model instance if not already
                    formatter.toType = function (value) {
                        let result;

                        if (value === undefined || value === null) {
                            return null;
                        }
                        if (value && value.isModel) {
                            value = value.toJSON();
                        }

                        // Special instantiation
                        if (cFeather) {
                            result = model(value, cFeather);
                        // Get regular model
                        } else {
                            result = catalog.store().models()[name](value);
                        }

                        // Synchronize statechart
                        state.resolve("/Busy/Fetching").enter(
                            onFetching.bind(result)
                        );
                        state.resolve("/Ready/Fetched").enter(
                            onFetched.bind(result)
                        );

                        // Remove original do fetch event on child
                        result.state().resolve(
                            "/Busy/Fetching"
                        ).enters.shift();

                        // Disable save event on children
                        result.state().resolve(
                            "/Ready/New"
                        ).event("save");
                        result.state().resolve(
                            "/Ready/Fetched/Dirty"
                        ).event("save");

                        return result;
                    };

                    defaultValue = handleDefault(p);
                    if (value === undefined) {
                        value = (
                            typeof defaultValue === "function"
                            ? defaultValue()
                            : defaultValue
                        );
                    }

                    // Create property
                    prop = f.prop(value, formatter);

                    // Define format for to-many
                } else if (isToMany(p)) {
                    cArray = [];

                    // Create an instance for each relation if
                    // not already
                    formatter.toType = function (value) {
                        let msg;

                        value = value || [];

                        if (!Array.isArray(value)) {
                            msg = "Value assignment for " + key;
                            msg += " must be an array.";
                            throw new Error(msg);
                        }

                        if (value !== cArray) {
                            cArray.clear();
                            value.forEach(function (item) {
                                cArray.add(item);
                            });
                        }

                        return cArray;
                    };

                    // Create property
                    prop = f.prop(cArray, formatter);
                    extendArray(that, prop, name, onChange, onChanged);
                    prop(value);
                }

                // Resolve formatter to standard type
            } else {
                if (p.type === "number") {
                    scale = (
                        (p.scale === undefined || p.scale === -1)
                        ? f.SCALE_DEFAULT
                        : p.scale
                    );
                    formatter = {};
                    formatter.fromType = function (value) {
                        return value.toLocaleString(undefined, {
                            maximumFractionDigits: scale
                        });
                    };
                    toType = (
                        f.formats[p.format]
                        ? f.formats[p.format].toType
                        : f.types[p.type].toType
                    );

                    formatter.toType = function (value) {
                        let result = toType(value);

                        return result.round(scale);
                    };
                    formatter.default = 0;
                } else {
                    formatter = (
                        f.formats[p.format] ||
                        f.types[p.type] || {}
                    );
                }

                defaultValue = handleDefault(p, formatter);

                if (value === undefined) {
                    value = (
                        typeof defaultValue === "function"
                        ? defaultValue()
                        : defaultValue
                    );
                }

                // Create property
                prop = f.prop(value, formatter);
            }

            // Carry other property definitions forward
            prop.key = key; // Use of 'name' property is not allowed here
            prop.description = overload.description || p.description;
            prop.type = p.type;
            if (overload.type) {
                prop.type.relation = overload.type.relation;
            }
            prop.format = p.format;
            prop.default = defaultValue;
            prop.isRequired(p.isRequired);
            prop.isReadOnly(p.isReadOnly);
            prop.isCalculated = false;
            prop.alias(alias);
            prop.dataList = overload.dataList || p.dataList;
            prop.min = min;
            prop.max = max;
            prop.style = f.prop("");

            // Add state to map for event helper functions
            stateMap[key] = prop.state();

            // Report property changed event up to model
            that.onChanged(key, function () {
                state.send("changed");
            });

            d[key] = prop;
        });
    };

    // Define state
    state = State.define(function () {
        this.enter(doInit.bind(null, data));

        this.state("Ready", {
            H: "*"
        }, function () {
            this.event("fetch", function (context) {
                this.goto("/Busy", {
                    context: context
                });
            });

            this.state("New", function () {
                this.enter(doClear);
                this.event("clear", function () {
                    this.goto("/Ready/New", {
                        force: true
                    });
                });
                this.event("save", function (context) {
                    this.goto("/Busy/Saving", {
                        context: context
                    });
                });
                this.event("delete", function () {
                    this.goto("/Deleted");
                });
                this.canDelete = f.prop(true);
                this.canSave = that.isValid;
                this.canUndo = f.prop(false);
            });

            this.state("Fetched", function () {
                this.c = this.C; // Squelch jslint complaint
                this.c(function () {
                    if (that.isReadOnly()) {
                        return "./ReadOnly";
                    }
                });
                this.enter(function () {
                    if (d.lock && d.lock() && d.lock().username) {
                        this.goto("../../Locked");
                    }
                });
                this.event("clear", function () {
                    this.goto("/Ready/New");
                });
                this.event("delete", function () {
                    this.goto("/Delete");
                });

                this.state("Clean", function () {
                    this.event("changed", function () {
                        this.goto("../Locking");
                    });
                    this.event("lock", function (lock) {
                        this.goto("../../../Locked", {
                            context: lock
                        });
                    });
                    this.canDelete = f.prop(true);
                    this.canSave = f.prop(false);
                    this.canUndo = f.prop(false);
                });
                this.state("ReadOnly", function () {
                    this.enter(doFreeze);
                    this.exit(doThaw);
                    this.canDelete = f.prop(false);
                    this.canSave = f.prop(false);
                    this.canUndo = f.prop(false);
                });

                this.state("Locking", function () {
                    this.enter(doLock);
                    this.event("save", function (context) {
                        this.goto("/Busy/Saving/Patching", {
                            context: context
                        });
                    });
                    this.event("locked", function (context) {
                        if (context && context.lock) {
                            d.lock(context.lock);
                        }
                        this.goto("../Dirty");
                    });
                    this.canDelete = f.prop(false);
                    this.canSave = f.prop(false);
                    this.canUndo = f.prop(true);
                });

                this.state("Unlocking", function () {
                    this.enter(doUnlock);
                    this.event("unlocked", function () {
                        this.goto("../Clean");
                    });
                    this.canDelete = f.prop(false);
                    this.canSave = f.prop(false);
                    this.canUndo = f.prop(false);
                });

                this.state("Dirty", function () {
                    this.event("undo", function () {
                        doRevert();
                        this.goto("../Unlocking");
                    });
                    this.event("save", function (context) {
                        this.goto("/Busy/Saving/Patching", {
                            context: context
                        });
                    });
                    this.canDelete = f.prop(false);
                    this.canSave = that.isValid;
                    this.canUndo = f.prop(true);
                });
            });
        });

        this.state("Busy", function () {
            this.state("Fetching", function () {
                this.enter(doFetch);
                this.canDelete = f.prop(false);
                this.canSave = f.prop(false);
                this.canUndo = f.prop(false);
                this.event("fetched", function () {
                    this.goto("/Ready/Fetched");
                });
            });
            this.state("Saving", function () {
                this.event("fetched", function () {
                    this.goto("/Ready/Fetched/Clean");
                });
                this.state("Posting", function () {
                    this.enter(doPost);
                    this.canDelete = f.prop(false);
                    this.canSave = f.prop(false);
                    this.canUndo = f.prop(false);
                });
                this.state("Patching", function () {
                    this.enter(doPatch);
                    this.canDelete = f.prop(false);
                    this.canSave = f.prop(false);
                    this.canUndo = f.prop(false);
                });
                this.canDelete = f.prop(false);
                this.canSave = f.prop(false);
                this.canUndo = f.prop(false);
            });
            this.state("Deleting", function () {
                this.enter(doDelete);

                this.event("deleted", function () {
                    this.goto("/Deleted");
                });
                this.canDelete = f.prop(false);
                this.canSave = f.prop(false);
                this.canUndo = f.prop(false);
            });
            this.event("error", function () {
                this.goto("/Ready", {
                    context: {
                        clear: false
                    }
                });
            });
        });

        this.state("Locked", function () {
            this.enter(function (context) {
                if (context) {
                    d.lock(context);
                }
                doFreeze();
            });

            this.event("unlock", function () {
                doThaw();
                d.lock(null);
                this.goto("/Ready");
            });

            this.canDelete = f.prop(false);
            this.canSave = f.prop(false);
            this.canUndo = f.prop(false);
        });

        this.state("Delete", function () {
            this.enter(doLock);
            this.enter(doFreeze);

            this.event("save", function (context) {
                this.goto("/Busy/Deleting", {
                    context: context
                });
            });

            this.event("undo", function () {
                doUnlock();
            });
            this.event("unlocked", function () {
                doThaw();
                this.goto("/Ready");
            });
            this.canDelete = f.prop(false);
            this.canSave = f.prop(false);
            this.canUndo = f.prop(true);
        });

        this.state("Deleted", function () {
            this.event("clear", function () {
                this.goto("/Ready/New");
            });
            this.canDelete = f.prop(false);
            this.canSave = f.prop(false);
            this.canUndo = f.prop(false);
        });

        this.state("Deleting", function () {
            this.enter(doDelete);

            this.event("deleted", function () {
                this.goto("/Deleted");
            });
            this.canDelete = f.prop(false);
            this.canSave = f.prop(false);
            this.canUndo = f.prop(false);
        });
    });

    // Add standard validator that checks required properties
    // and validates children
    that.onValidate(function () {
        let name;
        let keys = Object.keys(d);

        function requiredIsNull(key) {
            let prop = d[key];
            if (
                prop.isRequired() && (prop() === null || (
                    prop.type === "string" && !prop()
                ))
            ) {
                name = prop.alias();
                return true;
            }

            // Recursively validate children
            if (prop.isToMany() && prop().length) {
                prop().forEach(function (child) {
                    if (!child.isValid()) {
                        throw child.lastError();
                    }
                });
            }
        }

        // Validate required values
        if (keys.some(requiredIsNull)) {
            throw "\"" + name + "\" is required";
        }
    });


    // Add standard check for 'canDelete'
    that.onCanDelete(function () {
        return state.resolve(state.current()[0]).canDelete();
    });

    // Initialize
    state.goto({
        context: {}
    });

    return that;

}

model.static = f.prop({});

f.model = model;

export default Object.freeze(model);
