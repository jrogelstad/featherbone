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
/*jslint white, node*/
(function (exports) {
  "strict";

  exports.execute = function (obj) {
    return new Promise (function (resolve, reject) {
      var createCamelCase, createMoney, createObject, createFeather, createAuth,
        createModule, createController, createRoute, createWorkbook, createSubscription,
        createSettings, createEventTrigger, createUser, sqlCheck, done, sql, params;

      sqlCheck = function (table, callback, statement) {
        var sqlChk = statement || "SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = $1;";

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
        sql = "CREATE OR REPLACE FUNCTION to_camel_case(str text) RETURNS text AS $$" +
          "SELECT replace(initcap($1), '_', '');" +
          "$$ LANGUAGE SQL IMMUTABLE;";
        obj.client.query(sql, createMoney);
      };

      // Create "mono" data type ("money" is already used)
      createMoney = function () {
        function callback (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TYPE mono AS (" +
                  "   amount numeric," +
                  "   currency text," +
                  "   effective timestamp with time zone," +
                  "   ratio numeric" +
                  ");";
            obj.client.query(sql, createEventTrigger);
            return;
          }
          createEventTrigger();
        }

        sql = "SELECT * FROM pg_class WHERE relname = $1";
        sqlCheck('mono', callback, sql);
      };
      
      // Create event trigger for notifications
      createEventTrigger = function () {
        sql = 'CREATE OR REPLACE FUNCTION insert_trigger() RETURNS trigger AS $$' +
              'DECLARE ' +
              '  node RECORD;' +
              '  sub RECORD; ' +
              '  rec RECORD; ' +
              '  payload TEXT; ' +
              'BEGIN' +
              '  FOR node IN ' +
              '    SELECT DISTINCT nodeid FROM "$subscription"' +
              '    WHERE objectid = TG_TABLE_NAME LOOP ' +
              ''+
              '    EXECUTE format(\'SELECT * FROM %I' +
              '    WHERE id IS NULL\', \'_\' || TG_TABLE_NAME) INTO rec;'+
              ''+
              '    FOR sub IN' +
              '      SELECT \'new\' AS change,sessionid, subscriptionid FROM "$subscription"' +
              '      WHERE nodeid = node.nodeid AND objectid = TG_TABLE_NAME' +
              '    LOOP' +
              '        payload := \'{"subscription": \' || row_to_json(sub)::text || \',"data":\' || row_to_json(rec)::text || \'}\';' +
              '        PERFORM pg_notify(node.nodeid, payload); '+
              '    END LOOP;' +
              '  END LOOP; ' +
              'RETURN NEW; ' +
              'END; ' +
              '$$ LANGUAGE plpgsql;' +
              'CREATE OR REPLACE FUNCTION update_trigger() RETURNS trigger AS $$' +
              'DECLARE ' +
              '  node RECORD;' +
              '  sub RECORD; ' +
              '  rec RECORD; ' +
              '  payload TEXT; ' +
              'BEGIN' +
              '  FOR node IN ' +
              '    SELECT DISTINCT nodeid FROM "$subscription"' +
              '    WHERE objectid = NEW.id LOOP ' +
              '' +
              '    EXECUTE format(\'SELECT * FROM %I' +
              '    WHERE id = $1\', \'_\' || TG_TABLE_NAME) INTO rec USING NEW.id;'+
              ''+
              '    FOR sub IN' +
              '      SELECT \'update\' AS change, sessionid, subscriptionid FROM "$subscription"' +
              '      WHERE nodeid = node.nodeid AND objectid = NEW.id' +
              '    LOOP' +
              '        payload := \'{"subscription": \' || row_to_json(sub)::text || \',"data":\' || row_to_json(rec)::text || \'}\';' +
              '        PERFORM pg_notify(node.nodeid, payload); '+
              '    END LOOP;' +
              '  END LOOP; ' +
              'RETURN NEW; ' +
              'END; ' +
              '$$ LANGUAGE plpgsql;' +
              'CREATE OR REPLACE FUNCTION delete_trigger() RETURNS trigger AS $$' +
              'DECLARE ' +
              'BEGIN' +
              '  PERFORM pg_notify(\'node1\', TG_TABLE_NAME || \',id,\' || OLD.id ); ' +
              'RETURN old; ' +
              'END; ' +
              '$$ LANGUAGE plpgsql;';
        obj.client.query(sql, createSubscription);
        return;
      };     
      
      // Create the subscription table
      createSubscription = function () {
        sqlCheck('$subscription', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$subscription\" (" +
              "nodeid text," +
              "sessionid text," +
              "subscriptionid text," +
              "objectid text," +
              "PRIMARY KEY (nodeid, sessionid, subscriptionid, objectid)); " +
              "COMMENT ON TABLE \"$subscription\" IS 'Track which changes to listen for';" +
              "COMMENT ON COLUMN \"$subscription\".nodeid IS 'Node server id';" +
              "COMMENT ON COLUMN \"$subscription\".sessionid IS 'Client session id';" +
              "COMMENT ON COLUMN \"$subscription\".subscriptionid IS 'Subscription id';" +
              "COMMENT ON COLUMN \"$subscription\".objectid IS 'Object id';";
            obj.client.query(sql, createObject);
            return;
          }
          createObject();
        });
      };

      // Create the base object table
      createObject = function () {
        sqlCheck('object', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE object (" +
              "_pk bigserial PRIMARY KEY," +
              "id text UNIQUE," +
              "created timestamp with time zone," +
              "created_by text," +
              "updated timestamp with time zone," +
              "updated_by text," +
              "is_deleted boolean); " +
              "COMMENT ON TABLE object IS 'Abstract object class from which all other classes will inherit';" +
              "COMMENT ON COLUMN object._pk IS 'Internal primary key';" +
              "COMMENT ON COLUMN object.id IS 'Surrogate key';" +
              "COMMENT ON COLUMN object.created IS 'Create time of the record';" +
              "COMMENT ON COLUMN object.created_by IS 'User who created the record';" +
              "COMMENT ON COLUMN object.updated IS 'Last time the record was updated';" +
              "COMMENT ON COLUMN object.updated_by IS 'Last user who created the record';" +
              "COMMENT ON COLUMN object.is_deleted IS 'Indicates the record is no longer active';" +
              "CREATE OR REPLACE VIEW _object AS SELECT *, to_camel_case(tableoid::regclass::text) AS object_type FROM object;";
            obj.client.query(sql, createAuth);
            return;
          }
          createAuth();
        });
      };

      // Create the object auth table
      createAuth = function () {
        sqlCheck('$auth', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$auth\" (" +
              "pk serial PRIMARY KEY," +
              "object_pk bigint not null," +
              "role_pk bigint not null," +
              "can_create boolean not null," +
              "can_read boolean not null," +
              "can_update boolean not null," +
              "can_delete boolean not null," +
              "is_member_auth boolean not null," +
              "CONSTRAINT \"$auth_object_pk_role_pk_is_member_auth_key\" UNIQUE (object_pk, role_pk, is_member_auth));" +
              "COMMENT ON TABLE \"$auth\" IS 'Table for storing object level authorization information';" +
              "COMMENT ON COLUMN \"$auth\".pk IS 'Primary key';" +
              "COMMENT ON COLUMN \"$auth\".object_pk IS 'Primary key for object authorization applies to';" +
              "COMMENT ON COLUMN \"$auth\".role_pk IS 'Primary key for role authorization applies to';" +
              "COMMENT ON COLUMN \"$auth\".can_create IS 'Can create the object';" +
              "COMMENT ON COLUMN \"$auth\".can_read IS 'Can read the object';" +
              "COMMENT ON COLUMN \"$auth\".can_update IS 'Can update the object';" +
              "COMMENT ON COLUMN \"$auth\".can_delete IS 'Can delete the object';" +
              "COMMENT ON COLUMN \"$auth\".is_member_auth IS 'Is authorization for members of a parent';";
            obj.client.query(sql, createFeather);
            return;
          }
          createFeather();
        });
      };

      // Create the feather table
      createFeather = function () {
        sqlCheck('$feather', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$feather\" (" +
              "is_child boolean," +
              "parent_pk bigint," +
              "CONSTRAINT feather_pkey PRIMARY KEY (_pk), " +
              "CONSTRAINT feather_id_key UNIQUE (id)) INHERITS (object);" +
              "COMMENT ON TABLE \"$feather\" is 'Internal table for storing class names';";
            obj.client.query(sql, createModule);
            return;
          }
          createModule();
        });
      };

      // Create the module table
      createModule = function () {
        sqlCheck('$module', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$module\" (" +
              "name text PRIMARY KEY," +
              "script text," +
              "version text," +
              "dependencies json," +
              "is_active boolean DEFAULT true);" +
              "COMMENT ON TABLE \"$module\" IS 'Internal table for storing JavaScript';" +
              "COMMENT ON COLUMN \"$module\".name IS 'Primary key';" +
              "COMMENT ON COLUMN \"$module\".script IS 'JavaScript';" +
              "COMMENT ON COLUMN \"$module\".version IS 'Version number';" +
              "COMMENT ON COLUMN \"$module\".dependencies IS 'Module dependencies';" +
              "COMMENT ON COLUMN \"$module\".dependencies IS 'Active state';";
            obj.client.query(sql, createController());
            return;
          }
          createController();
        });
      };

      // Create the controller table
      createController = function () {
        sqlCheck('$controller', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$controller\" (" +
              "name text PRIMARY KEY," +
              "module text REFERENCES \"$module\" (name)," +
              "script text," +
              "version text);" +
              "COMMENT ON TABLE \"$controller\" IS 'Internal table for storing JavaScript controllers';" +
              "COMMENT ON COLUMN \"$controller\".name IS 'Primary key';" +
              "COMMENT ON COLUMN \"$controller\".module IS 'Module reference';" +
              "COMMENT ON COLUMN \"$controller\".script IS 'JavaScript';" +
              "COMMENT ON COLUMN \"$controller\".version IS 'Version number';";
            obj.client.query(sql, createRoute());
            return;
          }
          createRoute();
        });
      };

      // Create the route table
      createRoute = function () {
        sqlCheck('$route', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$route\" (" +
              "name text PRIMARY KEY," +
              "module text REFERENCES \"$module\" (name)," +
              "script text," +
              "version text);" +
              "COMMENT ON TABLE \"$route\" IS 'Internal table for storing JavaScript routes';" +
              "COMMENT ON COLUMN \"$route\".name IS 'Primary key';" +
              "COMMENT ON COLUMN \"$route\".module IS 'Module reference';" +
              "COMMENT ON COLUMN \"$route\".script IS 'JavaScript';" +
              "COMMENT ON COLUMN \"$route\".version IS 'Version number';";
            obj.client.query(sql, createWorkbook());
            return;
          }
          createWorkbook();
        });
      };

      // Create the workbook table
      createWorkbook = function () {
        sqlCheck('$workbook', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$workbook\" (" +
              "name text UNIQUE," +
              "description text," +
              "launch_config json," +
              "default_config json," +
              "local_config json," +
              "module text REFERENCES \"$module\" (name)," +
              "CONSTRAINT workbook_pkey PRIMARY KEY (_pk), " +
              "CONSTRAINT workbook_id_key UNIQUE (id)) INHERITS (object);" +
              "COMMENT ON TABLE \"$workbook\" IS 'Internal table for storing workbook';" +
              "COMMENT ON COLUMN \"$workbook\".name IS 'Primary key';" +
              "COMMENT ON COLUMN \"$workbook\".description IS 'Description';" +
              "COMMENT ON COLUMN \"$workbook\".launch_config IS 'Launcher configuration';" +
              "COMMENT ON COLUMN \"$workbook\".default_config IS 'Default configuration';" +
              "COMMENT ON COLUMN \"$workbook\".local_config IS 'Local configuration';" +
              "COMMENT ON COLUMN \"$workbook\".module IS 'Foreign key to module';";
            obj.client.query(sql, createUser);
            return;
          }
          createUser();
        });
      };

      // Create the user table
      createUser = function () {
        sqlCheck('$user', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$user\" (" +
              "username text PRIMARY KEY," +
              "is_super boolean);" +
              "COMMENT ON TABLE \"$user\" IS 'Internal table for storing supplimental user information';" +
              "COMMENT ON COLUMN \"$user\".username IS 'System user';" +
              "COMMENT ON COLUMN \"$user\".is_super IS 'Indicates whether user is super user';";
            obj.client.query(sql, function (err) {
              if (err) {
                reject(err);
                return;
              }

              obj.client.query("INSERT INTO \"$user\" VALUES ($1, true)", [obj.user], createSettings);
            });
            return;
          }
          createSettings();
        });
      };

      // Create the settings table
      createSettings = function () {
        sqlCheck('$settings', function (err, exists) {
          if (err) {
            reject(err);
            return;
          }

          if (!exists) {
            sql = "CREATE TABLE \"$settings\" (" +
              "name text," +
              "definition json," +
              "data json," +
              "etag text," +
              "CONSTRAINT settings_pkey PRIMARY KEY (_pk), " +
              "CONSTRAINT settings_id_key UNIQUE (id)) INHERITS (object);" +
              "COMMENT ON TABLE \"$settings\" IS 'Internal table for storing system settings';" +
              "COMMENT ON COLUMN \"$settings\".name IS 'Name of settings';" +
              "COMMENT ON COLUMN \"$settings\".definition IS 'Attribute types definition';" +
              "COMMENT ON COLUMN \"$settings\".data IS 'Object containing settings';";
            obj.client.query(sql, function (err) {
              if (err) {
                reject(err);
                return;
              }

              sql = "INSERT INTO \"$settings\" VALUES (nextval('object__pk_seq'), $1, now(), CURRENT_USER, now(), CURRENT_USER, false, $2, NULL, $3);";
              params = [
                "catalog",
                "catalog",
                JSON.stringify({
                  Object: {
                    description: "Abstract object class from which all feathers will inherit",
                    module: "Core",
                    discriminator: "objectType",
                    plural: "Objects",
                    properties: {
                      id: {
                        description: "Surrogate key",
                        type: "string",
                        default: "createId()",
                        isRequired: true,
                        isReadOnly: true
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
                        default: "getCurrentUser()",
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
                        description: "User who created the record",
                        type: "string",
                        default: "getCurrentUser()",
                        isReadOnly: true
                      },
                      isDeleted: {
                        description: "Indicates the record is no longer active",
                        type: "boolean",
                        isReadOnly: true
                      },
                      objectType: {
                        description: "Discriminates which inherited object type the object represents",
                        type: "string",
                        isReadOnly: true
                      }
                    }
                  }
                })
              ];
              obj.client.query(sql, params, done);
            });
            return;
          }
          done();
        });
      };

      done = function () {
        resolve();
      };

      // Real work starts here
      createCamelCase();
    });
  };

}(exports));

/** Drop everything

  DROP TABLE object CASCADE;
  DROP TABLE "$auth";
  DROP TABLE "$module";
  DROP TABLE "$sheet";
  DROP TABLE "$user";
  DROP FUNCTION to_camel_case(text);
*/

