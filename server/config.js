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
/*jslint node unordered*/
(function (exports) {
    "use strict";
    const fs = require("fs");
    const path = require("path");

    exports.Config = function () {
        let config = {};

        config.read = function () {
            return new Promise(function (resolve, reject) {
                let filename = path.format(
                    {root: "./", base: "/server/config.json"}
                );

                fs.readFile(filename, "utf8", function (err, data) {
                    if (err) {
                        console.error(err);
                        return reject(err);
                    }
                    data = JSON.parse(data);

                    // Environment values over-ride file if they exist
                    Object.keys(data).forEach(function (key) {
                        if (process.env[key] !== undefined) {
                            if (process.env[key].toLowerCase() === "true") {
                                data[key] = true;
                            } else if (process.env[key].toLowerCase() === "false") {
                                data[key] = false;
                            } else if (
                                !Number.isNaN(Number(process.env[key]))
                            ) {
                                data[key] = Number(process.env[key]);
                            } else {
                                data[key] = process.env[key];
                            }
                        }
                    });

                    resolve(data);
                });
            });
        };

        return config;
    };

}(exports));

