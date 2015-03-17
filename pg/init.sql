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

create or replace function fp.init() returns void as $$
  return (function () {

    var _post,
      _patch,
      _delete,
      _get;

    // ..........................................................
    // NATIVE
    //

    /**
      Return the text after the first dot.
    */
    String.prototype.hind = function () {
      return this.replace(/\w+\./i, '');
    }

    /**
      Return the text before the first dot.
    */
    String.prototype.ere = function () {
      return this.replace(/\.\w+/i, '');
    }

    /**
       Change sting with underscores '_' to camel case.
       @returns {String}
    */
    String.prototype.toCamelCase = function () {
      return this.replace (/(?:^|[-_])(\w)/g, function (_, c) {
        return c ? c.toUpperCase() : '';
      })
    }

    /**
       Change a camel case string to snake case.
       @returns {String} The argument modified
    */
    String.prototype.toSnakeCase = function () {
      return this.replace((/([a-z])([A-Z])/g), '$1_$2').toLowerCase();
    }

    // ..........................................................
    // FP
    //

    plv8.FP = FP = {};

    /**
      Create or update a persistence class. This function is idempotent.

      Example payload:
          {
             "nameSpace": "FP",
             "className": "Contact",
             "description": "Contact data about a person",
             "properties": [
               {
                 "action": "add",
                 "name": "fullName",
                 "description": "Full name",
                 "type": "String",
                 "isRequired": true,
                 "defaultValue": ""
               },
               {
                 "name": "birthDate",
                 "description": "Birth date",
                 "type": "Date"
               },
               {
                 "name": "isMarried",
                 "description": "Marriage status",
                 "type": "Boolean",
                 "isRequired": true
               },
               {
                 "name": "dependents",
                 "description": "Number of dependents",
                 "type": "Number",
                 "isRequired": true,
                 "defaultValue": 0
               }
             ]
          }
 
     * @param {Object} Class specification payload.
     * @return {String}
    */
    FP.saveClass = function (obj) {
      obj = obj || {};

      var schema = (obj.nameSpace || 'fp').toSnakeCase(),
        table = obj.className ? obj.className.toSnakeCase() : false,
        inheritSchema = (obj.inherits ? obj.inherits.ere() || "fp" : "fp").toSnakeCase(),
        inheritTable = (obj.inherits ? obj.inherits.hind() : 'object').toSnakeCase(),
        sql = "select * from pg_tables where schemaname = $1 and tablename = $2;",
        sqlChk = "select * " +
         "from pg_class c, pg_namespace n, pg_attribute a, pg_type t " +
         "where c.relname = $1 " +
         " and n.nspname = $2 " +
         " and a.attname = $3 " +
         " and n.oid = c.relnamespace " +
         " and a.attnum > 0 " +
         " and a.attrelid = c.oid " +
         " and a.atttypid = t.oid; ",
        args = [schema, table, table + "_pkey", table + "_guid_key", inheritSchema, inheritTable],
        actions = ["add", "drop"],
        types = {
          Object: "json", 
          Array: "json", 
          String: "text", 
          Number: "numeric", 
          Date: "timestamp with time zone",
          Boolean: "boolean"
        },
        result = true,
        found,
        i;

      if (!table) { return false };

      /** Edit table **/
      if (!plv8.execute(sql, [schema, table]).length) {
        sql = FP.formatSql("create table %I.%I(constraint %I primary key (id), constraint %I unique (guid)) inherits (%I.%I)", args);
        plv8.execute(sql);
      }

      if (obj.description) { 
        sql = FP.formatSql("comment on table %I.%I is %L;", [schema, table, obj.description]);
        plv8.execute(sql);
      }

      /** Edit columns **/
       for (i = 0; i < obj.properties.length; i++) {
        var prop = obj.properties[i],
          action = prop.action || "add",
          type = prop.type,
          name = prop.name ? prop.name.toSnakeCase() : false,
          args = [schema, table, action];

        if (!name || actions.indexOf(action) === -1) {
          result = false;
          break;
        }

        args.push(name);
        found = plv8.execute(sqlChk, [table, schema, name]).length;

        /** Add to this switch to add support for more alter actions in the future**/
        switch (action)
        {
        case "add":
          if (Object.keys(types).indexOf(type) === -1) {
            result = false;
          } else {
            if (!found) {
              sql += FP.formatSql("alter table %I.%I %I column %I " + types[type], args);
              sql += prop.isRequired ? " not null;" : ";";
            }
            if (prop.description) {
              sql += FP.formatSql("comment on column %I.%I.%I is %L;", [schema, table, name, prop.description]);
            }
          }
          break;
        case "drop":
          if (found) {
            sql += FP.formatSql("alter table %I.%I %I column if exists %I;", args);
          }
          break;
        }
        if (!result) { break }
      }

      if (result) { plv8.execute(sql); }

      return true;
    };

    /**
      Return a universally unique identifier.

      From http://stackoverflow.com/a/8809472/251019
      @return {String}
    */
    FP.createUuid = function () {
      var d = new Date().getTime(),
        uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (d + Math.random() * 16) % 16 | 0;
          d = Math.floor(d / 16);
          return (c === 'x' ? r : (r&0x7|0x8)).toString(16);
        });

      return uuid;
    };

    /**
      Remove a class from the database.

      * @param {Object} Object describing object to remove.
      * @return {String}
    */
    FP.deleteClass = function (obj) {
      obj = obj || {};

      var schema = (obj.nameSpace || 'fp').toSnakeCase(),
        table = obj.className ? obj.className.toSnakeCase() : false,
        sql = "select * from pg_tables where schemaname = $1 and tablename = $2;",
        args = [schema, table];

      if (!table || !plv8.execute(sql, args).length) { return false };

      sql = FP.formatSql("drop table %I.%I", args);
      plv8.execute(sql);
      
      return true;
    };

    /**
     * Escape strings to prevent sql injection
       http://www.postgresql.org/docs/9.1/interactive/functions-string.html#FUNCTIONS-STRING-OTHER
     *
     * @param {String} A string with tokens to replace.
     * @param {Array} Array of replacement strings.
     * @return {String} Escaped string.
    */
    FP.formatSql = function (str, ary) {
      var params = [],
        i;

      ary = ary || [];
      ary.unshift(str);
      for (i = 0; i < ary.length; i++) {
        params.push("$" + (i + 1));
      };

      return plv8.execute("select format(" + params.toString(",") + ")", ary)[0].format;
    };

    /**
      Return the current user.

      @return {String}
    */
    FP.getCurrentUser = function () {
      return plv8.execute("select current_user as user;")[0].user;
    };
    
    /**
      Post.

      Example payload:
          {
             "nameSpace": "FP",
             "className": "Contact",
             "action": "POST",
             "value": {
               "guid": "dc9d03f9-a539-4eca-f008-1178f19f56ad",
               "created": "2015-04-26T12:57:57.896Z",
               "createdBy": "admin",
               "updated": "2015-04-26T12:57:57.896Z",
               "updatedBy": "admin",
               "fullName": "John Doe",
               "birthDate": "1970-01-01T00:00:00.000Z",
               "isMarried": true,
               "dependentes": 2
             }
          }

      @return {String}
    */
    FP.persist = function (obj) {
      switch (obj.action)
      {
      case "POST":
        return _post(obj);
        break;
      case "PATCH":
        return false;
        break;
      case "DELETE":
        return _delete(obj);
        break;
      case "GET":
        return false;
        break;
      }
    };

    // ..........................................................
    // Private
    //

    /** private */
    _post = function (obj) {
      var schema = (obj.nameSpace || 'fp').toSnakeCase(),
        table = obj.className ? obj.className.toSnakeCase() : false,
        keys = Object.keys(obj.value),
        args = [schema, table],
        tokens = [],
        params = [],
        values = [],
        sql,
        i;

      for (i = 0; i < keys.length; i++) {
        args.push(keys[i].toSnakeCase());
        tokens.push("%I");
        params.push("$" + (i + 1));
        values.push(obj.value[keys[i]]);
      }

      sql = FP.formatSql("insert into %I.%I (" + tokens.toString(",") + ") values (" + params.toString(",") + ") returning *;", args);
      result = plv8.execute(sql, values)[0];
      delete result.id;
      
      return result;
    };

    /** private */
    _delete = function (obj) {
      var schema = (obj.nameSpace || 'fp').toSnakeCase(),
        table = obj.className ? obj.className.toSnakeCase() : false,
        args = [schema, table],
        sql = FP.formatSql("update %I.%I set is_deleted = true where guid=$1;", args);

      plv8.execute(sql, [obj.guid]);
      
      return true;
    }

    plv8._init = true;

  }());
$$ language plv8;