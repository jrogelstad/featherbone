/**
    Framework for building object relational database apps

    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*jslint maxlen: 200 */
(function (exports) {
  exports.execute = function (obj) {
    var createCamelCase, createObject, createFeather, createAuth, createObjectfolder,
      createModule, createSettings, createUser, sqlCheck, done,
      sql, params;

    sqlCheck = function (table, callback) {
      var sqlChk = "SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = $1;";

      obj.client.query(sqlChk, [table], function (err, resp) {
        if (err) {
          callback(err);
          return;
        }

        callback(null, resp.rows.length > 0);
      });
    };

    // Create a camel case function
    createCamelCase = function (err) {
      sql = "CREATE OR REPLACE FUNCTION to_camel_case(str text) RETURNS text AS $$" +
        "SELECT replace(initcap($1), '_', '');" +
        "$$ LANGUAGE SQL IMMUTABLE;";
      obj.client.query(sql, createObject);
    };

    // Create the base object table
    createObject = function (err) {
      sqlCheck('object', function (err, exists) {
        if (err) {
          obj.callback(err);
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
    createAuth = function (err) {
      sqlCheck('$auth', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$auth\" (" +
            "pk serial PRIMARY KEY," +
            "object_pk bigint not null," +
            "role_pk bigint not null," +
            "is_inherited boolean not null," +
            "can_create boolean not null," +
            "can_read boolean not null," +
            "can_update boolean not null," +
            "can_delete boolean not null," +
            "is_member_auth boolean not null," +
            "CONSTRAINT \"$auth_object_pk_role_pk_is_inherited__is_member_auth_key\" UNIQUE (object_pk, role_pk, is_inherited, is_member_auth));" +
            "COMMENT ON TABLE \"$auth\" IS 'Table for storing object level authorization information';" +
            "COMMENT ON COLUMN \"$auth\".pk IS 'Primary key';" +
            "COMMENT ON COLUMN \"$auth\".object_pk IS 'Primary key for object authorization applies to';" +
            "COMMENT ON COLUMN \"$auth\".role_pk IS 'Primary key for role authorization applies to';" +
            "COMMENT ON COLUMN \"$auth\".is_inherited IS 'Authorization is inherited from a parent folder';" +
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
    createFeather = function (err) {
      sqlCheck('$feather', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$feather\" (" +
            "is_child boolean," +
            "parent_pk bigint," +
            "CONSTRAINT feather_pkey PRIMARY KEY (_pk), " +
            "CONSTRAINT feather_id_key UNIQUE (id)) INHERITS (object);" +
            "COMMENT ON TABLE \"$feather\" is 'Internal table for storing class names';";
          obj.client.query(sql, createObjectfolder);
          return;
        }
        createObjectfolder();
      });
    };

    // Create the object object folder table
    createObjectfolder = function (err) {
      sqlCheck('$objectfolder', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$objectfolder\" (" +
            "object_pk bigint PRIMARY KEY," +
            "folder_pk bigint);" +
            "COMMENT ON TABLE \"$objectfolder\" IS 'Table for storing object folder locations';" +
            "COMMENT ON COLUMN \"$objectfolder\".object_pk IS 'Object key';" +
            "COMMENT ON COLUMN \"$objectfolder\".folder_pk IS 'Folder key';";
          obj.client.query(sql, createModule);
          return;
        }

        createModule();
      });
    };

    // Create the module table
    createModule = function (err) {
      sqlCheck('$module', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$module\" (" +
            "name text PRIMARY KEY," +
            "script json," +
            "version text);" +
            "COMMENT ON TABLE \"$module\" IS 'Internal table for storing JavaScript';" +
            "COMMENT ON COLUMN \"$module\".name IS 'Primary key';" +
            "COMMENT ON COLUMN \"$module\".script IS 'JavaScript content';" +
            "COMMENT ON COLUMN \"$module\".version IS 'Version number';";
          obj.client.query(sql, createUser);
          return;
        }
        createUser();
      });
    };

    // Create the user table
    createUser = function (err) {
      sqlCheck('$user', function (err, exists) {
        if (err) {
          obj.callback(err);
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
              obj.callback(err);
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
    createSettings = function (err) {
      sqlCheck('$settings', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$settings\" (" +
            "name text," +
            "data json," +
            "etag text," +
            "CONSTRAINT settings_pkey PRIMARY KEY (_pk), " +
            "CONSTRAINT settings_id_key UNIQUE (id)) INHERITS (object);" +
            "COMMENT ON TABLE \"$settings\" IS 'Internal table for storing system settings';" +
            "COMMENT ON COLUMN \"$settings\".name IS 'Name of settings';" +
            "COMMENT ON COLUMN \"$settings\".data IS 'Object containing settings';";
          obj.client.query(sql, function (err, resp) {
            if (err) {
              obj.callback(err);
              return;
            }

            sql = "INSERT INTO \"$settings\" VALUES (nextval('object__pk_seq'), $1, now(), CURRENT_USER, now(), CURRENT_USER, false, $2, $3);";
            params = [
              "catalog",
              "catalog",
              JSON.stringify({
                "Object": {
                  "description": "Abstract object class from which all feathers will inherit",
                  "discriminator": "objectType",
                  "plural": "Objects",
                  "properties": {
                    "id": {
                      "description": "Surrogate key",
                      "type": "string",
                      "default": "createId()",
                      "isRequired": true,
                      "isReadOnly": true
                    },
                    "created": {
                      "description": "Create time of the record",
                      "type": "string",
                      "format": "dateTime",
                      "default": "now()",
                      "isReadOnly": true
                    },
                    "createdBy": {
                      "description": "User who created the record",
                      "type": "string",
                      "default": "getCurrentUser()",
                      "isReadOnly": true
                    },
                    "updated": {
                      "description": "Last time the record was updated",
                      "type": "string",
                      "format": "dateTime",
                      "default": "now()",
                      "isReadOnly": true
                    },
                    "updatedBy": {
                      "description": "User who created the record",
                      "type": "string",
                      "default": "getCurrentUser()",
                      "isReadOnly": true
                    },
                    "isDeleted": {
                      "description": "Indicates the record is no longer active",
                      "type": "boolean",
                      "isReadOnly": true
                    },
                    "objectType": {
                      "description": "Discriminates which inherited object type the object represents",
                      "type": "string",
                      "isRequired": true,
                      "isReadOnly": true
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
      obj.callback();
    };

    // Real work starts here
    createCamelCase();
  };

}(exports));

/** Drop everything

  DROP TABLE object CASCADE;
  DROP TABLE "$auth";
  DROP TABLE "$objectfolder";
  DROP TABLE "$module";
  DROP TABLE "$user";
  DROP FUNCTION to_camel_case(text);
*/

