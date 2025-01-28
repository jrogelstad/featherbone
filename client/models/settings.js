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
const store = {};

import f from "../core.js";
import model from "./model.js";
import datasource from "../datasource.js";
import catalog from "./catalog.js";
import State from "../state.js";

/*
  Model for handling settings.

  @param {Object} [definition] Definition
  @param {String} [definition.name] Definition name
  @param {Object} [definition.properties] Properties of definition
  @return {Object}
*/
function settings(definition) {
    let that;
    let doInit;
    let doFetch;
    let doPut;
    let name = definition.name;

    if (!name) {
        throw "Settings name is required";
    }

    // If we've already instantiated these settings, just return them
    if (store[name]) {
        return store[name];
    }

    // Otherwise build the model
    store[name] = model(undefined, definition);
    that = store[name];

    // ..........................................................
    // PUBLIC
    //

    that.id = function () {
        return name;
    };

    that.etag = f.prop();

    // ..........................................................
    // PRIVATE
    //

    doFetch = function (context) {
        let payload = {
            method: "GET",
            path: "/settings/" + name
        };

        function callback(result) {
            let data = result || {};
            that.set(data.data);
            that.etag(data.etag);
            that.state().send("fetched");
            context.resolve(that.data);
        }

        that.state().goto("/Busy");
        datasource.request(payload).then(callback);
    };

    doPut = function (context) {
        let ds = datasource;
        let cache = {
            etag: that.etag(),
            data: that.toJSON()
        };
        let payload = {
            method: "PUT",
            path: "/settings/" + name,
            body: cache
        };

        function callback(result) {
            if (!result === true) {
                that.state().send("error");
                context.reject("Settings failed to save");
                return;
            }
            that.state().send("fetched");
            context.resolve(that.data);
        }

        if (that.isValid()) {
            ds.request(payload).then(callback);
        }
    };

    // Pickup originial init function from model
    doInit = that.state().enters.shift();

    // Redfine statechart for this purpose
    that.state(State.define(function () {
        this.enter(doInit.bind({}));
        this.state("Ready", function () {
            this.event("fetch", function (pContext) {
                this.goto("/Busy", {
                    context: pContext
                });
            });

            this.state("New", function () {
                this.canSave = f.prop(false);
            });

            this.state("Fetched", function () {
                this.state("Clean", function () {
                    this.event("changed", function () {
                        this.goto("../Dirty");
                    });
                    this.canSave = f.prop(false);
                });

                this.state("Dirty", function () {
                    this.event("save", function (pContext) {
                        this.goto("/Busy/Saving", {
                            context: pContext
                        });
                    });
                    this.canSave = that.isValid;
                });
            });
        });

        this.state("Busy", function () {
            this.state("Fetching", function () {
                this.enter(doFetch);
                this.canSave = f.prop(false);
            });
            this.state("Saving", function () {
                this.enter(doPut);
                this.canSave = f.prop(false);
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
            this.canSave = f.prop(false);
        });
    }));

    that.subscribe = () => false; // No subscriptions
    that.state().goto();

    return that;
}

catalog.register("factories", "model", model);

export default Object.freeze(settings);