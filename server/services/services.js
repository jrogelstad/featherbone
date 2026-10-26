/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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

    // Databases already told about their module-less service rows
    let reported = {};

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
            Module names in dependency order: what loads before what.
            The order a database's modules impose, not the order of
            whichever of them happen to have rows anywhere.

            @method getModuleOrder
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @return {Promise} Resolves an array of module names
        */
        that.getModuleOrder = async function (obj) {
            let mods = await getSortedModules(obj.client);

            return mods.map((mod) => mod.name);
        };

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
                let orphans;

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

                /*
                    A service row belonging to no module is not loaded
                    and is not carried forward (ADR-002 question 6):
                    the rows were a loophole -- source code in a table,
                    executed by the server, outside any module and so
                    outside any package. They were already never
                    loaded, because this only ever walked the modules;
                    nothing said so, so the code sat there looking
                    live. Said once per database per process.
                */
                orphans = srvc.filter(
                    (srv) => mods.indexOf(srv.module) === -1
                );

                if (orphans.length && !reported[obj.client.database]) {
                    reported[obj.client.database] = true;
                    console.warn(
                        "\"" + obj.client.database + "\" holds " +
                        orphans.length + " service row(s) belonging to " +
                        "no module, which are not loaded and are not " +
                        "carried forward (ADR-002): " +
                        orphans.map(function (srv) {
                            return srv.name + " (" + (
                                srv.module || "no module"
                            ) + ")";
                        }).join(", ")
                    );
                }

                return ret;
            } catch (err) {
                return Promise.reject(err);
            }
        };

        return that;
    };

}(exports));

