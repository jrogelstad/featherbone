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

    const {Settings} = require("./settings");
    const settings = new Settings();

    exports.Feather = function () {
        // ..........................................................
        // PRIVATE
        //

        var that = {};

        // ..........................................................
        // PUBLIC
        //

        /**
          Return a class definition, including inherited properties.
          @param {Object} Request payload
          @param {Object} [payload.name] Feather name
          @param {Object} [payload.client] Database client
          @param {Boolean} [payload.includeInherited] Include inherited or not. Default = true.
          @return Promise
        */
        that.getFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                var callback, name = obj.data.name;

                callback = function (catalog) {
                    var resultProps, featherProps, keys, appendParent,
                            result = {name: name, inherits: "Object"};

                    appendParent = function (child, parent) {
                        var feather = catalog[parent],
                            parentProps = feather.properties,
                            childProps = child.properties,
                            ckeys = Object.keys(parentProps);

                        if (parent !== "Object") {
                            appendParent(child, feather.inherits || "Object");
                        }

                        ckeys.forEach(function (key) {
                            if (childProps[key] === undefined) {
                                childProps[key] = parentProps[key];
                                childProps[key].inheritedFrom = parent;
                            }
                        });

                        return child;
                    };

                    /* Validation */
                    if (!catalog[name]) {
                        resolve(false);
                        return;
                    }

                    /* Add other attributes after name */
                    keys = Object.keys(catalog[name]);
                    keys.forEach(function (key) {
                        result[key] = catalog[name][key];
                    });

                    /* Want inherited properites before class properties */
                    if (obj.data.includeInherited !== false && name !== "Object") {
                        result.properties = {};
                        result = appendParent(result, result.inherits);
                    } else {
                        delete result.inherits;
                    }

                    /* Now add local properties back in */
                    featherProps = catalog[name].properties;
                    resultProps = result.properties;
                    keys = Object.keys(featherProps);
                    keys.forEach(function (key) {
                        resultProps[key] = featherProps[key];
                    });

                    resolve(result);
                };

                /* First, get catalog */
                settings.getSettings({
                    client: obj.client,
                    data: {name: "catalog"}
                }).then(callback).catch(reject);
            });
        };

        return that;
    };

}(exports));