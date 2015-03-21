/**
    Featherbonejs is a JavaScript based persistence framework for building object relational database applications
    
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
create or replace function fp.get_current_user() returns text as $$
  return (function () {
    if (!plv8._init) { plv8.execute('select fp.init()'); }

    return FP.getCurrentUser();
  }());
$$ language plv8;

create or replace function fp.request(obj json) returns json as $$
  return (function () {
    /** if (!plv8._init) { */
    plv8.execute('select fp.init()'); 
    /**} */

    return FP.request(obj);
  }());
$$ language plv8;

/** Create the base object table **/
do $$
   plv8.execute('select fp.init()');
   var sql = "select * from pg_tables where schemaname = 'fp' and tablename = 'object';";
   
   if (!plv8.execute(sql).length) {
     sql = "create table fp.object (" +
       "_pk bigserial primary key," +
       "id text not null unique," +
       "created timestamp with time zone not null default now()," +
       "created_by text not null default fp.get_current_user()," +
       "updated timestamp with time zone not null default now()," +
       "updated_by text not null default fp.get_current_user()," +
       "is_deleted boolean not null default false)";
     plv8.execute(sql);
     plv8.execute("comment on table fp.object is 'Abstract object from which all objects will inherit.'");
     sql = "comment on column %I.%I.%I is %L";
     plv8.execute(FP.format(sql, ['fp','object','_pk','Internal primary key']));
     plv8.execute(FP.format(sql, ['fp','object','id','Surrogate key']));
     plv8.execute(FP.format(sql, ['fp','object','created','Create time of the record']));
     plv8.execute(FP.format(sql, ['fp','object','created_by','User who created the record']));
     plv8.execute(FP.format(sql, ['fp','object','updated','Last time the record was updated']));
     plv8.execute(FP.format(sql, ['fp','object','updated_by','Last user who created the record']));
   };
$$ language plv8;