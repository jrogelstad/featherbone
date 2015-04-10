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
     sql,
     params;

   /* Create the base object table */
   if (!plv8.execute(sqlChk,['object']).length) {
     sql = "CREATE TABLE object (" +
       "_pk bigserial PRIMARY KEY," +
       "id text unique," +
       "created timestamp with time zone," +
       "created_by text," +
       "updated timestamp with time zone," +
       "updated_by text," +
       "etag text," +
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

   /* Create the settings table */
   if (!plv8.execute(sqlChk,['"$settings"']).length) {
     sql = "CREATE TABLE \"$settings\" (" +
       "name text default ''," +
       "data json default '{}'," +
       "CONSTRAINT settings_pkey PRIMARY KEY (_pk), " +
       "CONSTRAINT settings_id_key UNIQUE (id)) INHERITS (object)";
     plv8.execute(sql);
     plv8.execute("comment on table \"$settings\" is 'Internal table for storing system settings'");
     plv8.execute(sqlCmt.format(['$settings','name','Name of settings']));
     plv8.execute(sqlCmt.format(['$settings','data','Object containing settings']));
     sql = "INSERT INTO \"$settings\" VALUES (nextval('object__pk_seq'), $1, now(), CURRENT_USER, now(), CURRENT_USER, $2, false, $3, $4);";
     params = [
       featherbone.createId(),
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
             "etag": {
               "description": "Optimistic lock key",
               "type": "string",
               "defaultValue": "createId()"}
             }
          }
       }
     ]
     plv8.execute(sql, params);
   }

   /* Create some foundation classes */
   featherbone.saveClass([{
       name: "Document",
       description: "Base document class"
     },{
       name: "log", 
       description: "Class for logging all schema and data changes",
       properties: {
         parent: {
            description: "Parent reference",
            type: {
                relation: "Document",
                childOf: "changeLog"
            }
         },
         change: {
             description: "Patch formatted json indicating changes",
             type: "object"
         }
       }
     }
   ]);

$$ language plv8;