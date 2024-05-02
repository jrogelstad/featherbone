/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
    @module Model
*/
import createProperty from "../property.js";
import datasource from "../datasource.js";
import catalog from "./catalog.js";
import State from "../state.js";

const f = window.f;
const jsonpatch = window.jsonpatch;
const Qs = window.Qs;

const store = catalog.store();

// ..........................................................
// PRIVATE
//
const noCopy = [
    "created",
    "createdBy",
    "updated",
    "updatedBy",
    "lock"
];

function purgeNoCopy(obj) {
    obj.id = f.createId();
    noCopy.forEach(function (attr) {
        delete obj[attr];
    });
    Object.keys(obj).forEach(function (key) {
        if (Array.isArray(obj[key])) {
            obj[key].forEach((a) => purgeNoCopy(a));
        }
    });
}

function simpleProp(store) {
    return function (...args) {
        if (args.length) {
            store = args[0];
        }

        return store;
    };
}

/**
    @private
    @method onFetching
*/
function onFetching(ary) {
    if (!Array.isArray(ary) || ary.indexOf(this) !== -1) {
        this.state().goto("/Busy/Fetching");
    }
}

/**
    @private
    @method onFetched
*/
function onFetched(ary) {
    if (!Array.isArray(ary) || ary.indexOf(this) !== -1) {
        this.state().goto("/Ready/Fetched");
    }
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
            result = catalog.store().models()[name]();
            result.set(value, true, true);
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
        state.resolve("/Busy/Fetching").enter(onFetching.bind(result, ary));
        state.resolve("/Ready/Fetched").enter(onFetched.bind(result, ary));

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

    ary.canAdd = createProperty(true);
    ary.canMove = f.prop(true);
    ary.clear = function () {
        prop.state().send("change");
        ary.length = 0;
        cache.length = 0;
        prop.state().send("changed");
    };

    ary.moveDown = function (a) {
        let idx = ary.indexOf(a) + 1;
        let b = ary[idx];
        let aId;
        let bId;
        let aData;
        let bData;

        if (idx > ary.length) {
            return;
        }

        aId = a.id();
        bId = b.id();
        aData = b.toJSON();
        aData.id = aId;
        bData = a.toJSON();
        bData.id = bId;
        prop.state().send("change");
        a.set(aData, true);
        b.set(bData, true);
        prop.state().send("changed");
    };

    ary.moveUp = function (b) {
        let idx = ary.indexOf(b) - 1;
        let a = ary[idx];
        let aId;
        let bId;
        let aData;
        let bData;

        if (idx < 0) {
            return;
        }

        aId = a.id();
        bId = b.id();
        aData = b.toJSON();
        aData.id = aId;
        bData = a.toJSON();
        bData.id = bId;
        prop.state().send("change");
        a.set(aData, true);
        b.set(bData, true);
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
        !p.type.parentOf
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
    A data persistence object based on a definition defined by a `feather`.

    @class Model
    @static
*/
function createModel(data, feather) {
    feather = (
        feather
        ? f.copy(feather)
        : {}
    );
    feather.overloads = feather.overloads || {};
    feather.inherits = feather.inherits || "Object";

    let model;
    let subscriptionId;
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
    let onChange = {};
    let onChanged = {};
    let onCopy = [];
    let onSave = [];
    let onSaved = [];
    let isFrozen = false;
    let naturalKey;
    let canCreate;
    let canUpdate;
    let canDelete;
    let saveContext;

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
    model = {
        data: {}
    };

    d = model.data;

    // ..........................................................
    // PUBLIC
    //

    /**
        Add a calculated property to "data."

        @method addCalculated
        @for Model
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
    model.addCalculated = function (options) {
        let fn = options.function;
        let alias = () => options.name.toProperCase();

        fn.alias = fn.alias || alias;
        fn.isCalculated = true;
        fn.isChild = simpleProp(false);
        fn.isParent = simpleProp(false);
        fn.key = options.name;
        fn.description = options.description || "";
        fn.type = options.type || "string";
        fn.format = options.format;
        fn.isRequired = simpleProp(false);
        fn.isReadOnly = simpleProp(options.isReadOnly !== false);
        fn.isToMany = isToMany.bind(null, fn);
        fn.isToOne = isToOne.bind(null, fn);
        fn.style = simpleProp(options.style || "");
        fn.title = simpleProp(options.title || "");
        d[options.name] = fn;

        if (typeof fn.type === "object") {
            fn.filter = f.prop({criteria: []});
        }

        return this;
    };

    /**
        Check whether model can be copied.

        @method canCopy
        @return {Boolean}
    */
    model.canCopy = function () {
        return (
            !feather.isReadOnly &&
            !model.parent() &&
            Boolean(model.naturalKey(true)) &&
            Boolean(canCreate) &&
            state.resolve(state.current()[0]).canCopy()
        );
    };

    /**
        Check whether changes in model can be saved in its
        current state.

        @method canSave
        @return {Boolean}
    */
    model.canSave = function () {
        return state.resolve(state.current()[0]).canSave();
    };

    /**
        Check whether model can undo changes in its current state.

        @method canUndo
        @return {Boolean}
    */
    model.canUndo = function () {
        return state.resolve(state.current()[0]).canUndo();
    };

    /**
        Check whether model can be updated according to
        authorization check.

        @method canUpdate
        @return {Boolean}
    */
    model.canUpdate = () => canUpdate;

    /**
        Check whether model can be deleted in its current state.

        @method canSave
        @return {Boolean}
    */
    model.canDelete = function () {
        return deleteChecks.every(function (check) {
            return check();
        });
    };

    /**
        Perform an authorization check whether a new model
        copy of this model can be created. The result of
        `canCopy` will be based on the response of this query.

        @method checkCreate
    */
    model.checkCreate = function () {
        if (canCreate === undefined) {
            catalog.isAuthorized({
                feather: feather.name,
                action: "canCreate"
            }).then(function (resp) {
                canCreate = resp;
            }).catch(doError);
        }
    };

    /**
        Perform an authorization check whether the model
        can be deleted form the server. The result of
        `canDelete` will be based on the response of this query.

        @method checkDelete
    */
    model.checkDelete = function () {
        if (canDelete === undefined) {
            model.onCanDelete(function () {
                return Boolean(canDelete);
            });

            catalog.isAuthorized({
                id: model.id(),
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
    model.checkUpdate = function () {
        let wasFrozen = model.isFrozen();

        if (canUpdate === undefined) {
            if (model.isReadOnly()) {
                canUpdate = false;
                return;
            }

            if (!wasFrozen) {
                doFreeze();
                catalog.isAuthorized({
                    id: model.id(),
                    action: "canUpdate"
                }).then(function (resp) {
                    if (model.isReadOnly()) {
                        canUpdate = false;
                        return;
                    }
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
        `/Ready/New` state.

        @method clear
    */
    model.clear = function () {
        state.send("clear");
    };

    /**
        Send event to copy data to a new record. It will only work
        in the `/Ready/Fetched/Clean` or `/Ready/Fetched/ReadyOnly`
        state on models that have a natural key defined. The natural
        key will be set to "Copy of " plus the source natural key value.
        If the model is autonumber the natural key will be blank.

        @method copy
        @return {Promise}
    */
    model.copy = function () {
        return doSend("copy");
    };

    /**
        Send event to delete the current object from the server.
        Returns a promise with a boolean passed back as the value.

        @method delete
        @param {Boolean} autoSave Automatically commit. Default false.
        @return {Promise}
    */
    model.delete = function (autoSave) {
        state.send("delete");
        if (autoSave) {
            return doSend("save");
        }
        return new Promise(function (resolve) {
            resolve(true);
        });
    };

    /**
        Return whether there is pre-processing set by `onSave` or
        or post-processing set by `onSaved`. Lists will save one by
        one rather than all at once if this is true.

        @method hasExtraProcessing
        @return {Boolean}
    */
    model.hasExtraProcessing = function () {
        return (onSave.length || onSaved.length);
    };


    /**
        Send event to fetch data based on the current id from the server.
        Returns a promise with model.data passed back as the value.

        @method fetch
        @return {Promise}
    */
    model.fetch = function () {
        return doSend("fetch");
    };

    /**
        Return the unique identifier value for the model.

        @method id
        @return {String}
    */
    model.id = function (...args) {
        let prop = model.idProperty();

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
    model.idProperty = simpleProp("id");

    /**
        Indicates if model is in  a frozen state.

        @method isFrozen
        @return {Boolen}
    */
    model.isFrozen = function () {
        return isFrozen;
    };

    /**
        Property that indicates object is a model instance.

        @property isModel
        @default true
        @type boolean
    */
    model.isModel = true;
    /**
        Indicates whether the model is loaded from the
        database with no edits.

        @method isReadyClean
        @return {Boolean}
    */
    model.isReadyClean = () => state.current()[0] === "/Ready/Fetched/Clean";
    /**
        Indicates whether the model is read only.

        @method isReadOnly
        @param {Boolean} isReadyOnly Read only flag
        @return {Boolean}
    */
    function isReadOnly(store) {
        return function (...args) {
            if (args.length) {
                store = args[0];
            }

            if (feather.isChild && !model.parent()) {
                return true;
            }

            return store;
        };
    }

    model.isReadOnly = isReadOnly(feather.isReadOnly);

    /**
        Returns whether the object is in a valid state to save.
        `lastError` value will be set by this if any are found.

        @method isValid
        @return {Boolean}
    */
    model.isValid = function () {
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
    model.lastError = function () {
        return lastError;
    };

    /**
        Lock record. To be applied when notification of locked status.
        Prevents other users from editing the record.

        @method lock
        @param {Object} object Lock object
        @return {Promise}
    */
    model.lock = function (lock) {
        state.send("lock", lock);
    };

    /**
        Feather name of model.

        @property name
        @type String
    */
    model.name = feather.name || "Object";

    /**
        Returns natural key property value. If `flag`
        is true, returns natural key property name.

        @method naturalKey
        @param {Boolean} [flag] return property name
        @return {String}
    */
    model.naturalKey = function (flag) {
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

        return (
            Boolean(flag)
            ? naturalKey
            : model.data[naturalKey]()
        );
    };

    /**
        Add a function that returns a boolean to execute when the
        `canDelete` function is called. The function should validate
        whether a record will be allowed to be deleted.

        @example
            let catalog = f.catalog();

            function contact(data, feather) {
                feather = feather || catalog.getFeather("Contact");
                let model = f.model(data, feather);

                function deleteCheck () => !model.data.isPosted();

                // Add a check
                model.onCanDelete(deleteCheck);
            }

        @method onCanDelete
        @param {Function} callback Test function
        @chainable
        @return {Object}
    */
    model.onCanDelete = function (callback) {
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
                let model = f.model(data, feather);

                // Add a change event to a property
                model.onChange("firstName", function (prop) {
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
    model.onChange = function (pName, pCallback) {
        let attr;
        let idx = pName.indexOf(".");

        function func() {
            pCallback(this);
        }

        if (idx > -1) {
            attr = pName.slice(0, idx);
            if (!onChange[attr]) {
                onChange[attr] = [];
            }
            onChange[attr].push({
                name: pName.slice(idx + 1),
                callback: pCallback
            });
            return this;
        }

        if (stateMap[pName]) {
            stateMap[pName].substateMap.Changing.enter(func.bind(d[pName]));
        }

        return this;
    };

    /**
        Add an event binding that will be triggered after a copy is executed.
        Use this function to reset or caclulate properties on the new copy.
        The callback passes in an object with an original copy of the data
        in case it is needed as a reference to update the copy.

        @method onCopy
        @param {Function} callback Callback function to call on change
        @chainable
        @return {Object}
    */
    model.onCopy = function (callback) {
        onCopy.push(callback);
        return model;
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
                let model = f.model(data, feather);

                // Add a changed event to a property
                model.onChanged("firstName", function (prop) {
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
    model.onChanged = function (pName, pCallback) {
        let attr;
        let idx = pName.indexOf(".");

        function func() {
            pCallback(this);
        }

        if (idx > -1) {
            attr = pName.slice(0, idx);
            if (!onChanged[attr]) {
                onChanged[attr] = [];
            }
            onChanged[attr].push({
                name: pName.slice(idx + 1),
                callback: pCallback
            });
            return this;
        }

        if (stateMap[pName]) {
            stateMap[pName].substateMap.Changing.exit(func.bind(d[pName]));
        }

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
                let model = f.model(data, shared);

                model.onValidate(function () {
                    if (model.data.phone().length <> 12) {
                        throw new Error("Phone number must be 12 characters");
                    }
                });

                // Add an error handler
                model.onError(function (err) {
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
    model.onError = function (callback) {
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
    model.onLoad = function (callback) {
        if (model.isReadOnly()) {
            model.state().resolve("/Ready/Fetched/ReadOnly").enter(callback);
        } else {
            model.state().resolve("/Ready/Fetched/Clean").enter(callback);
        }

        return this;
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
    model.onSave = function (callback, prepend) {
        if (prepend) {
            onSave.unshift(callback);
        } else {
            onSave.push(callback);
        }
        return model;
    };

    /**
        A function to call after executing save. A view model will be
        passed in similar to static functions that allow for working with
        interactive dialogs or other presentation related elements.

        The callback function should return a Promise. Note at this point
        the save will be committed, so this handles user interactions as
        post processing such as prompts to print or continue on to next steps.

        @method onSaved
        @param {Function} callback Callback function to call after save
        @chainable
        @return {Object}
    */
    model.onSaved = function (callback) {
        onSaved.push(callback);
        return model;
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
                let model = f.model(data, shared);

                model.onValidate(function () {
                    if (model.data.phone().length <> 12) {
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
    model.onValidate = function (callback) {
        validators.push(callback);

        return this;
    };

    /**
        Returns parent object if applicable.

        @method parent
        @return {Object}
    */
    model.parent = createProperty();

    /**
        Returns a path to execute server requests.

        @method path
        @param {String} name Name
        @param {String} [id] Id
        @return {String}
    */
    model.path = function (name, id) {
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
    model.plural = feather.plural;

    /**
        Send the save event to persist current data to the server.
        Only results in action in the "/Ready/Fetched/Dirty" and
        "/Ready/New" states.

        Returns a promise with model.data as the value.
        The `ViewModel` object is passed though to any
        callbacks created by `onSave` or `onSaved`.

        @method save
        @param {Object} [ViewModel]
        @return {Promise}
    */
    model.save = function (vm) {
        return doSend("save", vm);
    };

    /**
        Send an event to all properties.

        @method sendToProperties
        @param {String} str Event name.
        @chainable
        @return {Object}
    */
    model.sendToProperties = function (str) {
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
    model.set = function (data, silent, islastFetched) {
        data = data || {};
        let keys;
        let climateChange = islastFetched && model.isFrozen();

        if (typeof data === "object") {
            if (climateChange) {
                doThaw();
            }

            keys = Object.keys(data);

            // Silence events if applicable
            if (silent) {
                model.sendToProperties("silence");
            }

            // Loop through each attribute and assign
            keys.forEach(function (key) {
                if (typeof d[key] === "function") {
                    d[key](data[key]);
                }
            });

            model.sendToProperties("report");

            if (climateChange) {
                doFreeze();
            }
        }

        if (islastFetched) {
            lastFetched = model.toJSON();
        }

        return this;
    };

    /**
        Model statechart.

        @method state
        @param {Object} state Statechart
        @return {State}
    */
    model.state = function (...args) {
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
    model.style = simpleProp("");

    /**
        Subscribe or unsubscribe model to external events. If no flag
        passed and already subscribed, subscription id returned.

        @method subscribe
        @param {Boolean} Flag whether or not to subscribe to events.
        @return {Boolean | String} False or subscription id.
    */
    model.subscribe = function (...args) {
        let query;
        let url;
        let payload;
        let flag = args[0];

        // Children always subordinate to parent
        if (model.isChild) {
            return;
        }

        if (!args.length) {
            if (subscriptionId) {
                return subscriptionId;
            }
            return false;
        }

        if (flag) {
            subscriptionId = f.createId();

            query = Qs.stringify({
                id: model.id(),
                subscription: {
                    id: subscriptionId,
                    eventKey: catalog.eventKey()
                }
            });

            catalog.register("subscriptions", subscriptionId, [model]);

            url = "/do/subscribe/" + query;
            payload = {
                method: "POST",
                path: url,
                background: true
            };

            datasource.request(payload).catch(doError);
        } else if (flag === false && subscriptionId) {
            catalog.unregister("subscriptions", subscriptionId);

            // Let the server know we're unsubscribing
            query = {
                subscription: {
                    id: subscriptionId
                }
            };

            query = Qs.stringify(query);
            url = "/do/unsubscribe/" + query;
            payload = {
                method: "POST",
                path: url,
                background: true
            };

            datasource.request(payload).catch(doError);

            subscriptionId = undefined;
            return false;
        }
    };

    /**
        Serialize data to a simple JavaScript object.

        @method toJSON
        @return {Object}
    */
    model.toJSON = function () {
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
    model.undo = function () {
        state.send("undo");
    };

    /**
        Unlock record. To be applied when notification of unlocked status.

        @method unlock
        @return {Promise}
    */
    model.unlock = function () {
        state.send("unlock");
    };

    // ..........................................................
    // PRIVATE
    //

    function doCopy() {
        let nkey = model.naturalKey(true);
        let copy = f.copy(model.toJSON());
        let orig = f.copy(copy);
        let autonum = (
            Boolean(nkey)
            ? Boolean(feather.properties[nkey].autonumber)
            : false
        );

        purgeNoCopy(copy);

        if (autonum) {
            delete copy[nkey];
        } else {
            copy[nkey] = copy[nkey] + " (copy)";
        }

        model.clear();
        model.set(copy);
        onCopy.forEach((callback) => callback(orig));
    }

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

    doClear = function (context) {
        let keys = Object.keys(model.data);
        let values = {};

        // Bail if event that sent us here doesn't want to clear
        if (context && context.clear === false) {
            return;
        }

        // If first entry here with user data, clear for next time and bail
        if (data) {
            context.clear = false;
            lastFetched = data;
            data = undefined;
            return;
        }

        keys.forEach(function (key) {
            if (!model.data[key].isCalculated) {
                let value = model.data[key].default;

                values[key] = (
                    typeof value === "function"
                    ? value()
                    : value
                );
            }
        });

        model.set(values, true); // Uses silent option
    };

    doDelete = function (context) {
        let payload;

        function callback(result) {
            model.set(result, true, true);
            state.send("deleted");
            context.resolve(true);
        }

        payload = {
            method: "DELETE",
            path: (
                model.path(model.name, model.id()) +
                "?eventKey=" + catalog.eventKey()
            )
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
            path: model.path(model.name, model.id())
        };

        function callback(result) {
            model.set(result, true, true);
            state.send("fetched");
            if (result.lock) {
                model.lock(result.lock);
            }
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

            if (prop.isToMany() && !prop.isCalculated) {
                prop().forEach(function (item) {
                    item.state().goto("/Ready/Fetched/ReadOnly");
                });
                return;
            }

            if (prop.state) {
                prop.state().send("disable");
            }
        });

        isFrozen = true;
    };

    doLock = function () {
        let lock;
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
            id: model.id(),
            eventKey: catalog.eventKey()
        };

        payload = {
            method: "POST",
            path: "/do/lock",
            body: lock
        };

        datasource.request(payload).then(callback).catch(error);
    };

    doUnlock = function () {
        let unlock;
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
            id: model.id(),
            eventKey: catalog.eventKey()
        };

        payload = {
            method: "POST",
            path: "/do/unlock",
            body: unlock
        };

        datasource.request(payload).then(callback).catch(error);
    };

    doPatch = function (context) {
        let patch;
        function callback(result) {
            // Update to sent changes
            jsonpatch.applyPatch(lastFetched, patch);
            // Strip away inapplicable changes in case
            // this is not a fully loaded instance
            result = result.filter(function (i) {
                let attr = i.path.substr(1);
                let idx = attr.indexOf("/");
                if (idx !== -1) {
                    attr = attr.substr(0, idx);
                }
                return Boolean(d[attr]);
            });
            // Update server side changes
            jsonpatch.applyPatch(lastFetched, result);
            model.set(lastFetched, true);
            state.send("fetched");
            context.resolve(d);
        }

        if (model.isValid()) {
            doPreProcess(context.viewModel).then(function () {
                patch = jsonpatch.compare(lastFetched, model.toJSON());
                if (!patch.length) {
                    doUnlock();
                    return Promise.resolve([]);
                }
                return datasource.request({
                    method: "PATCH",
                    path: (
                        model.path(model.name, model.id()) +
                        "?eventKey=" + catalog.eventKey()
                    ),
                    body: patch
                });
            }).then(
                callback
            ).then(
                doPostProcess.bind(null, context.viewModel)
            ).catch(
                doError.bind(context)
            );
        }
    };

    doPost = function (context) {
        let cache = model.toJSON();
        let bdata = model.toJSON();
        let payload = {
            method: "POST",
            path: model.path(model.name),
            body: bdata
        };

        function callback(result) {
            jsonpatch.applyPatch(cache, result);
            model.set(cache, true, true);
            state.send("fetched");
            context.resolve(d);
        }

        // Trim extraneous relation data
        Object.keys(bdata).forEach(function (key) {
            let prop = feather.properties[key];
            if (
                typeof prop.type === "object" &&
                !prop.type.parentOf &&
                !prop.type.childOf &&
                !prop.type.isChild &&
                bdata[key]
            ) {
                bdata[key] = {
                    id: bdata[key].id
                };
            }
        });

        if (model.isValid()) {
            doPreProcess(context.viewModel).then(
                datasource.request.bind(null, payload)
            ).then(
                callback
            ).then(
                doPostProcess.bind(null, context.viewModel)
            ).catch(
                doError.bind(context)
            );
        }
    };

    doRevert = function () {
        model.set(lastFetched, true);
    };

    doSend = function (evt, vm) {
        return new Promise(function (pResolve, pReject) {
            state.send(evt, {
                resolve: pResolve,
                reject: pReject,
                viewModel: vm
            });
        });
    };

    doThaw = function () {
        let keys = Object.keys(d);

        // Return read only props to previous state
        keys.forEach(function (key) {
            let prop = d[key];

            if (prop.isToMany() && !prop.isCalculated) {
                prop().forEach(function (item) {
                    item.state().goto("/Ready/Fetched/Clean");
                });
            }

            if (prop.state) {
                prop.state().send("enable");
            }
        });

        isFrozen = false;
    };

    doInit = function (data) {
        let props = feather.properties;
        let overloads = feather.overloads;
        let keys;

        if (!props.objectType) {
            props.objectType = {
                type: "string",
                isReadOnly: true,
                isAlwaysLoad: true
            };
        }
        keys = Object.keys(props || {});

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
            let alias = overload.alias || props[key].alias || key.toName();
            let p = props[key];
            let min = p.min;
            let max = p.max;
            let type = p.type;
            let value = data[key];
            let formatter = {};
            let isAutoNumber = overload.autonumber || p.autonumber;

            p.default = overload.default || p.default;

            // Create properties for relations
            if (typeof p.type === "object") {
                if (isChild(p)) {
                    model.isChild = true;
                    if (
                        !p.type.properties || !p.type.properties.length
                    ) {
                        return;
                    } // Ignore child properties on client level
                }

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
                            result = createModel(value, cFeather);
                        // Get regular model
                        } else {
                            result = catalog.store().models()[name]();
                            result.set(value, true, true);
                        }

                        // Synchronize statechart
                        state.resolve("/Busy/Fetching").enter(
                            onFetching.bind(result, null)
                        );
                        state.resolve("/Ready/Fetched").enter(
                            onFetched.bind(result, null)
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

                        // More child case handling
                        if (result.isChild) {
                            result.parent(model);
                            // No locking
                            result.state().resolve(
                                "/Ready/Fetched/Clean"
                            ).event("changed", function () {
                                result.state().goto("/Ready/Fetched/Dirty");
                            });
                        }

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
                    prop = createProperty(value, formatter);

                    // Enable ability to pre-filter results
                    prop.filter = createProperty({
                        sort: [],
                        criteria: []
                    });

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
                    prop = createProperty(cArray, formatter);
                    extendArray(model, prop, name, onChange, onChanged);
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
                        f.formats()[p.format]
                        ? f.formats()[p.format].toType
                        : f.types[p.type].toType
                    );

                    formatter.toType = function (value) {
                        let result = toType(value);

                        return result.round(scale);
                    };
                    formatter.default = 0;
                } else {
                    formatter = (
                        f.formats()[p.format] ||
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
                prop = createProperty(value, formatter);
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
            prop.isRequired(p.isRequired && !isAutoNumber);
            prop.isReadOnly(p.isReadOnly || isAutoNumber);
            prop.isCalculated = false;
            prop.alias(alias);
            prop.dataList = overload.dataList || p.dataList;
            prop.min = min;
            prop.max = max;
            prop.style = simpleProp("");

            // Add state to map for event helper functions
            stateMap[key] = prop.state();

            // Report property changed event up to model
            model.onChanged(key, function () {
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
            this.event("fetch", function (pContext) {
                this.goto("/Busy", {
                    context: pContext
                });
            });

            this.state("New", function () {
                this.enter(doClear);
                this.event("clear", function () {
                    this.goto("/Ready/New", {
                        force: true
                    });
                });
                this.event("save", function (pContext) {
                    this.goto("/Busy/Saving", {
                        context: pContext
                    });
                });
                this.event("delete", function () {
                    this.goto("/Deleted");
                });
                this.event("fetched", function () {
                    this.goto("/Ready/Fetched/Clean");
                });
                this.canCopy = () => false;
                this.canDelete = () => true;
                this.canSave = model.isValid;
                this.canUndo = () => false;
            });

            this.state("Fetched", function () {
                this.c = this.C; // Squelch jslint complaint
                this.c(function () {
                    if (
                        model.isReadOnly() ||
                        (
                            model.isChild &&
                            !model.parent()
                        )
                    ) {
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
                    this.event("copy", doCopy);
                    this.event("lock", function (lock) {
                        this.goto("../../../Locked", {
                            context: lock
                        });
                    });
                    this.event("freeze", function (lock) {
                        this.goto("../ReadOnly", {
                            context: lock
                        });
                    });
                    this.canCopy = () => true;
                    this.canDelete = () => true;
                    this.canSave = () => false;
                    this.canUndo = () => false;
                });
                this.state("ReadOnly", function () {
                    this.enter(function () {
                        model.isReadOnly(true);
                        doFreeze();
                    });
                    this.exit(function () {
                        model.isReadOnly(false);
                        doThaw();
                    });
                    this.event("copy", doCopy);
                    this.canCopy = () => true;
                    this.canDelete = () => false;
                    this.canSave = () => false;
                    this.canUndo = () => false;
                });

                this.state("Locking", function () {
                    this.enter(doLock);
                    this.event("locked", function (pContext) {
                        if (pContext && pContext.lock) {
                            d.lock(pContext.lock);
                        }
                        this.goto("../Dirty");
                    });
                    this.event("save", function (context) {
                        saveContext = context;
                    });
                    this.canCopy = () => false;
                    this.canDelete = () => false;
                    this.canSave = () => false;
                    this.canUndo = () => true;
                });

                this.state("Unlocking", function () {
                    this.enter(doUnlock);
                    this.event("unlocked", function () {
                        this.goto("../Clean");
                    });
                    this.canCopy = () => false;
                    this.canDelete = () => false;
                    this.canSave = () => false;
                    this.canUndo = () => false;
                });

                this.state("Dirty", function () {
                    this.enter(function () {
                        let ctxt = {context: saveContext};
                        if (saveContext) {
                            saveContext = undefined;
                            this.goto("/Busy/Saving/Patching", ctxt);
                        }
                    });
                    this.event("undo", function () {
                        doRevert();
                        this.goto("../Unlocking");
                    });
                    this.event("save", function (pContext) {
                        this.goto("/Busy/Saving/Patching", {
                            context: pContext
                        });
                    });
                    this.canCopy = () => false;
                    this.canDelete = () => false;
                    this.canSave = model.isValid;
                    this.canUndo = () => true;
                });
            });
        });

        this.state("Busy", function () {
            this.state("Fetching", function () {
                this.enter(doFetch);
                this.canCopy = () => false;
                this.canDelete = () => false;
                this.canSave = () => false;
                this.canUndo = () => false;
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
                    this.canCopy = () => false;
                    this.canDelete = () => false;
                    this.canSave = () => false;
                    this.canUndo = () => false;
                });
                this.state("Patching", function () {
                    this.enter(doPatch);
                    this.canCopy = () => false;
                    this.canDelete = () => false;
                    this.canSave = () => false;
                    this.canUndo = () => false;
                });
                this.canCopy = () => false;
                this.canDelete = () => false;
                this.canSave = () => false;
                this.canUndo = () => false;
            });
            this.state("Deleting", function () {
                this.enter(doDelete);

                this.event("deleted", function () {
                    this.goto("/Deleted");
                });
                this.canCopy = () => false;
                this.canDelete = () => false;
                this.canSave = () => false;
                this.canUndo = () => false;
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
            this.enter(function (pContext) {
                if (pContext) {
                    d.lock(pContext);
                }
                doFreeze();
            });

            this.event("unlock", function () {
                doThaw();
                d.lock(null);
                this.goto("/Ready");
            });
            this.event("copy", doCopy);

            this.canCopy = () => true;
            this.canDelete = () => false;
            this.canSave = () => false;
            this.canUndo = () => false;
        });

        this.state("Delete", function () {
            this.enter(doLock);
            this.enter(doFreeze);

            this.event("save", function (pContext) {
                this.goto("/Busy/Deleting", {
                    context: pContext
                });
            });

            this.event("undo", function () {
                doUnlock();
            });
            this.event("unlocked", function () {
                doThaw();
                this.goto("/Ready");
            });
            this.canCopy = () => false;
            this.canDelete = () => false;
            this.canSave = () => false;
            this.canUndo = () => true;
        });

        this.state("Deleted", function () {
            this.event("clear", function () {
                this.goto("/Ready/New");
            });
            this.canCopy = () => false;
            this.canDelete = () => false;
            this.canSave = () => false;
            this.canUndo = () => false;
        });

        this.state("Deleting", function () {
            this.enter(doDelete);

            this.event("deleted", function () {
                this.goto("/Deleted");
            });
            this.canCopy = () => false;
            this.canDelete = () => false;
            this.canSave = () => false;
            this.canUndo = () => false;
        });
    });

    // Add standard validator that checks required properties
    // and validates children
    model.onValidate(function () {
        let keys = Object.keys(d);

        function validate(key) {
            let prop = d[key];
            let val;
            let name = prop.alias();

            // Validate required property
            if (prop.isRequired()) {
                val = prop();
                if (val === null || (
                    prop.type === "string" && !val
                )) {
                    throw "\"" + name + "\" is required";
                }
            }

            // Validate min/max
            if (prop.type === "number" || prop.type === "integer") {
                val = prop();
                if (val !== null && prop.max && val > prop.max) {
                    throw "Maximum value for \"" + name + "\" is " + prop.max;
                }

                if (val !== null && prop.min !== undefined && val < prop.min) {
                    throw "Minimum value for \"" + name + "\" is " + prop.min;
                }
            }

            // Recursively validate children
            if (prop.isToMany() && !prop.isCalculated && prop().length) {
                prop().forEach(function (child) {
                    if (!child.isValid()) {
                        throw child.lastError();
                    }
                });
            }
        }

        // Validate all extant properties
        keys.forEach(validate);
    });

    // Add standard check for 'canDelete'
    model.onCanDelete(function () {
        return (
            !model.isReadOnly() &&
            state.resolve(state.current()[0]).canDelete()
        );
    });

    // Initialize
    state.goto({
        context: {}
    });

    return model;

}

createModel.static = simpleProp({});

export default Object.freeze(createModel);

/**
    @class Object
    @static
    @namespace Models
    @extends Model
*/
/**
    Surrogate key.

    __Type:__ `String`

    @property data.id
    @type Property
*/

/**
    Create time of the record.

    __Type:__ `String`

    __Format:__ `DateTime`

    __Read Only__

    @property data.created
    @type Property
*/

/**
    User who created the record.

    __Type:__ `String`

    __Read Only__

    @property data.createdBy
    @type Property
*/

/**
    Flag whether object is soft deleted.

    __Type:__ `Boolean`

    __Read Only__

    @property data.isDeleted
    @type Property
*/

/**
    Flag whether object is soft deleted.

    __Type:__ `Object`

    __Read Only__

    @property data.lock
    @type Property
*/

/**
    Discriminates which inherited object type the object represents

    __Type:__ `String`

    __Read Only__

    @property data.objectType
    @type Property
*/

/**
    Last time the record was updated.

    __Type:__ `String`

    __Format:__ `DateTime`

    __Read Only__

    @property data.updated
    @type Property
*/

/**
    User who last updated the record.

    __Type:__   `String`

    __Read Only__

    @property data.updatedBy
    @type Property
*/