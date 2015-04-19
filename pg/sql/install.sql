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
create or replace function request(obj json, init boolean default false) returns json as $$
  return (function () {
    if (init || !plv8._init) {
      plv8.execute('select init()'); 
    }

    return featherbone.request(obj);
  }());
$$ language plv8;

do $$
   plv8.execute('select init()');
   var sqlChk = "SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = $1;",
     sqlCmt = "COMMENT ON COLUMN %I.%I IS %L",
     sql, params, global;

   /* Create the base object table */
   if (!plv8.execute(sqlChk,['object']).length) {
     sql = "CREATE TABLE object (" +
       "_pk bigserial PRIMARY KEY," +
       "id text unique," +
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
       "object_pk bigint," +
       "role_pk bigint," +
       "is_inherited boolean default false," +
       "can_create boolean default false," +
       "can_read boolean default false," +
       "can_update boolean default false," +
       "can_delete boolean default false," +
       "can_execute boolean default false," +
       "CONSTRAINT \"$auth_object_pk_role_pk_is_inherited_key\" UNIQUE (object_pk, role_pk, is_inherited))";
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
     plv8.execute(sqlCmt.format(['$auth','can_execute','Can execute against the object']));
   };

   /* Create the feather table */
   if (!plv8.execute(sqlChk,['$feather']).length) {
     sql = "CREATE TABLE \"$feather\" (" +
       "CONSTRAINT feather_pkey PRIMARY KEY (_pk), " +
       "CONSTRAINT feather_id_key UNIQUE (id)) INHERITS (object)";
     plv8.execute(sql);
     plv8.execute("comment on table \"$feather\" is 'Internal table for storing class names'");
   }

   /* Create the settings table */
   if (!plv8.execute(sqlChk,['$settings']).length) {
     sql = "CREATE TABLE \"$settings\" (" +
       "name text default ''," +
       "data json default '{}'," +
       "etag text default ''," +
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
   featherbone.saveFeather([{
       name: "Role", 
       description: "User authorization role",
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
       name: "FolderChild", 
       description: "Child folder reference to a parent folder",
       properties: {
         parent: {
             description: "Parent folder",
             type: {
               relation: "Folder",
               childOf: "folders",
               isUnique: true
             }
         },
         child: {
             description: "Child folder",
             type: {
               relation: "Folder",
               properties: ["id"]
             }
         }
       }
     },{
       name: "Document",
       description: "Base document class",
       properties: {
         etag: {
             description: "Optimistic locking key",
             type: "string",
             defaultValue: "createId()"
         },
         folder: {
           description: "Document container",
           type: {
             relation: "Folder",
             properties: ["name", "description"]
           },
           defaultValue: "{\"id\": \"global\"}"
         }
       }
     },{
       name: "Log", 
       description: "Feather for logging all schema and data changes",
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
   ]);

   global = featherbone.request({
     name: "Folder",
     action: "GET",
     id: "global"
   });
     
   if (!Object.keys(global).length) {
     featherbone.request({
       name: "Folder",
       action: "POST",
       data: {
         id: "global",
         name: "Global folder",
         description: "Root folder for all objects"
       }
     })
   }

$$ language plv8;