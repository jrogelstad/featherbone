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
/*global exports*/
/*jslint node, browser, unordered*/
(function (exports) {
    "use strict";

    const createTriggerFuncSql = (
        "CREATE OR REPLACE FUNCTION insert_trigger() RETURNS trigger AS $$" +
        "DECLARE " +
        "  node RECORD;" +
        "  sub RECORD; " +
        "  payload TEXT; " +
        "BEGIN" +
        "  FOR node IN " +
        "    SELECT DISTINCT nodeid FROM \"$subscription\"" +
        "    WHERE objectid = TG_TABLE_NAME LOOP " +
        "    FOR sub IN" +
        "      SELECT 'create' AS change,eventkey, subscriptionid " +
        "      FROM \"$subscription\"" +
        "      WHERE nodeid = node.nodeid AND objectid = TG_TABLE_NAME" +
        "    LOOP" +
        "        INSERT INTO \"$subscription\" " +
        "        VALUES (node.nodeid, sub.eventkey, sub.subscriptionid, " +
        "        NEW.id);" +
        "        payload := '{\"subscription\": ' || " +
        "        row_to_json(sub)::text || ',\"data\": {\"id\":\"' || " +
        "        NEW.id || '\",\"table\": \"' || TG_TABLE_NAME || '\"}}';" +
        "        PERFORM pg_notify(node.nodeid, payload); " +
        "    END LOOP;" +
        "  END LOOP; " +
        "RETURN NEW; " +
        "END; " +
        "$$ LANGUAGE plpgsql;" +
        "CREATE OR REPLACE FUNCTION update_trigger() RETURNS trigger AS $$" +
        "DECLARE " +
        "  node RECORD;" +
        "  sub RECORD; " +
        "  payload TEXT; " +
        "  change TEXT DEFAULT 'update';" +
        "  data TEXT; " +
        "BEGIN" +
        "  FOR node IN " +
        "    SELECT DISTINCT nodeid FROM \"$subscription\"" +
        "    WHERE (objectid = NEW.id OR objectid = TG_TABLE_NAME) LOOP " +
        "    IF NEW.is_deleted THEN " +
        "      change := 'delete'; " +
        "      data := '\"' || OLD.id || '\"'; " +
        "    ELSEIF NEW.lock IS NOT NULL AND OLD.lock IS NULL THEN " +
        "      change := 'lock'; " +
        "      data := '{\"id\":\"' || NEW.id || '\",\"lock\": ' || " +
        "      row_to_json(NEW.lock)::text || '}'; " +
        "    ELSEIF OLD.lock IS NOT NULL AND NEW.lock IS NULL THEN " +
        "      change := 'unlock'; " +
        "      data := '\"' || OLD.id || '\"'; " +
        "    ELSE" +
        "      data := '{\"id\":\"' || NEW.id || '\",\"table\": \"' || " +
        "      TG_TABLE_NAME || '\"}'; " +
        "    END IF; " +
        "    FOR sub IN" +
        "      SELECT change AS change, eventkey, subscriptionid " +
        "      FROM \"$subscription\"" +
        "      WHERE nodeid = node.nodeid AND " +
        "      (objectid = NEW.id OR objectid = TG_TABLE_NAME) " +
        "    LOOP" +
        "        payload := '{\"subscription\": ' || " +
        "        row_to_json(sub)::text || ',\"data\":' || data || '}';" +
        "        PERFORM pg_notify(node.nodeid, payload); " +
        "    END LOOP;" +
        "  END LOOP; " +
        "RETURN NEW; " +
        "END; " +
        "$$ LANGUAGE plpgsql;" +
        "DROP TRIGGER IF EXISTS \"$settings_update_trigger\" " +
        "ON \"$settings\"; " +
        "CREATE TRIGGER \"$settings_update_trigger\" " +
        "AFTER UPDATE ON \"$settings\" " +
        "FOR EACH ROW EXECUTE PROCEDURE " +
        "update_trigger();" +
        "CREATE OR REPLACE FUNCTION delete_trigger() RETURNS trigger AS $$" +
        "DECLARE " +
        "  node RECORD;" +
        "  sub RECORD; " +
        "  payload TEXT; " +
        "  change TEXT DEFAULT 'delete';" +
        "  data TEXT; " +
        "BEGIN" +
        "  FOR node IN " +
        "    SELECT DISTINCT nodeid FROM \"$subscription\"" +
        "    WHERE (objectid = OLD.id OR objectid = TG_TABLE_NAME) LOOP " +
        "      data := '\"' || OLD.id || '\"'; " +
        "    FOR sub IN" +
        "      SELECT change AS change, eventkey, subscriptionid " +
        "      FROM \"$subscription\"" +
        "      WHERE nodeid = node.nodeid " +
        "          AND (objectid = OLD.id OR objectid = TG_TABLE_NAME)" +
        "    LOOP" +
        "        payload := '{\"subscription\": ' || " +
        "        row_to_json(sub)::text || ',\"data\":' || data || '}';" +
        "        PERFORM pg_notify(node.nodeid, payload); " +
        "    END LOOP;" +
        "  END LOOP; " +
        "RETURN NEW; " +
        "END; " +
        "$$ LANGUAGE plpgsql;"
    );

    const createSubcriptionSql = (
        "CREATE TABLE \"$subscription\" (" +
        "nodeid text," +
        "eventkey text," +
        "subscriptionid text," +
        "objectid text," +
        "PRIMARY KEY (nodeid, eventkey, subscriptionid, objectid)); " +
        "COMMENT ON TABLE \"$subscription\" IS " +
        "'Track which changes to listen for';" +
        "COMMENT ON COLUMN \"$subscription\".nodeid IS 'Node server id';" +
        "COMMENT ON COLUMN \"$subscription\".eventkey IS " +
        "'Client event notification key';" +
        "COMMENT ON COLUMN \"$subscription\".subscriptionid IS " +
        "'Subscription id';" +
        "COMMENT ON COLUMN \"$subscription\".objectid IS 'Object id';"
    );

    const createObjectSql = (
        "CREATE TABLE object (" +
        "_pk bigserial PRIMARY KEY," +
        "id text UNIQUE," +
        "created timestamp with time zone," +
        "created_by text," +
        "updated timestamp with time zone," +
        "updated_by text," +
        "is_deleted boolean, " +
        "lock lock); " +
        "COMMENT ON TABLE object IS " +
        "'Abstract object class from which all other classes will inherit';" +
        "COMMENT ON COLUMN object._pk IS 'Internal primary key';" +
        "COMMENT ON COLUMN object.id IS 'Surrogate key';" +
        "COMMENT ON COLUMN object.created IS 'Create time of the record';" +
        "COMMENT ON COLUMN object.created_by IS " +
        "'User who created the record';" +
        "COMMENT ON COLUMN object.updated IS " +
        "'Last time the record was updated';" +
        "COMMENT ON COLUMN object.updated_by IS " +
        "'Last user who created the record';" +
        "COMMENT ON COLUMN object.is_deleted IS " +
        "'Indicates the record is no longer active';" +
        "COMMENT ON COLUMN object.lock IS 'Record lock';" +
        "CREATE OR REPLACE VIEW _object AS SELECT *," +
        "to_camel_case(tableoid::regclass::text) AS object_type FROM object;"
    );

    const createAuthSql = (
        "CREATE TABLE \"$auth\" (" +
        "pk serial PRIMARY KEY," +
        "object_pk bigint not null," +
        "role text not null," +
        "can_create boolean," +
        "can_read boolean," +
        "can_update boolean," +
        "can_delete boolean," +
        "CONSTRAINT \"$auth_object_pk_role_key\" " +
        "UNIQUE (object_pk, role));" +
        "COMMENT ON TABLE \"$auth\" IS " +
        "'Table for storing object level authorization information';" +
        "COMMENT ON COLUMN \"$auth\".pk IS 'Primary key';" +
        "COMMENT ON COLUMN \"$auth\".object_pk IS " +
        "'Primary key for object authorization applies to';" +
        "COMMENT ON COLUMN \"$auth\".role IS " +
        "'Role authorization applies to';" +
        "COMMENT ON COLUMN \"$auth\".can_create IS 'Can create the object';" +
        "COMMENT ON COLUMN \"$auth\".can_read IS 'Can read the object';" +
        "COMMENT ON COLUMN \"$auth\".can_update IS 'Can update the object';" +
        "COMMENT ON COLUMN \"$auth\".can_delete IS 'Can delete the object';"
    );

    const createFeatherSql = (
        "CREATE TABLE \"$feather\" (" +
        "is_child boolean," +
        "parent_pk bigint," +
        "CONSTRAINT feather_internal_pkey PRIMARY KEY (_pk), " +
        "CONSTRAINT feather_internal_id_key UNIQUE (id)) INHERITS (object);" +
        "COMMENT ON TABLE \"$feather\" IS " +
        "'Internal table for storing class names';"
    );

    const createWorkbookSql = (
        "CREATE TABLE \"$workbook\" (" +
        "name text UNIQUE," +
        "description text," +
        "label text default '', " +
        "icon text," +
        "launch_config json," +
        "default_config json," +
        "local_config json," +
        "module text," +
        "sequence smallint," +
        "actions json," +
        "is_template boolean default false, " +
        "CONSTRAINT workbook_pkey PRIMARY KEY (_pk), " +
        "CONSTRAINT workbook_id_key UNIQUE (id)) INHERITS (object);" +
        "COMMENT ON TABLE \"$workbook\" IS " +
        "'Internal table for storing workbook';" +
        "COMMENT ON COLUMN \"$workbook\".name IS 'Primary key';" +
        "COMMENT ON COLUMN \"$workbook\".description IS 'Description';" +
        "COMMENT ON COLUMN \"$workbook\".icon IS 'Menu icon';" +
        "COMMENT ON COLUMN \"$workbook\".launch_config IS " +
        "'Launcher configuration';" +
        "COMMENT ON COLUMN \"$workbook\".default_config IS " +
        "'Default configuration';" +
        "COMMENT ON COLUMN \"$workbook\".local_config IS " +
        "'Local configuration';" +
        "COMMENT ON COLUMN \"$workbook\".module IS 'Module reference';" +
        "COMMENT ON COLUMN \"$workbook\".sequence IS " +
        "'Presentation order';" +
        "COMMENT ON COLUMN \"$workbook\".actions IS " +
        "'Menu action definition';" +
        "COMMENT ON COLUMN \"$workbook\".is_template IS " +
        "'Flag workbook as template only';"
    );

    const createSessionSql = (
        "CREATE TABLE \"$session\" (" +
        "\"sid\" varchar NOT NULL COLLATE \"default\"," +
        "\"sess\" json NOT NULL," +
        "\"expire\" timestamp(6) NOT NULL" +
        ")" +
        "WITH (OIDS=FALSE); " +
        "ALTER TABLE \"$session\" ADD CONSTRAINT \"session_pkey\" " +
        "PRIMARY KEY (\"sid\") NOT DEFERRABLE INITIALLY IMMEDIATE; "
    );

    const createSettingsSql = (
        "CREATE TABLE \"$settings\" (" +
        "name text," +
        "definition json," +
        "data json," +
        "etag text," +
        "module text," +
        "CONSTRAINT settings_pkey PRIMARY KEY (_pk), " +
        "CONSTRAINT settings_id_key UNIQUE (id)) INHERITS (object);" +
        "COMMENT ON TABLE \"$settings\" IS " +
        "'Internal table for storing system settings';" +
        "COMMENT ON COLUMN \"$settings\".name IS 'Name of settings';" +
        "COMMENT ON COLUMN \"$settings\".definition IS " +
        "'Attribute types definition';" +
        "COMMENT ON COLUMN \"$settings\".data IS " +
        "'Object containing settings';" +
        "COMMENT ON COLUMN \"$settings\".etag IS " +
        "'Pessemistic lock key';" +
        "COMMENT ON COLUMN \"$settings\".data IS " +
        "'Module name';"
    );

    const createProfilesSql = (
        "CREATE TABLE \"$profiles\" (" +
        "role text PRIMARY KEY," +
        "etag text, " +
        "data json);" +
        "COMMENT ON TABLE \"$profiles\" IS " +
        "'Internal table for storing user profile information';" +
        "COMMENT ON COLUMN \"$profiles\".role IS 'Role profile belongs to';" +
        "COMMENT ON COLUMN \"$profiles\".etag IS 'Version';" +
        "COMMENT ON COLUMN \"$profiles\".data IS " +
        "'Profile data';"
    );

    const objectDef = {
        Object: {
            description: (
                "Abstract object class from which all feathers will inherit"
            ),
            module: "Core",
            discriminator: "objectType",
            plural: "Objects",
            properties: {
                id: {
                    description: "Surrogate key",
                    type: "string",
                    default: "createId()",
                    isRequired: true,
                    isReadOnly: true,
                    isAlwaysLoad: true
                },
                created: {
                    description: "Create time of the record",
                    type: "string",
                    format: "dateTime",
                    default: "now()",
                    isReadOnly: true
                },
                createdBy: {
                    description: "User who created the record",
                    type: "string",
                    isReadOnly: true
                },
                updated: {
                    description: "Last time the record was updated",
                    type: "string",
                    format: "dateTime",
                    default: "now()",
                    isReadOnly: true
                },
                updatedBy: {
                    description: "User who last updated the record",
                    type: "string",
                    isReadOnly: true
                },
                isDeleted: {
                    description: "Indicates the record is no longer active",
                    type: "boolean",
                    isReadOnly: true,
                    isAlwaysLoad: true
                },
                lock: {
                    description: "Record lock information",
                    type: "object",
                    format: "lock",
                    isReadOnly: true,
                    isAlwaysLoad: true
                },
                objectType: {
                    description: (
                        "Discriminates which inherited object type the " +
                        "object represents"
                    ),
                    type: "string",
                    isReadOnly: true,
                    isAlwaysLoad: true
                }
            }
        }
    };

    exports.execute = function (obj) {
        return new Promise(function (resolve, reject) {
            let createCamelCase;
            let createMoney;
            let createObject;
            let createFeather;
            let createAuth;
            let createWorkbook;
            let createSession;
            let createSubscription;
            let createSettings;
            let createEventTrigger;
            let createLock;
            let createProfiles;
            let sqlCheck;
            let done;
            let sql;
            let params;

            sqlCheck = function (table, callback, statement) {
                let sqlChk = statement || (
                    "SELECT * FROM pg_tables " +
                    "WHERE schemaname = 'public' AND tablename = $1;"
                );

                obj.client.query(sqlChk, [table], function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    callback(null, resp.rows.length > 0);
                });
            };

            // Create a camel case function
            createCamelCase = function () {
                sql = (
                    "CREATE OR REPLACE FUNCTION to_camel_case(str text) " +
                    "RETURNS text AS $$" +
                    "SELECT replace(initcap($1), '_', '');" +
                    "$$ LANGUAGE SQL IMMUTABLE;"
                );
                obj.client.query(sql, createMoney);
            };

            // Create "mono" data type ("money" is already used)
            createMoney = function () {
                function callback(err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        sql = (
                            "CREATE TYPE mono AS (" +
                            "   amount numeric," +
                            "   currency text," +
                            "   effective timestamp with time zone," +
                            "   base_amount numeric" +
                            ");"
                        );
                        obj.client.query(sql, createLock);
                        return;
                    }
                    createLock();
                }

                sql = "SELECT * FROM pg_class WHERE relname = $1";
                sqlCheck("mono", callback, sql);
            };

            // Create "lock" data type
            createLock = function () {
                function callback(err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        sql = (
                            "CREATE TYPE lock AS (" +
                            "   username text," +
                            "   created timestamp with time zone," +
                            "   _nodeid text," +
                            "   _eventkey text, " +
                            "   process text" +
                            ");"
                        );
                        obj.client.query(sql, createSubscription);
                        return;
                    }
                    createSubscription();
                }

                sql = "SELECT * FROM pg_class WHERE relname = $1";
                sqlCheck("lock", callback, sql);
            };

            // Create the subscription table
            createSubscription = function () {
                sqlCheck("$subscription", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createSubcriptionSql, createSession);
                        return;
                    }
                    createSession();
                });
            };

            // Create the session table
            createSession = function () {
                sqlCheck("$session", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createSessionSql, createObject);
                        return;
                    }
                    createObject();
                });
            };

            // Create the base object table
            createObject = function () {
                sqlCheck("object", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createObjectSql, createAuth);
                        return;
                    }
                    createAuth();
                });
            };

            // Create the object auth table
            createAuth = function () {
                sqlCheck("$auth", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createAuthSql, createFeather);
                        return;
                    }
                    createFeather();
                });
            };

            // Create the feather table
            createFeather = function () {
                sqlCheck("$feather", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createFeatherSql, createWorkbook);
                        return;
                    }
                    createWorkbook();
                });
            };

            // Create the workbook table
            createWorkbook = function () {
                sqlCheck("$workbook", function (err, exists) {
                    let altSql = (
                        "ALTER TABLE \"$workbook\" " +
                        "ADD COLUMN IF NOT EXISTS label text default ''; " +
                        "COMMENT ON COLUMN \"$workbook\".label IS " +
                        "'Menu label';" +
                        "ALTER TABLE \"$workbook\" " +
                        "ADD COLUMN IF NOT EXISTS is_template " +
                        "boolean default false; " +
                        "COMMENT ON COLUMN \"$workbook\".is_template IS " +
                        "'Flag workbook as template only';"
                    );
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createWorkbookSql, createProfiles);
                    } else {
                        obj.client.query(altSql, createProfiles);
                    }
                });
            };

            // Create the profile table
            createProfiles = function () {
                sqlCheck("$profiles", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createProfilesSql, createSettings);
                        return;
                    }
                    createSettings();
                });
            };

            // Create the settings table
            createSettings = function () {
                sqlCheck("$settings", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(createSettingsSql, function (err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            sql = (
                                "INSERT INTO \"$settings\" " +
                                "VALUES (" +
                                "  nextval('object__pk_seq'), $1, now(), " +
                                "  CURRENT_USER, now(), CURRENT_USER, " +
                                "  false, NULL, $2, NULL, $3);"
                            );
                            params = [
                                "catalog",
                                "catalog",
                                JSON.stringify(objectDef)
                            ];
                            obj.client.query(sql, params, createEventTrigger);
                        });
                        return;
                    }
                    createEventTrigger();
                });
            };

            // Create event trigger for notifications
            createEventTrigger = function () {
                obj.client.query(createTriggerFuncSql, done);
                return;
            };

            done = function () {
                resolve();
            };

            // Real work starts here
            createCamelCase();
        });
    };

}(exports));
