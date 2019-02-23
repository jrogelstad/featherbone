/**
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
**/
/*jslint node*/
(function (exports) {
    "use strict";

    const AdmZip = require("adm-zip");
    const path = require("path");

    exports.Packager = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
          Package a module.

          @param {Object} Database client
          @param {String} Module
          @param {String} Username
          @return {Object}
        */
        that.package = function (client, name, ignore) {
            return new Promise(function (resolve, reject) {
                let zip = new AdmZip();
                let sql = "SELECT script FROM module WHERE name = $1";
                let params = [name];

                function callback(resp) {
                    let content = resp.rows[0].script;
                    let filename = path.format(
                        {root: "./", base: "/uploads/" + name + ".zip"}
                    );

                    zip.addFile(
                        "module.js",
                        Buffer.alloc(content.length, content),
                        "Client code"
                    );

                    zip.writeZip(
                        filename,
                        resolve.bind(null, true)
                    );
                }

                client.query(sql, params).then(callback).catch(reject);
            });
        };

        return that;
    };

}(exports));

