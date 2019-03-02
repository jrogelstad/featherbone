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
/*jslint node, eval */
(function () {
    "use strict";

    require("./common/string.js");

    const {Client} = require("pg");
    const {Config} = require("./server/config");
    const {Installer} = require("./server/services/installer");
    const datasource = require("../server/datasource");
    const format = require("pg-format");
    const path = require("path");

    const installer = new Installer();
    const config = new Config();

    let client;
    let user;
    let dir = path.resolve(__dirname, process.argv[2] || ".");

    function error(err) {
        console.error(err);
        process.exit();
    }

    function connect() {
        return new Promise(function (resolve, reject) {
            function callback(config) {
                user = config.postgres.user;
                client = new Client(config.postgres);

                client.connect().then(resolve).catch(reject);
            }

            config.read().then(callback).catch(reject);
        });
    }

    // Connect to postgres so we can inquire on db status
    function start(config) {
        let conn;

        conn = "postgres://";
        conn += config.postgres.user + ":";
        conn += config.postgres.password + "@";
        conn += config.postgres.host + ":";
        conn += config.postgres.port + "/" + "postgres";

        client = new Client({
            connectionString: conn
        });

        return client.connect();
    }

    // Inquire on existence of database
    function queryDb() {
        let sql = (
            "SELECT datname FROM pg_database " +
            "WHERE datistemplate = false AND datname = $1"
        );

        return client.query(sql, [config.postgres.database]);
    }

    // Deal with database inquiry
    function handleDb(resp) {
        let msg;
        let sql;

        // If database exists, initialize datasource
        if (resp.rows.length === 1) {
            return datasource.getCatalog();

        // Otherwise create database first
        } else {
            msg = "Creating database \"";
            msg += config.postgres.database + "\"";
            console.log(msg);

            sql = "CREATE DATABASE %I;";
            sql = format(
                sql,
                config.postgres.database,
                config.postgres.user
            );
            return client.query(sql);
        }
    }

    function install() {
        return installer.install(client, dir, user);
    }

    function done() {
        client.done();
        process.exit();
    }

    // Real work starts here
    config.read().then(
        start
    ).then(
        queryDb
    ).then(
        handleDb
    ).then(
        connect // This time to database
    ).then(
        install
    ).then(
        done
    ).catch(
        error
    );
}());
