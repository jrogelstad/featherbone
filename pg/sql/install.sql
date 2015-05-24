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

/** Expose certain js functions to the database for use as defaults **/
CREATE OR REPLACE FUNCTION request(obj json, init boolean default false) RETURNS json as $$
  return (function () {
    if (init || !plv8._init) {
      plv8.execute('select init()'); 
    }

    return featherbone.request(obj);
  }());
$$ LANGUAGE plv8;

DO $$
   plv8.execute('SELECT init()');

   var sqlChk = "SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = $1;",
     sqlCmt = "COMMENT ON COLUMN %I.%I IS %L",
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
       "is_deleted boolean)";
     plv8.execute(sql);
     plv8.execute("COMMENT ON TABLE object IS 'Abstract object class from which all other classes will inherit'");
     plv8.execute(sqlCmt.format(['object','_pk','Internal primary key']));
     plv8.execute(sqlCmt.format(['object','id','Surrogate key']));
     plv8.execute(sqlCmt.format(['object','created','Create time of the record']));
     plv8.execute(sqlCmt.format(['object','created_by','User who created the record']));
     plv8.execute(sqlCmt.format(['object','updated','Last time the record was updated']));
     plv8.execute(sqlCmt.format(['object','updated_by','Last user who created the record']));
     plv8.execute(sqlCmt.format(['object','is_deleted','Indicates the record is no longer active']));
     plv8.execute("CREATE OR REPLACE VIEW _object AS SELECT * FROM object;");
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
       "CONSTRAINT \"$auth_object_pk_role_pk_is_inherited__is_membe	r_auth_key\" UNIQUE (object_pk, role_pk, is_inherited, is_member_auth))";
     plv8.execute(sql);
     plv8.execute("COMMENT ON TABLE \"$auth\" IS 'Table for storing object level authorization information'");
     plv8.execute(sqlCmt.format(['$auth','pk','Primary key']));
     plv8.execute(sqlCmt.format(['$auth','object_pk','Primary key for object authorization applies to']));
     plv8.execute(sqlCmt.format(['$auth','role_pk','Primary key for role authorization applies to']));
     plv8.execute(sqlCmt.format(['$auth','is_inherited','Authorization is inherited from a parent folder']));
     plv8.execute(sqlCmt.format(['$auth','can_create','Can create the object']));
     plv8.execute(sqlCmt.format(['$auth','can_read','Can read the object']));
     plv8.execute(sqlCmt.format(['$auth','can_update','Can update the object']));
     plv8.execute(sqlCmt.format(['$auth','can_delete','Can delete the object']));
     plv8.execute(sqlCmt.format(['$auth','is_member_auth','Is authorization for members of a parent']));
   };

   /* Create the feather table */
   if (!plv8.execute(sqlChk,['$feather']).length) {
     sql = "CREATE TABLE \"$feather\" (" +
       "is_child boolean," +
       "parent_pk bigint," +
       "CONSTRAINT feather_pkey PRIMARY KEY (_pk), " +
       "CONSTRAINT feather_id_key UNIQUE (id)) INHERITS (object)";
     plv8.execute(sql);
     plv8.execute("comment on table \"$feather\" is 'Internal table for storing class names'");
   }

   /* Create the user table */
   if (!plv8.execute(sqlChk,['$user']).length) {
     sql = "CREATE TABLE \"$user\" (" +
       "username text PRIMARY KEY," +
       "is_super boolean)";
     plv8.execute(sql);
     plv8.execute("comment on table \"$user\" is 'Internal table for storing supplimental user information'");
     plv8.execute(sqlCmt.format(['$user','username','System user']));
     plv8.execute(sqlCmt.format(['$user','username','Indicates whether user is super user']));

     plv8.execute("INSERT INTO \"$user\" VALUES ($1, true)", [user]);
   }

   /* Create the settings table */
   if (!plv8.execute(sqlChk,['$settings']).length) {
     sql = "CREATE TABLE \"$settings\" (" +
       "name text," +
       "data json," +
       "etag text," +
       "CONSTRAINT settings_pkey PRIMARY KEY (_pk), " +
       "CONSTRAINT settings_id_key UNIQUE (id)) INHERITS (object)";
     plv8.execute(sql);
     plv8.execute("comment on table \"$settings\" is 'Internal table for storing system settings'");
     plv8.execute(sqlCmt.format(['$settings','name','Name of settings']));
     plv8.execute(sqlCmt.format(['$settings','data','Object containing settings']));
     sql = "INSERT INTO \"$settings\" VALUES (nextval('object__pk_seq'), $1, now(), CURRENT_USER, now(), CURRENT_USER, false, $2, $3);";
     params = [
       featherbone.createId(),
       'catalog',
       {"Object": {
         "description": "Abstract object class from which all other classes will inherit",
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
             }
          }
       }
     ]
     plv8.execute(sql, params);
   }

   /* Create some foundation classes */
   featherbone.request({
     action: "POST",
     name: "saveFeather",
     user: user,
     data: [[{
       name: "Role", 
       description: "User authorization role",
       authorization: false,
       properties: {
         name: {
             description: "Name",
             type: "string"
         },
         description: {
             description: "Description",
             type: "string"
         }
       }
     },{
       name: "RoleMember", 
       description: "Member reference to a parent role",
       authorization: false,
       properties: {
         parent: {
             description: "Parent role",
             type: {
               relation: "Role",
               childOf: "members"
             }
         },
         member: {
             description: "member",
             type: "string"
         }
       }
     },{
       name: "Folder", 
       description: "Container of parent objects",
       authorization: false,
       properties: {
         owner: {
             description: "Owner of the document",
             type: "string",
             defaultValue: "getCurrentUser()"
         },
         name: {
             description: "Name",
             type: "string"
         },
         description: {
             description: "Description",
             type: "string"
         }
       }
     },{
       name: "Document",
       description: "Base document class",
       authorization: false,
       properties: {
         owner: {
             description: "Owner of the document",
             type: "string",
             defaultValue: "getCurrentUser()"
         },
         etag: {
             description: "Optimistic locking key",
             type: "string",
             defaultValue: "createId()"
         }
       }
     },{
       name: "Log", 
       description: "Feather for logging all schema and data changes",
       authorization: false,
       properties: {
         objectId: {
             description: "Object change was performed against",
             type: "string"
         },
         action: {
             description: "Action performed",
             type: "string"
         },
         change: {
             description: "Patch formatted json indicating changes",
             type: "object"
         }
       }
     }
   ]]}, true);

   /* Create the object auth table */
   if (!plv8.execute(sqlChk,['$objectfolder']).length) {
     sql = "CREATE TABLE \"$objectfolder\" (" +
       "object_pk bigint PRIMARY KEY," +
       "folder_pk bigint);" +
       "ALTER TABLE \"$objectfolder\" ADD FOREIGN KEY (folder_pk) REFERENCES folder (_pk);"
     plv8.execute(sql);
     plv8.execute("COMMENT ON TABLE \"$objectfolder\" IS 'Table for storing object folder locations'");
     plv8.execute(sqlCmt.format(['$auth','pk','Object key']));
     plv8.execute(sqlCmt.format(['$auth','object_pk','Folder key']));
   };

   /* Create default global folder */
   global = featherbone.request({
     name: "Folder",
     action: "GET",
     user: user,
     id: "global"
   }, true);

   if (!Object.keys(global).length) {
     featherbone.request({
       name: "Folder",
       action: "POST",
       user: user,
       folder: false,
       data: {
         id: "global",
         name: "Global folder",
         description: "Root folder for all objects"
       }
     }, true)
   }

   /* Create Everyone role */
   role = featherbone.request({
     name: "Role",
     action: "GET",
     user: user,
     id: "everyone"
   }, true);

   if (!Object.keys(role).length) {
     featherbone.request({
       name: "Role",
       action: "POST",
       user: user,
       folder: "global",
       data: {
         id: "everyone",
         name: "Everyone",
         description: "All users",
         members: [
           {member: user}
         ]
       }
     }, true);

     /* Grant everyone access to global folder */
     req = {
       action: "POST",
       name: "saveAuthorization",
       user: user,
       data: {
         id: "global",
         role: "everyone",
         isMember: true,
         actions: {
           canCreate: true,
           canRead: true,
           canUpdate: true,
           canDelete: true
         }
       }
     };

     /* Access to folder contents */
     featherbone.request(req);

     /* Access to folder itself */
     delete req.data.isMember;
     featherbone.request(req);

     /* Grant everyone access to other objects */
     req.data.id = "role";
     featherbone.request(req);
     req.data.id = "folder";
     featherbone.request(req);
     req.data.id = "log"
     featherbone.request(req);
   }

$$ LANGUAGE plv8;

/** Drop everything

  DROP TABLE object CASCADE;
  DROP TABLE "$auth";
  DROP TABLE "$objectfolder";
  DROP TABLE "$user";
  DROP FUNCTION request(json, boolean);

*/