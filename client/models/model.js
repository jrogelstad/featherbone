/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstaddo

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
/*global require, module*/
/*jslint this, es6*/
(function () {
    "use strict";

    var model, isChild, isToOne, isToMany,
            f = require("common-core"),
            stream = require("stream"),
            catalog = require("catalog"),
            dataSource = require("datasource"),
            jsonpatch = require("fast-json-patch"),
            statechart = require("statechartjs"),
            qs = require("Qs"),
            store = catalog.store();

    /**
      A factory that returns a persisting object based on a definition called a
      `feather`. Can be extended by modifying the return object directly.

      @param {Object} Default data
      @param {Object} Feather
      @param {Array} [feather.name] the class name of the object
      @param {Array} [feather.properties] the properties to set on the data object
      return {Object}
    */
    model = function (data, feather) {
        data = data || {};
        feather = feather || {};
        feather.overloads = feather.overloads || {};
        feather.inherits = feather.inherits || "Object";

        var that, subcriptionId, d, doClear, doDelete, doError, doFetch, doInit, doPatch, doPost,
                doSend, doFreeze, doThaw, doRevert, doLock, doUnlock, lastError, state, superclass,
                errHandlers = [],
                validators = [],
                deleteChecks = [],
                stateMap = {},
                lastFetched = {},
                freezeCache = {},
                onChange = {},
                onChanged = {},
                isFrozen = false;

        that = {
            data: {}
        };

        d = that.data;

        // Inherit parent logic via traversal
        if (feather.inherits && feather.inherits !== "Object") {
            superclass = catalog.getFeather(feather.inherits);
            feather.inherits = superclass.inherits || "Object";
            return store.models()[superclass.name.toCamelCase()](data, feather);
        }

        // ..........................................................
        // PUBLIC
        //

        /**
          Add a calculated property to "data."

          @param {Object} Options
          @param {String} [options.name] Name (required)
          @param {String} [options.description] Description
          @param {Function} [options.function] Function (required)
          @param {String} [options.type] Return type (default "string")
          @param {String} [options.format] Return format
          @param {Boolean} [options.isReadOnly] Read only (default true)
          @returns Receiver
        */
        that.addCalculated = function (options) {
            var fn = options.function;

            fn.isCalculated = true;
            fn.isChild = stream(false);
            fn.isParent = stream(false);
            fn.key = options.name;
            fn.description = options.description || "";
            fn.type = options.type || "string";
            fn.format = options.format;
            fn.isRequired = stream(false);
            fn.isReadOnly = stream(options.isReadOnly || false);
            fn.isToMany = stream(false);
            fn.isToOne = stream(false);
            d[options.name] = fn;

            return this;
        };

        that.canSave = function () {
            return state.resolve(state.current()[0]).canSave();
        };

        that.canUndo = function () {
            return state.resolve(state.current()[0]).canUndo();
        };

        that.canDelete = function () {
            return deleteChecks.every(function (check) {
                return check();
            });
        };

        /**
          Send event to clear properties on the object and set it to
          "/Ready/New" state.
        */
        that.clear = function () {
            state.send("clear");
        };

        /**
          Send event to delete the current object from the server.
          Returns a promise with a boolean passed back as the value.

          @param {Boolean} Automatically commit. Default false.
          @returns {Object} promise
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

        /*
          Send event to fetch data based on the current id from the server.
          Returns a promise with model.data passed back as the value.
          @returns {Object} promise
        */
        that.fetch = function () {
            return doSend("fetch");
        };

        /**
          Return the unique identifier value for the model.

          @returns {String}
        */
        that.id = function (...args) {
            var prop = that.idProperty();
            if (args.length) {
                return d[prop](args[0]);
            }
            return d[prop]();
        };

        /**
          The data property that is the unique identifier for the model.
          Default is "id".

          @param {String}
          @returns {String}
        */
        that.idProperty = stream("id");

        /**
          Indicates if model is in  a frozen state.

          @returns {Boolen}
        */
        that.isFrozen = function () {
            return isFrozen;
        };

        /**
          Property that indicates object is a model (i.e. class).
        */
        that.isModel = true;

        /**
          Indicates whether the model is read only.

          @returns {Boolean}
        */
        that.isReadOnly = stream(feather.isReadOnly === true);

        /**
          Returns whether the object is in a valid state to save.
          @returns {Boolean}
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
          @return {String}
        */
        that.lastError = function () {
            return lastError;
        };

        /**
          Lock record. To be applied when notification of locked status.

          @seealso Unlock
          @return Promise
        */
        that.lock = function (lock) {
            state.send("lock", lock);
        };

        /**
          Feather name of model.
        */
        that.name = feather.name || "Object";

        /**
          Add a function that returns a boolean to execute when the
          `canDelete` function is called. The function should validate
          whether a record will be allowed to be deleted.

            var contact,
              catalog = require("catalog"),
              model = require("model");

            transaction = function (data, feather) {
              var shared = feather || catalog.getFeather("Transaction"),
                that = model(data, shared),
                deleteCheck function () {
                  return !that.data.isPosted())
                };
              // Add a check
              that.oncanDelete(deleteCheck);
            }
          @seealso canDelete
          @param {Function} Test function to execute when running canDelete
          @return Reciever
        */
        that.onCanDelete = function (callback) {
            deleteChecks.push(callback);

            return this;
        };

        /**
          Add an event binding to a property that will be triggered before a
          property change. Pass a callback in and the property will be passed
          to the callback. The property will be passed to the callback as the
          first argument.

            var contact,
              catalog = require("catalog"),
              model = require("model");

            contact = function (data, feather) {
              var shared = feather || catalog.getFeather("Contact"),
                that = model(data, shared);
              // Add a change event to a property
              that.onChange("first", function (prop) {
                console.log("First name changing from " +
                  (prop.oldValue() || "nothing") + " to " + prop.newValue() + "!");
              });
            }
          @param {String} Property name to call on cahnge
          @param {Function} Callback function to call on change
          @return Reciever
        */
        that.onChange = function (name, callback) {
            var attr,
                idx = name.indexOf(".");

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
          Add an event binding to a property that will be triggered after a property
          change. Pass a callback in and the property will be passed to the
          callback. The property will be passed to the callback as the first
          argument.
            var contact,
              catalog = require("catalog"),
              model = require("model");

            contact = function (data, feather) {
              var shared = feather || catalog.getFeather("Contact"),
                that = model(data, shared);
              // Add a changed event to a property
              that.onChanged("first", function (prop) {
                console.log("First name is now " + prop() + "!");
              });
            }
          @param {String} Property name to call on cahnge
          @param {Function} Callback function to call on change
          @return Reciever
        */
        that.onChanged = function (name, callback) {
            var attr,
                idx = name.indexOf(".");

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
            var contact,
              catalog = require("catalog"),
              model = require("model");

            contact = function (data, feather) {
              var shared = feather || catalog.getFeather("Contact"),
                that = model(data, shared);
              // Add an error handler
              that.onError(function (err) {
                console.log("Error->", err);
              });
            }
          @param {Function} Callback to execute on error
          @return Reciever
        */
        that.onError = function (callback) {
            errHandlers.push(callback);

            return this;
        };

        /**
          Add a validator to execute when the `isValid` function is
          called, which is also called after saving events. Errors thrown
          by the validator will be caught and passed through `onError`
          callback(s). The most recent error may also be access via
          `lastError`.

            var contact,
              catalog = require("catalog"),
              model = require("model");

            contact = function (data, feather) {
              var shared = feather || catalog.getFeather("Contact"),
                that = model(data, shared),
                validator function () {
                  if (!that.data.first()) {
                    throw "First name must not be empty.";
                  }
                };
              // Add a validator
              that.onValidate(validator);
            }
          @seealso isValid
          @seealso onError
          @param {Function} Callback to execute when validating
          @return Reciever
        */
        that.onValidate = function (callback) {
            validators.push(callback);

            return this;
        };

        /**
          Overload properties. Supported overloads are alias and type.
          Can be used by the user interface to apply a more specific name or
          type mask.

            model.overload({
              name: {
                alias: "job"
              },
              kind: {
                alias: "product",
                type: {
                  relation: "Product",
                  "properties": ["code", "description", "kind"]
                }
              }
            });

          @param {Object} Overload definition
          @returns Receiver
        */
        that.overload = function (overloads) {
            if (!overloads) {
                return that;
            }

            var keys = Object.keys(overloads);

            keys.forEach(function (key) {
                var overload = overloads[key],
                    prop = d[key];

                // Update the feather
                feather.overloads[key] = overload;

                // Update alias property
                if (overload.alias) {
                    prop.alias(overload.alias.toName());
                }

                // Update alias type
                if (overload.type) {
                    prop.type = overload.type;
                }
            });

            return that;
        };

        /**
          Returns parent object if applicable.
        */
        that.parent = f.prop();

        /**
          Returns a path to execute server requests.

          @param {String} Name
          @param {String} Id (Optional)
          @returns {String}
        */
        that.path = function (name, id) {
            var ret = "/data/" + name.toSpinalCase();
            if (id) {
                ret += "/" + id;
            }
            return ret;
        };

        /**
            Plural name of feather.
        */
        that.plural = feather.plural;

        /**
          Send the save event to persist current data to the server.
          Only results in action in the "/Ready/Fetched/Dirty" and
          "/Ready/New" states.
          Returns a promise with model.data as the value.
          @return {Object} promise
        */
        that.save = function () {
            return doSend("save");
        };

        /**
          Send an event to all properties.
          @param {String} event name.
          @returns receiver
        */
        that.sendToProperties = function (str) {
            var keys = Object.keys(d);

            keys.forEach(function (key) {
                if (d[key].state) {
                    d[key].state().send(str);
                }
            });

            return this;
        };

        /**
          Set properties to the values of a passed object
          @param {Object} Data to set
          @param {Boolean} Silence change events
          @returns reciever
        */
        that.set = function (data, silent, islastFetched) {
            data = data || {};
            var keys,
                climateChange = islastFetched && that.isFrozen();

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

        that.state = function (...args) {
            if (args.length) {
                state = args[0];
            }

            return state;
        };

        /**
          Subscribe or unsubscribe model to external events. If no flag
          passed and already subscribed, subscription id returned.

          @param {Boolean} Flag whether or not to subscribe to events.
          @returns {Boolean | String} False or subscription id.
        */
        that.subscribe = function (...args) {
            var query, url, payload,
                    flag = args[0];

            if (!args.length) {
                if (subcriptionId) {
                    return subcriptionId;
                }
                return false;
            }

            if (flag) {
                subcriptionId = f.createId();

                query = qs.stringify({
                    id: that.id(),
                    subscription: {
                        id: subcriptionId,
                        sessionId: catalog.sessionId()
                    }
                });

                catalog.register("subscriptions", subcriptionId, [that]);

                url = "/do/subscribe/" + query;
                payload = {
                    method: "POST",
                    path: url
                };

                dataSource.request(payload)
                    .catch(doError);
            } else if (flag === false && subcriptionId) {
                catalog.unregister("subscriptions", subcriptionId);

                // Let the server know we're unsubscribing
                query = {
                    subscription: {
                        id: subcriptionId
                    }
                };

                query = qs.stringify(query);
                url = "/do/unsubscribe/" + query;
                payload = {
                    method: "POST",
                    path: url
                };

                dataSource.request(payload)
                    .catch(doError);

                subcriptionId = undefined;
                return false;
            }
        };

        that.toJSON = function () {
            var keys = Object.keys(d),
                result = {};

            keys.forEach(function (key) {
                if (!d[key].isCalculated) {
                    result[key] = d[key].toJSON();
                }
            });

            return result;
        };

        that.undo = function () {
            state.send("undo");
        };

        /**
          Unlock record. To be applied when notification of unlocked status.

          @seealso Lock
          @return Promise
        */
        that.unlock = function () {
            state.send("unlock");
        };

        // ..........................................................
        // PRIVATE
        //

        doClear = function (context) {
            var keys = Object.keys(that.data),
                values = {};

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
                var value = that.data[key].default;

                values[key] = typeof value === "function"
                    ? value()
                    : value;
            });

            that.set(values, true); // Uses silent option
        };

        doDelete = function (context) {
            var payload;

            function callback(result) {
                that.set(result, true, true);
                state.send('deleted');
                context.resolve(true);
            }

            payload = {
                method: "DELETE",
                path: that.path(that.name, that.id()),
                data: {
                    sessionId: catalog.sessionId()
                }
            };

            dataSource.request(payload)
                .then(callback)
                .catch(doError.bind(context));
        };

        doError = function (err) {
            if (err.message && err.message.slice(0, 1) === '"') {
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
            var payload = {
                method: "GET",
                path: that.path(that.name, that.id())
            };

            function callback(result) {
                that.set(result, true, true);
                state.send('fetched');
                context.resolve(d);
            }

            dataSource.request(payload)
                .then(callback)
                .catch(doError.bind(context));
        };

        doFreeze = function () {
            var keys = Object.keys(d);

            // Make all props read only, but remember previous state
            keys.forEach(function (key) {
                var prop = d[key],
                    value = prop();

                if (Array.isArray(value) && value.model) {
                    value.forEach(function (item) {
                        item.state().goto("/Ready/Fetched/ReadOnly");
                    });
                    return;
                }

                if (prop.state) {
                    freezeCache[key] = {};
                    freezeCache[key].isReadOnly = prop.isReadOnly();
                    prop.isReadOnly(true);
                    if (prop.state().current()[0] !== "/Disabled") {
                        prop.state().send("disable");
                        prop.isDisabled = true;
                    }
                }
            });

            isFrozen = true;
        };

        doLock = function () {
            var lock, query, payload;

            function callback() {
                lock = {
                    username: f.getCurrentUser(),
                    created: f.now()
                };
                state.send('locked', {
                    context: lock
                });
            }

            function error(err) {
                doError(err);
                state.send('clean');
            }

            lock = {
                id: that.id(),
                username: f.getCurrentUser(),
                sessionId: catalog.sessionId()
            };
            query = qs.stringify(lock);
            payload = {
                method: "POST",
                path: "/do/lock/" + query
            };

            dataSource.request(payload)
                .then(callback)
                .catch(error);
        };

        doUnlock = function () {
            var unlock, query, payload;

            function callback() {
                d.lock(null);
                state.send('unlocked');
            }

            function error(err) {
                doError(err);
                state.send('error');
            }

            unlock = {
                id: that.id(),
                username: f.getCurrentUser()
            };
            query = qs.stringify(unlock);
            payload = {
                method: "POST",
                path: "/do/unlock/" + query
            };

            dataSource.request(payload)
                .then(callback)
                .catch(error);
        };

        doPatch = function (context) {
            var patch = jsonpatch.compare(lastFetched, that.toJSON()),
                payload = {
                    method: "PATCH",
                    path: that.path(that.name, that.id()),
                    data: {
                        data: patch
                    }
                },
                callback = function (result) {
                    jsonpatch.apply(lastFetched, patch); // Update to sent changes
                    jsonpatch.apply(lastFetched, result); // Update server side changes
                    that.set(lastFetched, true);
                    state.send('fetched');
                    context.resolve(d);
                };

            if (that.isValid()) {
                dataSource.request(payload)
                    .then(callback)
                    .catch(doError.bind(context));
            }
        };

        doPost = function (context) {
            var cache = that.toJSON(),
                payload = {
                    method: "POST",
                    path: that.path(that.plural),
                    data: {
                        data: cache
                    }
                },
                callback = function (result) {
                    jsonpatch.apply(cache, result);
                    that.set(cache, true, true);
                    state.send('fetched');
                    context.resolve(d);
                };

            if (that.isValid()) {
                dataSource.request(payload)
                    .then(callback)
                    .catch(doError.bind(context));
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
            var keys = Object.keys(d);

            // Return read only props to previous state
            keys.forEach(function (key) {
                var prop = d[key],
                    value = prop();

                if (Array.isArray(value) && value.model) {
                    value.forEach(function (item) {
                        item.state().goto("/Ready/Fetched/Clean");
                    });
                    return;
                }

                if (prop.state) {
                    prop.state().send("enable");
                    prop.isReadOnly(freezeCache[key].isReadOnly);
                    if (freezeCache[key].isDisabled) {
                        prop.state().send("enable");
                    }
                }
            });

            freezeCache = {};
            isFrozen = false;
        };

        doInit = function () {
            var onFetching, onFetched, extendArray,
                    props = feather.properties,
                    overloads = feather.overloads,
                    keys = Object.keys(props || {}),
                    initData = this;

            onFetching = function () {
                this.state().goto("/Busy/Fetching");
            };
            onFetched = function () {
                this.state().goto("/Ready/Fetched");
            };

            // Function to extend child array if applicable
            extendArray = function (prop, name, overloads) {
                overloads = overloads || {};

                var isNew = true,
                    cache = [],
                    ary = prop();

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
                    var result;

                    prop.state().send("change");
                    if (value && value.isModel) {
                        result = value;
                    } else {
                        // Create an instance
                        result = catalog.store().models()[name]();
                        result.set(value, true, true);
                    }

                    result.parent(that);

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

                    // Carry overloads set at parent on down
                    result.overload(overloads);

                    // Synchronize statechart
                    state.resolve("/Busy/Fetching").enter(onFetching.bind(result));
                    state.resolve("/Ready/Fetched").enter(onFetched.bind(result));

                    // Remove original enter response on child
                    result.state().resolve("/Busy/Fetching").enters.shift();
                    result.state().resolve("/Ready/Fetched/Locking").enters.shift();

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
                        state.send("changed");
                    });

                    // Notify parent properties changed
                    ary.push(result);
                    cache.push(result);
                    prop.state().send("changed");

                    return result;
                };

                ary.clear = function () {
                    prop.state().send("change");
                    ary.length = 0;
                    cache.length = 0;
                    prop.state().send("changed");
                };

                ary.remove = function (value) {
                    var result, idx, find;

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
                        state.send("changed");
                    }

                    return result;
                };

                ary.toJSON = function () {
                    var item, value, isNotDeleting,
                            result = [],
                            len = cache.length,
                            i = 0;

                    while (i < len) {
                        item = cache[i];
                        isNotDeleting = item.state().current()[0] !== "/Delete";
                        value = isNotDeleting
                            ? item.toJSON()
                            : undefined;
                        result.push(value);
                        i += 1;
                    }

                    return result;
                };
            };

            // Loop through each model property and instantiate a data property
            keys.forEach(function (key) {
                var prop, defaultValue, name, cFeather, cKeys, cArray, relation,
                        toType, scale, handleDefault,
                        overload = overloads[key] || {},
                        alias = overload.alias || props[key].alias || key,
                        p = props[key],
                        type = p.type,
                        value = initData[key],
                        formatter = {};

                alias = alias.toName();

                handleDefault = function (prop, frmt) {
                    if (!prop.default && !frmt) {
                        return;
                    }
                    frmt = frmt || {};
                    var def;

                    // Handle default
                    if (prop.default !== undefined) {
                        def = prop.default;
                    } else if (typeof frmt.default === "function") {
                        def = frmt.default();
                    } else {
                        def = frmt.default;
                    }

                    // Handle default that is a function
                    if (typeof def === "string" &&
                            def.match(/\(\)$/)) {
                        def = f[def.replace(/\(\)$/, "")];
                    }

                    return def;
                };

                // Create properties for relations
                if (typeof p.type === "object") {
                    if (isChild(p)) {
                        return;
                    } // Ignore child properties on client level

                    relation = type.relation;
                    name = relation.toCamelCase();

                    if (isToOne(p)) {

                        // Need to to make sure transform knows to ignore inapplicable props
                        if (type.properties && type.properties.length) {
                            cFeather = f.copy(catalog.getFeather(relation));
                            cKeys = Object.keys(cFeather.properties);
                            cKeys.forEach(function (key) {
                                if (type.properties.indexOf(key) === -1 && key !== "id") {
                                    delete cFeather.properties[key];
                                }
                            });
                        }

                        // Create a model instance if not already
                        formatter.toType = function (value) {
                            var result;

                            if (value === undefined || value === null) {
                                return null;
                            }
                            if (value && value.isModel) {
                                value = value.toJSON();
                            }
                            result = catalog.store().models()[name]({}, cFeather);
                            result.set(value, true, true);

                            // Synchronize statechart
                            state.resolve("/Busy/Fetching").enter(onFetching.bind(result));
                            state.resolve("/Ready/Fetched").enter(onFetched.bind(result));

                            // Remove original do fetch event on child
                            result.state().resolve("/Busy/Fetching").enters.shift();

                            // Disable save event on children
                            result.state().resolve("/Ready/New").event("save");
                            result.state().resolve("/Ready/Fetched/Dirty").event("save");

                            return result;
                        };

                        defaultValue = handleDefault(p);
                        if (value === undefined) {
                            value = typeof defaultValue === "function"
                                ? defaultValue()
                                : defaultValue;
                        }

                        // Create property
                        prop = f.prop(value, formatter);

                        // Define format for to-many
                    } else if (isToMany(p)) {
                        cArray = [];

                        // Create an instance for each relation if not already
                        formatter.toType = function (value) {
                            value = value || [];

                            if (!Array.isArray(value)) {
                                throw "Value assignment for " + key + " must be an array.";
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
                        extendArray(prop, name, overload);
                        prop(value);
                    }

                    // Resolve formatter to standard type
                } else {
                    formatter = f.formats[p.format] || f.types[p.type] || {};

                    if (p.type === "number") {
                        scale = p.scale === undefined
                            ? f.SCALE_DEFAULT
                            : p.scale;
                        toType = formatter.toType;
                        formatter.fromType = function (value) {
                            return value.toLocaleString(undefined, {
                                maximumFractionDigits: scale
                            });
                        };
                        formatter.toType = function (value) {
                            var result = toType(value);
                            return f.round(result, scale);
                        };
                    }

                    defaultValue = handleDefault(p, formatter);

                    if (value === undefined) {
                        value = typeof defaultValue === "function"
                            ? defaultValue()
                            : defaultValue;
                    }

                    // Create property
                    prop = f.prop(value, formatter);
                }

                // Carry other property definitions forward
                prop.key = key; // Use of 'name' property is not allowed here
                prop.description = props[key].description;
                prop.type = overload.type || props[key].type;
                prop.format = props[key].format;
                prop.default = defaultValue;
                prop.isRequired(props[key].isRequired);
                prop.isReadOnly(props[key].isReadOnly);
                prop.isCalculated = false;
                prop.alias(alias);

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
        state = statechart.define(function () {
            this.enter(doInit.bind(data));

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
                    this.canDelete = stream(true);
                    this.canSave = that.isValid;
                    this.canUndo = stream(false);
                });

                this.state("Fetched", function () {
                    this.C(function () {
                        if (that.isReadOnly()) {
                            return "./ReadOnly";
                        }

                        return "./Clean";
                    });
                    this.enter(function () {
                        if (d.lock && d.lock()) {
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
                        this.canDelete = stream(true);
                        this.canSave = stream(false);
                        this.canUndo = stream(false);
                    });
                    this.state("ReadOnly", function () {
                        this.enter(doFreeze);
                        this.exit(doThaw);
                        this.canDelete = stream(false);
                        this.canSave = stream(false);
                        this.canUndo = stream(false);
                    });

                    this.state("Locking", function () {
                        this.enter(doLock);
                        this.event("locked", function (context) {
                            if (context && context.lock) {
                                d.lock(context.lock);
                            }
                            this.goto("../Dirty");
                        });
                        this.canDelete = stream(false);
                        this.canSave = stream(false);
                        this.canUndo = stream(true);
                    });

                    this.state("Unlocking", function () {
                        this.enter(doUnlock);
                        this.event("unlocked", function () {
                            this.goto("../Clean");
                        });
                        this.canDelete = stream(false);
                        this.canSave = stream(false);
                        this.canUndo = stream(false);
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
                        this.canDelete = stream(false);
                        this.canSave = that.isValid;
                        this.canUndo = stream(true);
                    });
                });
            });

            this.state("Busy", function () {
                this.state("Fetching", function () {
                    this.enter(doFetch);
                    this.canDelete = stream(false);
                    this.canSave = stream(false);
                    this.canUndo = stream(false);
                });
                this.state("Saving", function () {
                    this.state("Posting", function () {
                        this.enter(doPost);
                        this.canDelete = stream(false);
                        this.canSave = stream(false);
                        this.canUndo = stream(false);
                    });
                    this.state("Patching", function () {
                        this.enter(doPatch);
                        this.canDelete = stream(false);
                        this.canSave = stream(false);
                        this.canUndo = stream(false);
                    });
                    this.canDelete = stream(false);
                    this.canSave = stream(false);
                    this.canUndo = stream(false);
                });
                this.state("Deleting", function () {
                    this.enter(doDelete);

                    this.event("deleted", function () {
                        this.goto("/Deleted");
                    });
                    this.canDelete = stream(false);
                    this.canSave = stream(false);
                    this.canUndo = stream(false);
                });

                this.event("fetched", function () {
                    this.goto("/Ready/Fetched");
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

                this.canDelete = stream(false);
                this.canSave = stream(false);
                this.canUndo = stream(false);
            });

            this.state("Delete", function () {
                this.enter(function () {
                    doFreeze();
                    doLock();
                });

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
                this.canDelete = stream(false);
                this.canSave = stream(false);
                this.canUndo = stream(true);
            });

            this.state("Deleted", function () {
                this.event("clear", function () {
                    this.goto("/Ready/New");
                });
                this.canDelete = stream(false);
                this.canSave = stream(false);
                this.canUndo = stream(false);
            });

            this.state("Deleting", function () {
                this.enter(doDelete);

                this.event("deleted", function () {
                    this.goto("/Deleted");
                });
                this.canDelete = stream(false);
                this.canSave = stream(false);
                this.canUndo = stream(false);
            });
        });

        // Add standard validator that checks required properties
        // and validates children
        that.onValidate(function () {
            var name,
                keys = Object.keys(d),
                requiredIsNull = function (key) {
                    var prop = d[key];
                    if (prop.isRequired() && (prop() === null ||
                            (prop.type === "string" && !prop()))) {
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
                };

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
    };

    // ..........................................................
    // PRIVATE
    //

    /** private */
    isChild = function (p) {
        return p.type && typeof p.type === "object" && p.type.childOf;
    };

    /** private */
    isToOne = function (p) {
        return p.type && typeof p.type === "object" &&
                !p.type.childOf && !p.type.parentOf;
    };

    /** private */
    isToMany = function (p) {
        return p.type && typeof p.type === "object" && p.type.parentOf;
    };

    module.exports = model;

}());