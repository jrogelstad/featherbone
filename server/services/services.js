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
/*jslint node*/
(function (exports) {
    "use strict";

    function getSortedModules(client) {
        return new Promise(function (resolve, reject) {
            let sql = (
                "SELECT name, version, script, " +
                "to_json(dependencies) AS dependencies " +
                "FROM _module WHERE NOT is_deleted;"
            );

            function callback(resp) {
                let modules = resp.rows;

                function resolveDependencies(module, tree) {
                    tree = tree || module.tree;

                    module.tree.forEach(function (dependency) {
                        let parent = modules.find(
                            (module) => module.name === dependency
                        );

                        parent.tree.forEach(
                            (pDepencency) => tree.push(pDepencency)
                        );

                        resolveDependencies(parent, tree);
                    });
                }

                // Simplify dependencies
                modules.forEach(function (module) {
                    module.dependencies = module.dependencies.map(
                        (dep) => dep.module.name
                    );
                    module.tree = module.dependencies.slice();
                });

                // Process modules, start by resolving,
                // then sorting on dependencies
                modules.forEach((module) => resolveDependencies(module));

                // Sort
                modules = (function () {
                    let module;
                    let idx;
                    let ret = [];

                    function top(mod) {
                        return mod.tree.every(
                            (dep) => ret.some((added) => added.name === dep)
                        );
                    }

                    while (modules.length) {
                        module = modules.find(top);

                        ret.push(module);
                        idx = modules.indexOf(module);
                        modules.splice(idx, 1);
                    }

                    return ret;
                }());

                resolve(modules);
            }

            client.query(sql).then(callback).catch(reject);
        });
    }

    /**
        Custom data service scripts loaded from the database at run time.
        @class Services
        @constructor
        @namespace Services
    */
    exports.Services = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Fetch all service scripts from the database and resolve in promise.
            @method getServices
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @return {Promise}
        */
        that.getServices = async function (obj) {
            try {
                let sql = (
                    "SELECT name, module, script " +
                    "FROM data_service WHERE NOT is_deleted;"
                );
                let srvc;
                let mods;
                let ret = [];

                srvc = await obj.client.query(sql);
                srvc = srvc.rows;
                mods = await getSortedModules(obj.client);
                mods = mods.map((mod) => mod.name);
                mods.forEach(function (mod) {
                    srvc.forEach(function (srv) {
                        if (mod === srv.module) {
                            ret.push(srv);
                        }
                    });
                });

                return ret;
            } catch (err) {
                return Promise.reject(err);
            }
        };

        return that;
    };

}(exports));

