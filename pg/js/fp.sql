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

create or replace function fp.load_fp() returns void as $$
/*global plv8: true, jsonpatch: true, featherbone: true, ERROR: true */
/*jslint nomen: true, plusplus: true, indent: 2, sloppy: true, todo: true, maxlen: 80*/
(function () {

  var _settings = {},
    _camelize,
    _curry,
    _getKey,
    _getKeys,
    _patch,
    _sanitize,
    _insert,
    _select,
    _update,
    _delete,
    _types = {
      object: {type: "json", defaultValue: {}},
      array: {type: "json", defaultValue: []},
      string: {type: "text", defaultValue: "''"},
      number: {type: "numeric", defaultValue: 0},
      date: {type: "timestamp with time zone", defaultValue: "minDate()"},
      boolean: {type: "boolean", defaultValue: "false"}
    };

  featherbone = {

    /**
      Return a unique identifier string.

      Moddified from https://github.com/google/closure-library
      @author arv@google.com (Erik Arvidsson)
      http://www.apache.org/licenses/LICENSE-2.0

      @return {String}
    */
    createId: function () {
      var x = 2147483648,
        d = new Date(),
        result = Math.floor(Math.random() * x).toString(36) +
          Math.abs(Math.floor(Math.random() * x) ^ d).toString(36);

      return _getKey(result) ? featherbone.createId() : result;
    },

    /**
      Check to see if an etag is current.

      * @param {String} Object id
      * @param {String} Object etag
      * @return {String}
    */

    checkEtag: function (id, etag) {
      var sql = "select etag from fp.object where id = $1",
        result = plv8.execute(sql, [id]);

      return result.length ? result[0].etag === etag : false;
    },

    /**
      Remove a class from the database.

      * @param {Object} Object describing object to remove.
      * @return {String}
    */
    deleteClass: function (obj) {
      obj = obj || {};

      var table = obj.name ? obj.name.toSnakeCase() : false,
        sql = "select * from pg_tables " +
          "where schemaname = 'fp' " +
          "  and tablename = $1;",
        catalog = featherbone.getSettings('catalog'),
        args = [table];

      if (!table || !plv8.execute(sql, args).length) { return false; }

      sql = ("drop table fp.%I").format(args);
      plv8.execute(sql);

      /* Update catalog settings */
      delete catalog[obj.name];
      featherbone.saveSettings("catalog", catalog);

      return true;
    },

    /**
      Return a class definition, including inherited properties.

      @param {String} Class name
      @param {Boolean} Include inherited or not. Defult = true.
      @return {String}
    */
    getClass: function (name, includeInherited) {
      var catalog = featherbone.getSettings('catalog'),
        appendParent = function (child, parent) {
          var klass = catalog[parent],
            klassProps = klass.properties,
            childProps = child.properties,
            key;

          if (parent !== "Object") {
            appendParent(child, klass.inherits || "Object");
          }

          for (key in klassProps) {
            if (klassProps.hasOwnProperty(key)) {
              if (childProps[key] === undefined) {
                childProps[key] = klassProps[key];
              }
            }
          }

          return child;
        },
        result = {name: name, inherits: "Object"},
        resultProps,
        klassProps,
        key;

      if (!catalog[name]) { return false; }

      /* Add other attributes after name */
      for (key in catalog[name]) {
        if (catalog[name].hasOwnProperty(key)) {
          result[key] = catalog[name][key];
        }
      }

      /* Want inherited properites before class properties */
      if (includeInherited !== false && name !== "Object") {
        result.properties = {};
        result = appendParent(result, result.inherits);
      } else {
        delete result.inherits;
      }

      /* Now add in local properties back in */
      klassProps = catalog[name].properties;
      resultProps = result.properties;
      for (key in klassProps) {
        if (klassProps.hasOwnProperty(key)) {
          resultProps[key] = klassProps[key];
        }
      }

      return result;
    },

    /**
      Return the current user.

      @return {String}
    */
    getCurrentUser: function () {
      return plv8.execute("select current_user as user;")[0].user;
    },

    /**
      Return a date that is the lowest system date.

      @return {Date}
    */
    minDate: function () {
      return new Date(0);
    },

    /**
      Return a date that is the highest system date.

      @return {Date}
    */
    maxDate: function () {
      return new Date("2100-01-01T00:00:00.000Z");
    },


    /**
      Return a date that is the current time.

      @return {Date}
    */
    now: function () {
      return new Date();
    },

    /**
      Return settings.

      @param {String} Setting name
      @return {Object}
    */
    getSettings: function (name) {
      var sql = "select data from fp._settings where name = $1",
        result,
        rec;

      if (_settings[name]) {
        if (featherbone.checkEtag(_settings[name].id, _settings[name].etag)) {
          return _settings[name];
        }
      }

      result = plv8.execute(sql, [name]);
      if (result.length) {
        rec = result[0];
        _settings[name] = {
          id: rec.id,
          etag: rec.etag,
          data: rec.data
        };
      }

      return _settings[name].data;
    },

    /**
      Request.

      Example payload:
          {
             "name": "Contact",
             "action": "POST",
             "data": {
               "id": "1f8c8akkptfe",
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
    request: function (obj) {
      var prop = obj.name,
        result = {},
        args,
        fn;

      switch (obj.action) {
      case "GET":
        return _select(obj);
      case "POST":
        /* Handle if posting a function call */
        if (featherbone[prop] && typeof featherbone[prop] === "function") {
          args = Array.isArray(obj.data) ? obj.data : [obj.data];
          fn = _curry(featherbone[prop], args);
          result.value = fn();
          return result;
        }

        return _insert(obj);
      case "PATCH":
        return _patch(obj);
      case "DELETE":
        return _delete(obj);
      }
    },

    /**
      Create or update a persistence class. This function is idempotent. 
      Subsequent saves will automatically drop properties no longer present.

      Example payload:
       {
         "name": "Contact",
         "description": "Contact data about a person",
         "properties": {
           "fullName": {
             "description": "Full name",
             "type": "string"
          },
          "birthDate": {
            "description": "Birth date",
            "type": "date"
          },
          "isMarried": {
            "description": "Marriage status",
            "type": "boolean"
          },
          "dependents": {
            "description": "Number of dependents",
            "type": "number"
          }
        }
      }

     * @param {Object} Class specification payload.
     * @return {String}
    */
    saveClass: function (obj) {
      obj = obj || {};

      var table = obj.name ? obj.name.toSnakeCase() : false,
        inherits = (obj.inherits || "Object").toSnakeCase(),
        klass = featherbone.getClass(obj.name, false),
        catalog = featherbone.getSettings('catalog'),
        sql = "",
        sqlUpd,
        token,
        tokens = [],
        values = [],
        adds = [],
        args = [],
        fns = [],
        defaultValue,
        props,
        key,
        recs,
        type,
        err,
        i = 0,
        n = 0,
        p = 1;

      if (!table) { return false; }

      /* Create table if applicable */
      if (!klass) {
        sql = "create table fp.%I( " +
          "constraint %I primary key (_pk), " +
          "constraint %I unique (id)) " +
          "inherits (fp.%I);";
        tokens = tokens.concat([
          table,
          table + "_pkey",
          table + "_id_key",
          inherits
        ]);
      } else {
        /* Drop non-inherited columns not included in properties */
        for (key in klass.properties) {
          if (klass.properties.hasOwnProperty(key)) {
            if (!obj.properties[key]) {
              sql += "alter table fp.%I drop column %I;";
              tokens = tokens.concat([table, key.toSnakeCase()]);
            }
          }
        }
      }

      /* Add table description */
      if (obj.description) {
        sql += "comment on table fp.%I is %L;";
        tokens = tokens.concat([table, obj.description || ""]);
      }

      /* Add columns */
      props = obj.properties;
      for (key in props) {
        if (props.hasOwnProperty(key)) {
          type = typeof props[key].type === "string" ? _types[props[key].type] : props[key];

          if (type) {
            if (!klass || !klass.properties[key]) {
              sql += "alter table fp.%I add column %I ";

              if (type.type.relation) {
                sql += "integer;";
                token = "_{key}_{table}_pk"
                  .replace("{key}", key.toSnakeCase())
                  .replace("{table}", type.type.relation.toSnakeCase());
              } else {
                sql += type.type + ";";
                token = key.toSnakeCase();
                adds.push(key);
              }

              tokens = tokens.concat([table, token]);

              if (props[key].description) {
                sql += "comment on column fp.%I.%I is %L;";
                tokens = tokens.concat([table, token, props[key].description || ""]);
              }
            }
          } else {
            err = 'Invalid type "{type}" for property "{key}" on class "{name}"'
              .replace("{type}", props[key].type)
              .replace("{key}", key)
              .replace("{name}", obj.name);
            plv8.elog(ERROR, err);
          }
        }
      }

      /* Update schema */
      sql = sql.format(tokens);
      plv8.execute(sql);

      /* Populate defaults */
      if (adds.length) {
        values = [];
        tokens = [];
        args = [table];

        while (i < adds.length) {
          type = props[adds[i]].type;
          defaultValue = props[adds[i]].defaultValue ||
            _types[type].defaultValue;

          if (typeof defaultValue === "string" &&
              defaultValue.match(/\(\)$/)) {
            fns.push({
              col: adds[i].toSnakeCase(),
              defaultValue: defaultValue.replace(/\(\)$/, "")
            });
          } else {
            values.push(defaultValue);
            tokens.push("%I=$" + p);
            args.push(adds[i].toSnakeCase());
            p++;
          }
          i++;
        }

        if (values.length) {
          sql = "update fp.%I set {tokens};"
            .replace("{tokens}", tokens.join(","))
            .format(args);
          plv8.execute(sql, values);
        }

        /* Update function based defaults (one by one) */
        if (fns.length) {
          sql = "select _pk from fp.%I order by _pk offset $1 limit 1;"
            .format([table]);
          sqlUpd = "update fp.%I set {tokens} where _pk = $1";
          recs = plv8.execute(sql, [n]);
          tokens = [];
          args = [table];
          i = 0;

          while (i < fns.length) {
            tokens.push("%I=$" + (i + 2));
            args.push(fns[i].col);
            i++;
          }

          sqlUpd = sqlUpd.replace("{tokens}", tokens.join(",")).format(args);

          while (recs.length) {
            values = [recs[0]._pk];
            i = 0;
            n++;

            while (i < fns.length) {
              values.push(featherbone[fns[i].defaultValue]());
              i++;
            }

            plv8.execute(sqlUpd, values);
            recs = plv8.execute(sql, [n]);
          }
        }
      }

      /* Update catalog settings */
      catalog[obj.name] = obj;
      delete obj.name;
      featherbone.saveSettings("catalog", catalog);

      return true;
    },

    /**
      Create or upate settings.

      @return {String}
    */
    saveSettings: function (name, settings) {
      var sql = "select data from fp._settings where name = $1;",
        params = [name, settings],
        result,
        rec;

      result = plv8.execute(sql, [name]);

      if (result.length) {
        rec = result[0];

        if (settings.etag !== rec.etag) {
          plv8.elog(ERROR, 'Settings for "' + name + '" changed by another user. Save failed.');
        }

        sql = "update fp._settings set data = $2 where name = $1;";

        plv8.execute(sql, params);
      } else {
        sql = "insert into fp.settings (name, data) values ($1, $2);";
        plv8.execute(sql, params);
      }

      _settings[name] = settings;

      return true;
    }
  };

  // ..........................................................
  // Private
  //

  /** private */
  _camelize = function (obj) {
    var result = {},
      key;

    for (key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key.toCamelCase()] = obj[key];
      }
    }

    obj = result;

    return obj;
  };

  /** private */
  _curry = function (fn, args) {
    return function () {
      return fn.apply(this, args.concat([].slice.call(arguments)));
    };
  };

  /** private */
  _delete = function (obj) {
    plv8.execute("update fp.object set is_deleted = true where id=$1;", [obj.id]);

    return true;
  };

  /** private */
  _getKey = function (id, name) {
    name = name ? name.toSnakeCase() : 'object';

    var sql = ("select _pk from fp.%I where id = $1").format([name]),
      result = plv8.execute(sql, [id])[0];

    return result ? result._pk : undefined;
  };

  /** private */
  _getKeys = function (name, filter) {
    var sql = "select _pk from fp.%I ",
      tokens = [name.toSnakeCase()],
      criteria = filter.criteria || [],
      sort = filter.sort || [],
      params = [],
      ops = ["=", "!=", "<", ">", "<>", "~", "*~", "!~", "!~*"],
      result  = [],
      parts = [],
      part,
      order,
      op,
      i = 0,
      p = 1,
      n;

    /* Only return values if we have a filter */
    if (filter) {

      /* Process criteria */
      while (criteria[i]) {
        op = criteria[i].operator || "=";
        tokens.push(criteria[i].property.toSnakeCase());

        if (op === "IN") {
          n = criteria[i].value.length;
          part = [];
          while (n--) {
            params.push(criteria[i].value[n]);
            part.push("$" + p++);
          }
          part = " %I IN (" + part.join(",") + ")";
        } else {
          if (ops.indexOf(op) === -1) {
            plv8.elog(ERROR, 'Unknown operator "' + criteria[i].operator + '"');
          }
          params.push(criteria[i].value);
          part = " %I" + op + "$" + p++;
          i++;
        }
        parts.push(part);
        i++;
      }

      if (parts.length) {
        sql += " where " + parts.join(" and ");
      }

      /* Process sort */
      i = 0;
      parts = [];
      while (sort[i]) {
        order = (sort[i].order || "ASC").toUpperCase();
        if (order !== "ASC" && order !== "DESC") {
          plv8.elog(ERROR, 'Unknown operator "' + order + '"');
        }
        tokens.push(sort[i].property);
        parts.push(" %I " + order);
        i++;
      }

      if (parts.length) {
        sql += " order by " + parts.join(",");
      }

      /* Process offset and limit */
      if (filter.offset) {
        sql += " offset $" + p++;
        params.push(filter.offset);
      }

      if (filter.limit) {
        sql += " limit $" + p;
        params.push(filter.limit);
      }

      sql = sql.format(tokens);
      return plv8.execute(sql, params).map(function (rec) {
        return rec._pk;
      });
    }

    return result;
  };

  /** private */
  _insert = function (obj) {
    var data = JSON.parse(JSON.stringify(obj.data)),
      klass = featherbone.getClass(obj.name),
      args = [obj.name.toSnakeCase()],
      tokens = [],
      params = [],
      values = [],
      defaultValue,
      p = 1,
      key,
      col,
      props,
      prop,
      result,
      value,
      sql,
      err;

    /* Check id for existence and uniqueness and regenerate if any problem */
    data.id = data.id === undefined || _getKey(data.id) !== undefined ?
        featherbone.createId() : data.id;

    /* Set some system controlled values */
    data.created = data.updated = featherbone.now();
    data.createdBy = featherbone.getCurrentUser();
    data.updatedBy = featherbone.getCurrentUser();
    data.etag = featherbone.createId();

    /* Build values */
    props = klass.properties;
    for (key in props) {
      if (props.hasOwnProperty(key)) {
        prop = props[key];

        /* Handle relations */
        if (typeof prop.type === "object") {
          col = "_{key}_{table}_pk"
            .replace("{key}", key.toSnakeCase())
            .replace("{table}", prop.type.relation.toSnakeCase());
          value = data[key] !== undefined ? _getKey(data[key].id) : -1;
          if (value === undefined) {
            err = 'Relation not found in "{relation}" for "{key}" with id "{id}"'
              .replace("{relation}", prop.type.relation)
              .replace("{key}", key)
              .replace("{id}", data[key].id);
            plv8.elog(ERROR, err);
          }

        /* Handle regular tyes */
        } else {
          defaultValue = prop.defaultValue;
          col = key.toSnakeCase();

          /* If the request had a value */
          if (data[key]) {
            value = data[key];
          /* If we have a class specific default that calls a function */
          } else if (defaultValue &&
              typeof defaultValue === "string" &&
              defaultValue.match(/\(\)$/)) {
            value = featherbone[defaultValue.replace(/\(\)$/, "")]();
          /* If we have a class specific default value */
          } else if (defaultValue !== undefined) {
            value = defaultValue;
          /* Use default for type */
          } else {
            value = _types[prop.type].defaultValue;
          }
        }

        args.push(col);
        tokens.push("%I");
        values.push(value);
        params.push("$" + p);
        p++;
      }
    }

    sql = "insert into fp.%I ({columns}) values ({values}) returning *;"
      .replace("{columns}", tokens.toString(","))
      .replace("{values}", params.toString(","))
      .format(args);

    /* Execute */
    result = plv8.execute(sql, values)[0];

    return jsonpatch.compare(obj.data, _sanitize(result));
  };

  /** private */
  _patch = function (obj) {
    var patches = obj.data,
      oldRec = _select(obj),
      klass = featherbone.getClass(obj.name),
      newRec;

    if (!Object.keys(oldRec).length) { return false; }
    newRec = JSON.parse(JSON.stringify(oldRec));
    jsonpatch.apply(newRec, patches);

    return _update(klass, obj.id, oldRec, newRec);
  };

  /** private */
  _sanitize = function (obj) {
    var isArray = Array.isArray(obj),
      ary = isArray ? obj : [obj],
      i = ary.length;

    while (i--) {
      delete ary[i]._pk;
      ary[i] = _camelize(ary[i]);
      /* Copy to convert dates back to string for accurate comparisons */
      ary[i] = JSON.parse(JSON.stringify(ary[i]));
    }

    return isArray ? obj : ary[0];
  };

  /** private */
  _select = function (obj) {
    var table = obj.name.toSnakeCase(),
      props = obj.properties || [],
      i = props.length,
      tokens = [],
      result = {},
      cols,
      sql,
      pk;

    if (i) {
      while (i--) {
        tokens.push("%I");
        props[i] = props[i].toSnakeCase();
      }
      cols = tokens.toString(",");
    } else {
      cols = "*";
    }
    props.push(table);

    sql = ("select " + cols + " from fp.%I").format(props);

    /* Get one result by key */
    if (obj.id) {
      pk = _getKey(obj.id, obj.name);
      if (pk === undefined) { return {}; }
      sql +=  " where _pk = $1";

      result = plv8.execute(sql, [pk])[0];

    /* Get a filtered result */
    } else if (obj.filter) {
      pk = _getKeys(obj.name, obj.filter);

      if (pk.length) {
        tokens = [];
        i = 0;

        while (pk[i]) {
          i++;
          tokens.push("$" + i);
        }

        sql += " where _pk in (" + tokens.toString(",") + ")";
        result = plv8.execute(sql, pk);
      }

    /* Get all results */
    } else {
      result = plv8.execute(sql);
    }

    return _sanitize(result);
  };

  _update = function (klass, id, oldRec, newRec) {
    var tokens = [klass.name.toSnakeCase()],
      pk = _getKey(id),
      params = [],
      ary = [],
      p = 1,
      result,
      updRec,
      props,
      key,
      sql;

    if (jsonpatch.compare(oldRec, newRec).length) {
      props = klass.properties;
      updRec = JSON.parse(JSON.stringify(newRec));
      updRec.updated = new Date().toJSON();
      updRec.updatedBy = featherbone.getCurrentUser();
      updRec.etag = featherbone.createId();

      for (key in props) {
        if (props.hasOwnProperty(key)) {
          if (typeof key.type === "object") {
            /* TODO: iterate through relation */
          } else if (updRec[key] !== oldRec[key]) {
            tokens.push(key.toSnakeCase());
            ary.push("%I = $" + p);
            params.push(updRec[key]);
            p++;
          }
        }
      }

      sql = "update fp.%I set {cols} where _pk = ${num} returning *;"
        .replace("{cols}", ary.join(","))
        .replace("{num}", p)
        .format(tokens);

      params.push(pk);
      result = _sanitize(plv8.execute(sql, params));
      result = JSON.parse(JSON.stringify(result[0]));

      return jsonpatch.compare(newRec, result);
    }
  };

}());
$$ language plv8;