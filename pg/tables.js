/**
    Featherbone is a JavaScript based persistence framework for building object relational database applications
    
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
var sqlChk = "SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = $1;",
    user = plv8.execute("SELECT CURRENT_USER")[0].current_user,
    sql, params, global, role, req;

/* Create the base object table */
if (!plv8.execute(sqlChk,['object']).length) {
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
    "CREATE OR REPLACE VIEW _object AS SELECT * FROM object;"
    plv8.execute(sql);
};

/* Create the object auth table */
if (!plv8.execute(sqlChk,['$auth']).length) {
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
    plv8.execute(sql);
};

/* Create the model table */
if (!plv8.execute(sqlChk,['$model']).length) {
    sql = "CREATE TABLE \"$model\" (" +
    "is_child boolean," +
    "parent_pk bigint," +
    "CONSTRAINT model_pkey PRIMARY KEY (_pk), " +
    "CONSTRAINT model_id_key UNIQUE (id)) INHERITS (object);" +
    "COMMENT ON TABLE \"$model\" is 'Internal table for storing class names';";
    plv8.execute(sql);
}

/* Create the object object folder table */
if (!plv8.execute(sqlChk,['$objectfolder']).length) {
    sql = "CREATE TABLE \"$objectfolder\" (" +
    "object_pk bigint PRIMARY KEY," +
    "folder_pk bigint);" +
    "COMMENT ON TABLE \"$objectfolder\" IS 'Table for storing object folder locations';" +
    "COMMENT ON COLUMN \"$objectfolder\".object_pk IS 'Object key';" +
    "COMMENT ON COLUMN \"$objectfolder\".folder_pk IS 'Folder key';";
    plv8.execute(sql);
};

/* Create the module table */
if (!plv8.execute(sqlChk,['$module']).length) {
    sql = "CREATE TABLE \"$module\" (" +
    "name text PRIMARY KEY," +
    "script text," +
    "is_global boolean," +
    "version text);" +
    "COMMENT ON TABLE \"$module\" IS 'Internal table for storing JavaScript';" +
    "COMMENT ON COLUMN \"$module\".name IS 'Primary key';" +
    "COMMENT ON COLUMN \"$module\".script IS 'JavaScript content';" +
    "COMMENT ON COLUMN \"$module\".is_global IS 'Create a global variable using the name of this module';" +
    "COMMENT ON COLUMN \"$module\".version IS 'Version number';";
    plv8.execute(sql);
}

/* Create the user table */
if (!plv8.execute(sqlChk,['$user']).length) {
    sql = "CREATE TABLE \"$user\" (" +
    "username text PRIMARY KEY," +
    "is_super boolean);" +
    "COMMENT ON TABLE \"$user\" IS 'Internal table for storing supplimental user information';" +
    "COMMENT ON COLUMN \"$user\".username IS 'System user';" +
    "COMMENT ON COLUMN \"$user\".is_super IS 'Indicates whether user is super user';";
    plv8.execute(sql);
    plv8.execute("INSERT INTO \"$user\" VALUES ($1, true)", [user]);
}

/* Create the settings table */
if (!plv8.execute(sqlChk,['$settings']).length) {
    sql = "CREATE TABLE \"$settings\" (" +
    "name text," +
    "data json," +
    "etag text," +
    "CONSTRAINT settings_pkey PRIMARY KEY (_pk), " +
    "CONSTRAINT settings_id_key UNIQUE (id)) INHERITS (object);" +
    "COMMENT ON TABLE \"$settings\" IS 'Internal table for storing system settings'"; +
    "COMMENT ON COLUMN \"$settings\".name IS 'Name of settings';" +
    "COMMENT ON COLUMN \"$settings\".data IS 'Object containing settings';";
    plv8.execute(sql);
    sql = "INSERT INTO \"$settings\" VALUES (nextval('object__pk_seq'), $1, now(), CURRENT_USER, now(), CURRENT_USER, false, $2, $3);";
    params = [
    'catalog',
    'catalog',
    {"Object": {
        "description": "Abstract object class from which all models will inherit",
        "discriminator": "objectType",
        "properties": {
            "id": {
              "description": "Surrogate key",
              "type": "string",
              "defaultValue": "createId()"},
            "created": {
              "description": "Create time of the record",
              "type": "date",
              "defaultValue": "now()"},
            "createdBy": {
              "description": "User who created the record",
              "type": "string",
              "defaultValue": "getCurrentUser()"},
            "updated": {
              "description": "Last time the record was updated",
              "type": "date",
            "defaultValue": "now()"},
              "updatedBy": {
              "description": "User who created the record",
              "type": "string",
              "defaultValue": "getCurrentUser()"},
            "isDeleted": {
              "description": "Indicates the record is no longer active",
              "type": "boolean"},
            "objectType": {
              "description": "Discriminates which inherited object type the object represents",
              "type": "string"}
            }
        }
    }
    ]
    plv8.execute(sql, params);
}

/** Drop everything

  DROP TABLE object CASCADE;
  DROP TABLE "$auth";
  DROP TABLE "$objectfolder";
  DROP TABLE "$module";
  DROP TABLE "$user";
  DROP FUNCTION init();
  DROP FUNCTION request(json, boolean);
  DROP FUNCTION to_camel_case(text, boolean);

*/

