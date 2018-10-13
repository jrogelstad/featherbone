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
/*jslint node*/
(function (exports) {
    "strict";
    var fs = require("fs"),
        path = require("path");

    exports.Config = function () {
        var config = {};

        config.read = function () {
            return new Promise(function (resolve, reject) {

                var filename = path.format({root: "./", base: "/server/config.json"});

                fs.readFile(filename, "utf8", function (err, data) {
                    if (err) {
                        console.error(err);
                        return reject(err);
                    }

                    resolve(JSON.parse(data));
                });
            });
        };

        return config;
    };

}(exports));

