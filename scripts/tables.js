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

    /*
        What kind of database this is, and which revision of the
        framework's own tables it carries. A control plane holds
        organizations, identities, grants and the tenant registry; a
        tenant holds an application's data; "both" is the single
        database install the framework has always supported. Written
        once at bootstrap and checked at boot, so pointing a server at
        the wrong database is refused rather than acted on (tenant plan
        A.1). The unique index keeps it to one row.
    */
    const SCHEMA_VERSION = "1";

    const createDbSql = (
        "CREATE TABLE \"$db\" (" +
        "kind text not null," +
        "schema_version text not null," +
        "mode text," +
        "created timestamp with time zone not null default now()," +
        "updated timestamp with time zone not null default now()," +
        "CONSTRAINT \"$db_kind_check\" CHECK (" +
        "  kind IN ('controlPlane', 'tenant', 'both'))," +
        "CONSTRAINT \"$db_mode_check\" CHECK (" +
        "  mode IS NULL OR mode IN ('dev', 'test', 'prod')));" +
        "CREATE UNIQUE INDEX \"$db_singleton\" ON \"$db\" ((true));" +
        "COMMENT ON TABLE \"$db\" IS " +
        "'Internal table recording what this database is for';" +
        "COMMENT ON COLUMN \"$db\".kind IS " +
        "'controlPlane, tenant or both';" +
        "COMMENT ON COLUMN \"$db\".schema_version IS " +
        "'Revision of the framework tables in this database';" +
        "COMMENT ON COLUMN \"$db\".mode IS " +
        "'dev, test or prod -- what the banner warns about';"
    );

    /*
        Databases installed before `mode` moved here have the column
        added rather than being reinstalled from scratch.
    */
    const alterDbSql = (
        "ALTER TABLE \"$db\" ADD COLUMN IF NOT EXISTS mode text;" +
        "ALTER TABLE \"$db\" DROP CONSTRAINT IF EXISTS \"$db_mode_check\";" +
        "ALTER TABLE \"$db\" ADD CONSTRAINT \"$db_mode_check\" CHECK (" +
        "  mode IS NULL OR mode IN ('dev', 'test', 'prod'));"
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
        "category text, " +
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
        "'Flag workbook as template only';" +
        "COMMENT ON COLUMN \"$workbook\".category IS " +
        "'Navigation category id';"
    );

    /*
        Navigation categories -- the ribbon's category tabs (see
        client/components/ribbon.js), moved out of that file's old
        hard-coded WORKBOOK_CATEGORIES table and into the database so
        they can be maintained by the user (John, Oct 2026).

        `name` is the natural key: it is what package exports and
        imports reference, so a package never carries a category id
        and so can't be broken by ids differing between databases
        (see services/packager.js and services/installer.js).
        `$workbook.category` holds this record's ID, though, not its
        name -- so renaming a category keeps every workbook pointed
        at it.

        Deliberately has no `module` column: categories belong to
        whoever maintains the menu, not to the module that happened
        to introduce one, so uninstalling a module leaves them be.
    */
    const createNavigationCategorySql = (
        "CREATE TABLE \"$navigation_category\" (" +
        "name text UNIQUE," +
        "icon text," +
        "sequence smallint," +
        "CONSTRAINT navigation_category_pkey PRIMARY KEY (_pk), " +
        "CONSTRAINT navigation_category_id_key UNIQUE (id)) " +
        "INHERITS (object);" +
        "COMMENT ON TABLE \"$navigation_category\" IS " +
        "'Internal table for storing navigation menu categories';" +
        "COMMENT ON COLUMN \"$navigation_category\".name IS " +
        "'Natural key, and the label shown on the menu tab';" +
        "COMMENT ON COLUMN \"$navigation_category\".icon IS 'Menu icon';" +
        "COMMENT ON COLUMN \"$navigation_category\".sequence IS " +
        "'Presentation order';"
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
            let createDb;
            let createMoney;
            let createObject;
            let createFeather;
            let createAuth;
            let createWorkbook;
            let createNavigationCategory;
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
                        "'Flag workbook as template only';" +
                        "ALTER TABLE \"$workbook\" " +
                        "ADD COLUMN IF NOT EXISTS category text; " +
                        "COMMENT ON COLUMN \"$workbook\".category IS " +
                        "'Navigation category id';"
                    );
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(
                            createWorkbookSql,
                            createNavigationCategory
                        );
                    } else {
                        obj.client.query(altSql, createNavigationCategory);
                    }
                });
            };

            // Create the navigation category table
            createNavigationCategory = function () {
                sqlCheck("$navigation_category", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!exists) {
                        obj.client.query(
                            createNavigationCategorySql,
                            createProfiles
                        );
                        return;
                    }
                    createProfiles();
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
                            obj.client.query(sql, params, createDb);
                        });
                        return;
                    }
                    createDb();
                });
            };

            /*
                Record what this database is for. An existing marker is
                left alone and verified instead: changing a database's
                kind underneath its data is never what a stray install
                command means, so say so and stop.
            */
            createDb = function () {
                let kind = obj.target || "both";
                /*
                    Which banner this database shows. It used to be a
                    setting on each server process, so one server
                    serving a test and a production database warned
                    about both or neither; it belongs to the database
                    (John, Oct 2026). The installer passes what
                    configuration says, so an existing install keeps the
                    mode it had, and from then on the database is the
                    authority.
                */
                let mode = obj.mode || null;

                sqlCheck("$db", function (err, exists) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    function record() {
                        obj.client.query((
                            "INSERT INTO \"$db\" " +
                            "(kind, schema_version, mode) " +
                            "VALUES ($1, $2, $3);"
                        ), [kind, SCHEMA_VERSION, mode], createEventTrigger);
                    }

                    if (!exists) {
                        obj.client.query(createDbSql, record);
                        return;
                    }

                    obj.client.query(
                        "SELECT kind FROM \"$db\";",
                        function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (!resp.rows.length) {
                                record();
                                return;
                            }

                            if (resp.rows[0].kind !== kind) {
                                reject(new Error(
                                    "Database is installed as \"" +
                                    resp.rows[0].kind + "\" and cannot be " +
                                    "installed as \"" + kind + "\". Install " +
                                    "with the matching target, or change " +
                                    "\"$db\".kind deliberately first."
                                ));
                                return;
                            }

                            obj.client.query(
                                alterDbSql,
                                function (err) {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    obj.client.query((
                                        "UPDATE \"$db\" SET " +
                                        "schema_version = $1, " +
                                        "mode = coalesce($2, mode), " +
                                        "updated = now();"
                                    ), [
                                        SCHEMA_VERSION,
                                        mode
                                    ], createEventTrigger);
                                }
                            );
                        }
                    );
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
