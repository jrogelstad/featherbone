/**
    Featherbone is a JavaScript based persistence framework for building object
    relational database applications
    
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

/*global plv8 */
(function (exports) {

  require("../common/extend-string");

  var that, createView, curry, getKey, getKeys, isChildModel,
    propagateViews, propagateAuth, currentUser, setCurrentUser, buildAuthSql,
    relationColumn, sanitize, doInsert, doSelect, doUpdate, doDelete,
    f = require("../common/core"),
    jsonpatch = require("fast-json-patch"),
    format = require("pg-format"),
    settings = {},
    types = {
      object: {type: "json", default: {}},
      array: {type: "json", default: []},
      string: {type: "text", default: "''"},
      integer: {type: "integer", default: 0},
      number: {type: "numeric", default: 0},
      date: {type: "date", default: "minDate()"},
      boolean: {type: "boolean", default: "false"}
    },
    formats = {
      integer: {type: "integer", default: 0},
      long: {type: "bigint", default: 0},
      float: {type: "real", default: 0},
      double: {type: "double precision", default: 0},
      string: {type: "text", default: "''"},
      boolean: {type: "boolean", default: "false"},
      date: {type: "date", default: "minDate()"},
      dateTime: {type: "timestamp with time zone", default: "minDate()"},
      password: {type: "text", default: ""}
    },
    PRECISION_DEFAULT = 18,
    SCALE_DEFAULT = 6;

  /**
    * Escape strings to prevent sql injection
      http://www.postgresql.org/docs/9.1/interactive/functions-string.html
    *
    * @param {String} A string with tokens to replace.
    * @param {Array} Array of replacement strings.
    * @return {String} Escaped string.
  */
  String.prototype.format = function (ary) {
    var params = [],
      i = 0;

    ary = ary || [];
    ary.unshift(this);

    while (ary[i]) {
      i++;
      params.push("$" + i);
    }

    return curry(format, ary)();
  };

  that = {

    /**
      Check to see if an etag is current.

      * @param {Object} Payload
      * @param {String} [payload.id] Object id
      * @param {String} [payload.etag] Object etag
      * @param {Object} [payload.client] Database client
      * @param {String} [payload.callback] Callback
      * @return receiver
    */

    checkEtag: function (obj) {
      var sql = "SELECT etag FROM %I WHERE id = $1"
          .format([obj.name.toSnakeCase()]);

      obj.client.query(sql, [obj.id], function (err, resp) {
        var result;

        if (err) {
          obj.callback(err);
          return;
        }

        result = resp.rows.length ? resp.rows[0].etag === obj.etag : false;
        obj.callback(null, result);
      });

      return this;
    },

    /**
      Remove a class from the database.

      * @param {String | Array} Names(s) of model(s) to remove.
      * @return {Boolean}
    */
    deleteModel: function (names) {
      names = Array.isArray ? names : [names];

      var name, table, catalog, sql, rels, i, props, view, type, key,
        o = 0;

      while (o < names.length) {
        name = names[o];
        table = name.toSnakeCase();
        catalog = that.getSettings('catalog');
        sql = ("DROP VIEW %I; DROP TABLE %I;" +
          "DELETE FROM \"$model\" WHERE id=$1;")
          .format(["_" + table, table]);
        rels = [];
        i = 0;

        if (!table || !catalog[name]) {
          throw "Class not found";
        }

        /* Drop views for composite types */
        props = catalog[name].properties;
        for (key in props) {
          if (props.hasOwnProperty(key) &&
              typeof props[key].type === "object") {
            type = props[key].type;

            if (type.properties) {
              view = "_" + name.toSnakeCase() + "$" + key.toSnakeCase();
              sql += "DROP VIEW %I;".format([view]);
            }

            if (type.childOf && catalog[type.relation]) {
              delete catalog[type.relation].properties[type.childOf];
              rels.push(type.relation);
            }
          }
        }

        /* Update catalog settings */
        delete catalog[name];
        that.saveSettings("catalog", catalog);

        /* Update views */
        while (i < rels.length) {
          createView(rels[i], true);
          i++;
        }

        /* Drop table(s) */
        plv8.execute(sql, [table]);

        o++;
      }

      return true;
    },

    /**
      Return the current user.

      @return {String}
    */
    getCurrentUser: function () {
      if (currentUser) { return currentUser; }

      throw "Current user undefined";
    },

    /**
      Return a class definition, including inherited properties.

      @param {Object} Request payload
      @param {Object} [payload.name] Model name
      @param {Object} [payload.client] Database client
      @param {Function} [payload.callback] callback
      @param {Boolean} Include inherited or not. Defult = true.
      @return receiver
    */
    getModel: function (obj, includeInherited) {
      var payload = {name: "catalog", client: obj.client},
        name = obj.name;

      payload.callback = function (err, catalog) {
        var resultProps, modelProps, keys, appendParent,
          result = {name: name, inherits: "Object"};

        appendParent = function (child, parent) {
          var model = catalog[parent],
            parentProps = model.properties,
            childProps = child.properties,
            ckeys = Object.keys(parentProps);

          if (parent !== "Object") {
            appendParent(child, model.inherits || "Object");
          }

          ckeys.forEach(function (key) {
            if (childProps[key] === undefined) {
              childProps[key] = parentProps[key];
              childProps[key].inheritedFrom = parent;
            }
          });

          return child;
        };

        /* Validation */
        if (!catalog[name]) {
          obj.callback("Model " + name + " not found.");
          return;
        }

        /* Add other attributes after name */
        keys = Object.keys(catalog[name]);
        keys.forEach(function (key) {
          result[key] = catalog[name][key];
        });

        /* Want inherited properites before class properties */
        if (includeInherited !== false && name !== "Object") {
          result.properties = {};
          result = appendParent(result, result.inherits);
        } else {
          delete result.inherits;
        }

        /* Now add local properties back in */
        modelProps = catalog[name].properties;
        resultProps = result.properties;
        keys = Object.keys(modelProps);
        keys.forEach(function (key) {
          resultProps[key] = modelProps[key];
        });

        obj.callback(null, result);
      };

      /* First, get catalog */
      that.getSettings(payload);
    },

    /**
      Return settings.

      @param {Object} Request payload
      @param {Object} [payload.name] Settings name
      @param {Object} [payload.client] Database client
      @param {Function} [paylead.callback] callback
      @return {Object}
    */
    getSettings: function (obj) {
      var callback,
        name = obj.name;

      callback = function (err, ok) {
        var sql = "SELECT data FROM \"$settings\" WHERE name = $1";

        if (err) {
          obj.callback(err);
          return;
        }

        // If etag checks out, pass back cached
        if (ok) {
          obj.callback(null, settings[name]);
          return;
        }

        // If here, need to query for the current settings
        obj.client.query(sql, [name], function (err, resp) {
          var rec;

          if (err) {
            obj.callback(err);
            return;
          }

          // If we found something, cache it
          if (resp.rows.length) {
            rec = resp.rows[0];

            settings[name] = {
              id: rec.id,
              etag: rec.etag,
              data: rec.data
            };
          }

          // Send back the settings if any were found, otherwise "false"
          obj.callback(null, settings[name] ? settings[name].data : false);
        });
      };

      if (settings[name]) {
        that.checkEtag({
          name: "$settings",
          id: settings[name].id,
          etag: settings[name].etag,
          client: obj.client,
          callback: callback
        });

        return;
      }

      callback(null, false);
    },

    /**
      Check whether a user is authorized to perform an action on a
      particular model (class) or object.

      Allowable actions: "canCreate", "canRead", "canUpdate", "canDelete"

      "canCreate" will only check model names.

      @param {Object} Payload
      @param {String} [payload.action] Required
      @param {String} [payload.model] Class
      @param {String} [payload.id] Object id
      @param {String} [payload.user] User. Defaults to current user
      @param {String} [payload.folder] Folder. Applies to "canCreate"
      @param {String} [payload.client] Datobase client
      @param {String} [payload.callback] Callback
        action
    */
    isAuthorized: function (obj) {
      var table, pk, authSql, sql, callback, params,
        user = obj.user || that.getCurrentUser(),
        model = obj.model,
        folder = obj.folder,
        action = obj.action,
        id = obj.id,
        tokens = [],
        result = false;

      callback = function () {
        /* Check target location for create */
        if (action === "canCreate" && result) {
          if (!folder) { return false; }
          sql =
            "SELECT can_create FROM \"$auth\" AS auth " +
            "  JOIN folder ON folder._pk=auth.object_pk " +
            "  JOIN role ON role._pk=auth.role_pk " +
            "  JOIN role_member ON role_member._parent_role_pk=role._pk " +
            "WHERE role_member.member=$1" +
            "  AND folder.id=$2" +
            "  AND is_member_auth " +
            "ORDER BY is_inherited, can_create DESC " +
            "LIMIT 1";

          obj.client.query(sql, [user, folder], function (err, resp) {
            if (err) {
              obj.callback(err);
              return;
            }

            result = resp.rows.length > 0 ? resp.rows[0].can_create : false;
            obj.callback(null, result);
          });
          return;
        }

        obj.callback(null, result);
      };

      /* If model, check class authorization */
      if (model) {
        params = [model.toSnakeCase(), user];
        sql =
          "SELECT pk FROM \"$auth\" AS auth " +
          "  JOIN \"$model\" AS model ON model._pk=auth.object_pk " +
          "  JOIN role ON role._pk=auth.role_pk " +
          "  JOIN role_member ON role_member._parent_role_pk=role._pk " +
          "WHERE model.id=$1" +
          "  AND role_member.member=$2" +
          "  AND %I";
        sql = sql.format([action.toSnakeCase()]);
        obj.client.query(sql, params, function (err, resp) {
          if (err) {
            obj.callback(err);
            return;
          }

          result = resp.rows;
          callback();
        });

      /* Otherwise check object authorization */
      } else if (id) {
        /* Find object */
        sql = "SELECT _pk, tableoid::regclass::text AS \"table\"" +
          "FROM object WHERE id = $1;";
        obj.client.query(sql, [id], function (err, resp) {
          if (err) {
            obj.callback(err);
            return;
          }

          /* If object found, check authorization */
          if (resp.rows.length > 0) {
            table = resp.rows[0].table;
            pk = resp.rows[0]._pk;

            tokens.push(table);
            authSql =  buildAuthSql(action, table, tokens);
            sql = "SELECT _pk FROM %I WHERE _pk = $2 " + authSql;
            sql = sql.format(tokens);

            obj.client.query(sql, [user, pk], function (err, resp) {
              if (err) {
                obj.callback(err);
                return;
              }

              result = resp.rows.length > 0;
              callback();
            });
          }
        });
      }
    },

    /**
      Returns whether user is super user.

      @param {Object} Payload
      @param {String} [payload.user] User. Defaults to current user
      @param {String} [payload.client] Datobase client
      @param {String} [payload.callback] Callback
      @return receiver
    */
    isSuperUser: function (obj) {
      var sql = "SELECT is_super FROM \"$user\" WHERE username=$1;",
        user = obj.user === undefined ? that.getCurrentUser() : obj.user;

      obj.client.query(sql, [user], function (err, resp) {
        if (err) {
          obj.callback(err);
          return;
        }

        obj.callback(null, resp.rows.length ? resp.rows[0].is_super : false);
      });

      return this;
    },

    /**
      Request.

      Example payload:
          {
             "name": "Contact",
             "method": "POST",
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

      @param {Object} Payload
      @param {Boolean} Bypass authorization checks. Default = false.
      @return receiver
    */
    request: function (obj, isSuperUser) {
      isSuperUser = isSuperUser === undefined ? false : isSuperUser;

      var transaction, afterTransaction, afterRequest,
        callback = obj.callback;

      setCurrentUser(obj.user);

      afterTransaction = function (err, resp) {
        if (err) {
          obj.client.query("ROLLBACK;", function (e, resp) {
            afterRequest(err);
          });

          return;
        }

        obj.client.query("COMMIT;", function (err) {
          if (err) {
            afterRequest(err);
            return;
          }

          afterRequest(null, resp);
        });
      };

      afterRequest = function (err, resp) {
        setCurrentUser(undefined);

        // Format errors into objects that can be handled by server
        if (err) {
          console.error(err);
          if (typeof err === "object") {
            err = {message: err.message, statusCode: err.statusCode || 500};
          } else {
            err = {message: err, statusCode: 500};
          }
          err.isError = true;
          callback(err);
          return;
        }

        // Otherwise return response
        callback(null, resp);
      };

      switch (obj.method) {
      case "GET":
        obj.callback = afterRequest;
        doSelect(obj, false, isSuperUser);
        break;
      case "POST":
        transaction = doInsert;
        break;
      case "PATCH":
        transaction = doUpdate;
        break;
      case "DELETE":
        transaction = doDelete;
        break;
      default:
        obj.callback("method \"" + obj.method + "\" unknown");
      }

      if (transaction) {
        obj.callback = afterTransaction;
        obj.client.query("BEGIN;", function (err, resp) {
          if (err) {
            obj.callback(err);
          }

          transaction(obj, false, isSuperUser);
        });
      }

      return this;
    },

    /**
      Set authorazition for a particular authorization role.

      Example:
        {
          id: "ExWIx6'",
          role: "IWi.QWvo",
          isMember: true,
          actions: 
            {
              canCreate: false,
              canRead: true,
              canUpdate: false,
              canDelete: false
            }
        }

      @param {Object} Specificication
      @param {String} [specification.model] Class name
      @param {String} [specification.id] Object id
      @param {Boolean} [specification.isMember] Indicates member privilege
        of folder
      @param {String} [specification.role] Role
      @param {Object} [specification.actions] Required
      @param {Boolean} [specification.actions.canCreate]
      @param {Boolean} [specification.actions.canRead]
      @param {Boolean} [specification.actions.canUpdate]
      @param {Boolean} [specification.actions.canDelete]
    */
    saveAuthorization: function (obj) {
      var result, sql, pk, err, model, params,
        id = obj.model ? obj.model.toSnakeCase() : obj.id,
        objPk = getKey(id),
        rolePk = getKey(obj.role),
        actions = obj.actions || {},
        isMember = false,
        hasAuth = false;

      /* Validation */
      if (!objPk) {
        err = "Object \"" + id + "\" not found";
      } else if (!rolePk) {
        err = "Role \"" + id + "\" not found";
      }

      if (err) { throw err; }

      if (obj.id && obj.isMember) {
        sql = "SELECT tableoid::regclass::text AS model " +
          "FROM object WHERE id=$1";
        model = plv8.execute(sql, [id])[0].model.toCamelCase(true);

        if (model === "Folder") {
          isMember = obj.isMember || false;
        }

        model = that.getModel(model);

        if (isChildModel(model)) {
          err = "Can not set authorization on child models.";
        } else if (!model.properties.owner) {
          err = "Model must have owner property to set authorization";
        }

        if (err) { throw err; }
      }

      if (!that.isSuperUser()) {
        sql = "SELECT owner FROM %I WHERE _pk=$1"
          .format(model.name.toSnakeCase());
        result = plv8.execute(sql, [objPk]);

        if (result[0].owner !== that.getCurrentUser()) {
          err = "Must be super user or owner of \"" + id + "\" to set " +
            "authorization.";
          throw err;
        }
      }

      /* Determine whether any authorization has been granted */
      hasAuth = actions.canCreate ||
        actions.canRead ||
        actions.canUpdate ||
        actions.canDelete;

      /* Find an existing authorization record */
      sql = "SELECT auth.* FROM \"$auth\" AS auth " +
        "JOIN object ON object._pk=object_pk " +
        "JOIN role ON role._pk=role_pk " +
        "WHERE object.id=$1 AND role.id=$2 AND is_member_auth=$3 " +
        " ORDER BY is_inherited";
      result = plv8.execute(sql, [id, obj.role, isMember]);
      result = result.length ? result[0] : false;

      if (result && !result.is_inherited) {
        pk = result.pk;

        if (!hasAuth && isMember) {
          sql = "DELETE FROM \"$auth\" WHERE pk=$1";
          params = [pk];
        } else {
          sql = "UPDATE \"$auth\" SET can_create=$1, can_read=$2," +
            "can_update=$3, can_delete=$4 WHERE pk=$5";
          params = [
            actions.canCreate === undefined ?
                result.can_create : actions.canCreate,
            actions.canRead === undefined ?
                result.can_read : actions.canRead,
            actions.canUpdate === undefined ?
                result.can_update : actions.canUpdate,
            actions.canDelete === undefined ?
                result.can_delete : actions.canDelete,
            pk
          ];
        }
      } else if (hasAuth || (!isMember || result.is_inherited)) {
        sql = "INSERT INTO \"$auth\" VALUES (" +
          "nextval('$auth_pk_seq'), $1, $2, false," +
          "$3, $4, $5, $6, $7)";
        params = [
          objPk,
          rolePk,
          actions.canCreate === undefined ? false : actions.canCreate,
          actions.canRead === undefined ? false : actions.canRead,
          actions.canUpdate === undefined ? false : actions.canUpdate,
          actions.canDelete === undefined ? false : actions.canDelete,
          isMember
        ];
      } else {
        return;
      }

      plv8.execute(sql, params);

      if (model === "Folder" && isMember) {
        propagateAuth({folderId: obj.id, roleId: obj.role});
      }
    },

    /**
      Create or update a persistence class. This function is idempotent. 
      Subsequent saves will automatically drop properties no longer present.

      Example payload:
       {
         "name": "Contact",
         "description": "Contact data about a person",
         "inherits": "Object",
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

     * @param {Object | Array} Model specification payload(s).
     * @param {String} [specification.name] Name
     * @param {String} [specification.description] Description
     * @param {Object | Boolean} [specification.authorization] Authorization
     *  spec. Defaults to grant all to everyone if undefined. Pass false to
     *  grant no auth.
     * @param {String} [specification.properties] Model properties
     * @param {String} [specification.properties.description] Description
     * @param {String} [specification.properties.default] Default value
     *  or function name.
     * @param {String | Object} [specification.properties.type] Type. Standard
     *  types are string, boolean, number, date. Object is used for relation
     *  specs.
     * @param {String} [specification.properties.relation] Model name of
     *  relation.
     * @param {String} [specification.properties.childOf] Property name on
     *  parent relation if one to many relation.
     * @return {Boolean}
    */
    saveModel: function (specs) {
      specs = Array.isArray(specs) ? specs : [specs];

      var table, inherits, model, catalog, sql, sqlUpd, token, tokens, values,
        adds, args, fns, cols, defaultValue, props, keys, recs, type, name,
        parent, i, n, p, dropSql, changed, isChild, pk, authorization,
        getParentKey = function (child) {
          var cParent, cKeys, cProps;

          cProps = that.getModel(child).properties;
          cKeys = Object.keys(cProps);
          cKeys.forEach(function (cKey) {
            if (typeof cProps[cKey].type === "object" &&
                cProps[cKey].type.childOf) {
              cParent = cProps[cKey].type.relation;

              if (isChildModel(that.getModel(parent))) {
                return getParentKey(cParent);
              }

              return getKey(cParent.toSnakeCase());
            }
          });

        };

      specs.forEach(function (obj) {
        var precision, scale;

        table = obj.name ? obj.name.toSnakeCase() : false;
        inherits = (obj.inherits || "Object").toSnakeCase();
        model = that.getModel(obj.name, false);
        catalog = that.getSettings("catalog");
        authorization = obj.authorization;
        dropSql = "DROP VIEW IF EXISTS %I CASCADE;".format(["_" + table]);
        changed = false;
        sql = "";
        tokens = [];
        adds = [];
        args = [];
        fns = [];
        cols = [];
        i = 0;
        n = 0;
        p = 1;

        if (!table) { throw "No name defined"; }

        /* Create table if applicable */
        if (!model) {
          sql = "CREATE TABLE %I( " +
            "CONSTRAINT %I PRIMARY KEY (_pk), " +
            "CONSTRAINT %I UNIQUE (id)) " +
            "INHERITS (%I);";
          tokens = tokens.concat([
            table,
            table + "_pkey",
            table + "_id_key",
            inherits
          ]);
        } else {
          /* Drop non-inherited columns not included in properties */
          props = model.properties;
          keys = Object.keys(props);
          keys.forEach(function (key) {
            if (obj.properties && !obj.properties[key] &&
                !(typeof model.properties[key].type === "object" &&
                typeof model.properties[key].type.parentOf)) {
              /* Drop views */
              if (!changed) {
                sql += dropSql;
                changed = true;
              }

              /* Handle relations */
              type = props[key].type;

              if (typeof type === "object" && type.properties) {
                /* Drop associated view if applicable */
                sql += "DROP VIEW %I;";
                tokens = tokens.concat([
                  "_" + table + "_" + key.toSnakeCase(),
                  table,
                  relationColumn(key, type.relation)
                ]);
              } else {
                tokens = tokens.concat([table, key.toSnakeCase()]);
              }

              sql += "ALTER TABLE %I DROP COLUMN %I;";

              /* Unrelate parent if applicable */
              if (type.childOf) {
                parent = catalog[type.relation];
                delete parent.properties[type.childOf];
              }

            // Parent properties need to be added back into spec so not lost
            } else if (obj.properties && !obj.properties[key] &&
                (typeof model.properties[key].type === "object" &&
                typeof model.properties[key].type.parentOf)) {
              obj.properties[key] = model.properties[key];
            }
          });
        }

        /* Add table description */
        if (obj.description) {
          sql += "COMMENT ON TABLE %I IS %L;";
          tokens = tokens.concat([table, obj.description || ""]);
        }

        /* Add columns */
        obj.properties = obj.properties || {};
        props = obj.properties;
        keys = Object.keys(props).filter(function (item) {
          return !props[item].inheritedFrom;
        });
        keys.forEach(function (key) {
          var prop = props[key];
          type = typeof prop.type === "string" ?
              types[prop.type] : prop.type;

          if (type && key !== obj.discriminator) {
            if (!model || !model.properties[key]) {
              /* Drop views */
              if (model && !changed) {
                sql += dropSql;
              }

              changed = true;

              sql += "ALTER TABLE %I ADD COLUMN %I ";

              if (prop.isUnique) { sql += "UNIQUE "; }

              /* Handle composite types */
              if (type.relation) {
                sql += "integer;";
                token = relationColumn(key, type.relation);

                /* Update parent class for children */
                if (type.childOf) {
                  parent = catalog[type.relation];
                  if (!parent.properties[type.childOf]) {
                    parent.properties[type.childOf] = {
                      description: 'Parent of "' + key + '" on "' +
                        obj.name + '"',
                      type: {
                        relation: obj.name,
                        parentOf: key
                      }
                    };

                  } else {
                    throw 'Property "' + type.childOf +
                      '" already exists on "' + type.relation + '"';
                  }

                } else if (type.parentOf) {
                  throw 'Can not set parent directly for "' + key + '"';
                }

                if (type.properties) {
                  cols = ["%I"];
                  name = "_" + table + "$" + key.toSnakeCase();
                  args = [name, "_pk"];

                  /* Always include "id" whether specified or not */
                  if (type.properties.indexOf("id") === -1) {
                    type.properties.unshift("id");
                  }

                  while (i < type.properties.length) {
                    cols.push("%I");
                    args.push(type.properties[i].toSnakeCase());
                    i++;
                  }

                  args.push(type.relation.toSnakeCase());
                  sql += ("CREATE VIEW %I AS SELECT " + cols.join(",") +
                    " FROM %I WHERE NOT is_deleted;").format(args);
                }

              /* Handle standard types */
              } else {
                if (prop.format && formats[prop.format]) {
                  sql += formats[prop.format].type;
                } else {
                  sql += type.type;
                  if (type.type === "numeric") {
                    precision = typeof prop.precision === "number" ?
                        prop.precision : PRECISION_DEFAULT;
                    scale = typeof prop.scale === "number" ?
                        prop.scale : SCALE_DEFAULT;
                    sql += "(" + precision + "," + scale + ")";
                  }
                }
                sql += ";";
                token = key.toSnakeCase();
              }
              adds.push(key);

              tokens = tokens.concat([table, token]);

              if (props[key].description) {
                sql += "COMMENT ON COLUMN %I.%I IS %L;";
                tokens = tokens.concat([
                  table,
                  token,
                  props[key].description || ""
                ]);
              }
            }
          } else {
            throw 'Invalid type "' + props[key].type + '" for property "' +
                key + '" on class "' + obj.name + '"';
          }
        });

        /* Update schema */
        sql = sql.format(tokens);
        plv8.execute(sql);

        /* Populate defaults */
        if (adds.length) {
          values = [];
          tokens = [];
          args = [table];
          i = 0;

          while (i < adds.length) {
            type = props[adds[i]].type;
            if (typeof type === "object") {
              defaultValue = -1;
            } else {
              defaultValue = props[adds[i]].default ||
                types[type].default;
            }

            if (typeof defaultValue === "string" &&
                defaultValue.match(/\(\)$/)) {
              fns.push({
                col: adds[i].toSnakeCase(),
                default: defaultValue.replace(/\(\)$/, "")
              });
            } else {
              values.push(defaultValue);
              tokens.push("%I=$" + p);
              if (typeof type === "object") {
                args.push(relationColumn(adds[i], type.relation));
              } else {
                args.push(adds[i].toSnakeCase());
              }
              p++;
            }
            i++;
          }

          if (values.length) {
            sql = ("UPDATE %I SET " + tokens.join(",") + ";").format(args);
            plv8.execute(sql, values);
          }

          /* Update function based defaults (one by one) */
          if (fns.length) {
            sql = "SELECT _pk FROM %I ORDER BY _pk OFFSET $1 LIMIT 1;"
              .format([table]);
            recs = plv8.execute(sql, [n]);
            tokens = [];
            args = [table];
            i = 0;

            while (i < fns.length) {
              tokens.push("%I=$" + (i + 2));
              args.push(fns[i].col);
              i++;
            }

            sqlUpd = ("UPDATE %I SET " + tokens.join(",") + " WHERE _pk = $1")
              .format(args);

            while (recs.length) {
              values = [recs[0]._pk];
              i = 0;
              n++;

              while (i < fns.length) {
                values.push(f[fns[i].default]());
                i++;
              }

              plv8.execute(sqlUpd, values);
              recs = plv8.execute(sql, [n]);
            }
          }
        }

        /* Update catalog settings */
        name = obj.name;
        catalog[name] = obj;
        delete obj.name;
        delete obj.authorization;
        obj.isChild = isChildModel(obj);
        that.saveSettings("catalog", catalog);

        if (!model) {
          isChild = isChildModel(that.getModel(name));
          pk = plv8.execute("select nextval('object__pk_seq') as pk;")[0].pk;
          sql = "INSERT INTO \"$model\" " +
            "(_pk, id, created, created_by, updated, updated_by, is_deleted, " +
            " is_child, parent_pk) VALUES " +
            "($1, $2, now(), $3, now(), $4, false, $5, $6);";
          values = [pk, table, that.getCurrentUser(),
            that.getCurrentUser(), isChild,
            isChild ? getParentKey(name) : pk];

          plv8.execute(sql, values);
        }

        /* Propagate views */
        changed = changed || !model;
        if (changed) {
          propagateViews(name);
        }

        /* If no specific authorization, grant to all */
        if (authorization === undefined) {
          authorization = {
            model: name,
            role: "everyone",
            actions: {
              canCreate: true,
              canRead: true,
              canUpdate: true,
              canDelete: true
            }
          };
        }

        /* Set authorization */
        if (authorization) {
          that.saveAuthorization(authorization);
        }
      });

      return true;
    },

    /**
      Create or upate settings.

      @param {String} Name of settings
      @param {Object} Settings payload
      @return {String}
    */
    saveSettings: function (name, settings) {
      var sql = "SELECT data FROM \"$settings\" WHERE name = $1;",
        params = [name, settings],
        result,
        rec;

      result = plv8.execute(sql, [name]);

      if (result.length) {
        rec = result[0];

        if (settings.etag !== rec.etag) {
          throw 'Settings for "' + name +
            '" changed by another user. Save failed.';
        }

        sql = "UPDATE \"$settings\" SET data = $2 WHERE name = $1;";

        plv8.execute(sql, params);
      } else {
        sql = "INSERT INTO \"$settings\" (name, data) VALUES ($1, $2);";
        plv8.execute(sql, params);
      }

      settings[name] = settings;

      return true;
    },

    /**
      Returns whether user is super user.

      @param {String} User
      @param {Boolean} Is super user. Default = true
    */
    setSuperUser: function (user, isSuper) {
      isSuper = isSuper === undefined ? true : isSuper;

      var sql = "SELECT * FROM pg_user WHERE usename=$1;",
        params = [user, isSuper],
        result;

      if (!that.isSuperUser(that.getCurrentUser())) {
        throw "Only a super user can set another super user";
      }

      result = plv8.execute(sql, [user]);

      if (!result.length) {
        throw "User does not exist";
      }

      sql = "SELECT * FROM \"$user\" WHERE username=$1;";
      result = plv8.execute(sql, [user]);

      if (result.length) {
        sql = "UPDATE \"$user\" SET is_super=$2 WHERE username=$1";
      } else {
        sql = "INSERT INTO \"$user\" VALUES ($1, $2)";
      }

      plv8.execute(sql, params);
    }
  };

  // Set properties on exports
  Object.keys(that).forEach(function (key) {
    exports[key] = that[key];
  });

  // ..........................................................
  // PRIVATE
  //

  /** private */
  buildAuthSql = function (action, table, tokens) {
    var actions = [
        "canRead",
        "canUpdate",
        "canDelete"
      ],
      i = 8;

    if (actions.indexOf(action) === -1) {
      throw "Invalid authorization action for object \"" + action + "\"";
    }

    while (i--) {
      tokens.push(table);
    }

    action = action.toSnakeCase();

    return " AND _pk IN (" +
        "SELECT %I._pk " +
        "FROM %I " +
        "  JOIN \"$model\" ON \"$model\".id::regclass::oid=%I.tableoid " +
        "WHERE EXISTS (" +
        "  SELECT " + action + " FROM ( " +
        "    SELECT " + action +
        "    FROM \"$auth\"" +
        "      JOIN \"role\" on \"$auth\".\"role_pk\"=\"role\".\"_pk\"" +
        "      JOIN \"role_member\"" +
        "        ON \"role\".\"_pk\"=\"role_member\".\"_parent_role_pk\"" +
        "    WHERE member=$1" +
        "      AND object_pk=\"$model\".parent_pk" +
        "    ORDER BY " + action + " DESC" +
        "    LIMIT 1" +
        "  ) AS data" +
        "  WHERE " + action +
        ") " +
        "INTERSECT " +
        "SELECT %I._pk " +
        "FROM %I" +
        "  JOIN \"$objectfolder\" ON _pk=object_pk " +
        "WHERE EXISTS (" +
        "  SELECT " + action + " FROM (" +
        "    SELECT " + action +
        "    FROM \"$auth\"" +
        "      JOIN \"role\" on \"$auth\".\"role_pk\"=\"role\".\"_pk\"" +
        "      JOIN \"role_member\"" +
        "        ON \"role\".\"_pk\"=\"role_member\".\"_parent_role_pk\"" +
        "    WHERE member=$1" +
        "      AND object_pk=folder_pk" +
        "      AND is_member_auth" +
        "    ORDER BY is_inherited, " + action + " DESC" +
        "    LIMIT 1" +
        "  ) AS data" +
        "  WHERE " + action +
        ") " +
        "EXCEPT " +
        "SELECT %I._pk " +
        "FROM %I " +
        "WHERE EXISTS ( " +
        "  SELECT " + action + " FROM (" +
        "    SELECT " + action +
        "    FROM \"$auth\"" +
        "    JOIN \"role\" on \"$auth\".\"role_pk\"=\"role\".\"_pk\"" +
        "    JOIN \"role_member\" " +
        "      ON \"role\".\"_pk\"=\"role_member\".\"_parent_role_pk\"" +
        "    WHERE member=$1" +
        "      AND object_pk=%I._pk" +
        "    ORDER BY " + action + " DESC" +
        "    LIMIT 1 " +
        "  ) AS data " +
        "WHERE NOT " + action + "))";
  };

  /** private */
  createView = function (name, dropFirst) {
    var parent, alias, type, view, sub, col,
      model = that.getModel(name),
      table = name.toSnakeCase(),
      args = ["_" + table, "_pk"],
      props = model.properties,
      keys = Object.keys(props),
      cols = ["%I"],
      sql = "";

    keys.forEach(function (key) {
      alias = key.toSnakeCase();

      /* Handle discriminator */
      if (key === "objectType") {
        cols.push("%s");
        args.push("to_camel_case(tableoid::regclass::text, true) AS " + alias);

      /* Handle relations */
      } else if (typeof props[key].type === "object") {
        type = props[key].type;
        parent =  props[key].inheritedFrom ?
            props[key].inheritedFrom.toSnakeCase() : table;

        /* Handle to many */
        if (type.parentOf) {
          sub = "ARRAY(SELECT %I FROM %I WHERE %I.%I = %I._pk " +
            "AND NOT %I.is_deleted ORDER BY %I._pk) AS %I";
          view = "_" + props[key].type.relation.toSnakeCase();
          col = "_" + type.parentOf.toSnakeCase() + "_" + parent + "_pk";
          args = args.concat([view, view, view, col, table, view, view,
            alias]);

        /* Handle to one */
        } else if (!type.childOf) {
          col = "_" + key.toSnakeCase() + "_" +
            props[key].type.relation.toSnakeCase() + "_pk";
          sub = "(SELECT %I FROM %I WHERE %I._pk = %I) AS %I";

          if (props[key].type.properties) {
            view = "_" + parent + "$" + key.toSnakeCase();
          } else {
            view = "_" + props[key].type.relation.toSnakeCase();
          }

          args = args.concat([view, view, view, col, alias]);
        } else {
          sub = "_" + key.toSnakeCase() + "_" + type.relation.toSnakeCase() +
             "_pk";
        }

        cols.push(sub);

      /* Handle regular types */
      } else {
        cols.push("%I");
        args.push(alias);
      }
    });

    args.push(table);

    if (dropFirst) {
      sql = "DROP VIEW %I;".format(["_" + table]);
    }

    sql += ("CREATE OR REPLACE VIEW %I AS SELECT " + cols.join(",") +
      " FROM %I;").format(args);

    plv8.execute(sql);
  };

  /** private */
  curry = function (fn, args) {
    return function () {
      return fn.apply(this, args.concat([].slice.call(arguments)));
    };
  };

  /** private */
  doDelete = function (obj, isChild, isSuperUser) {
    var oldRec, keys, props, noChildProps, afterGetModel,
      afterAuthorization, afterDoSelect, afterDelete, afterLog,
      sql = "UPDATE object SET is_deleted = true WHERE id=$1;",
      clen = 1,
      c = 0;

    noChildProps = function (key) {
      if (typeof props[key].type !== "object" ||
          !props[key].type.childOf) {
        return true;
      }
    };

    afterGetModel = function (err, model) {
      if (err) {
        obj.callback(err);
        return;
      }

      props = model.properties;

      if (!isChild && model.isChild) {
        obj.callback("Can not directly delete a child class");
      }

      if (isSuperUser === false) {
        that.isAuthorized({
          action: "canDelete",
          id: obj.id,
          client: obj.client,
          callback: afterAuthorization
        });
        return;
      }

      afterAuthorization(null, true);
    };

    afterAuthorization = function (err, authorized) {
      if (err) {
        obj.callback(err);
        return;
      }

      if (!authorized) {
        obj.callback("Not authorized to delete \"" + obj.id + "\"");
      }

      // Get old record, bail if it doesn't exist
      // Exclude childOf relations when we select
      doSelect({
        name: obj.name,
        id: obj.id,
        showDeleted: true,
        properties: Object.keys(props).filter(noChildProps),
        client: obj.client,
        callback: afterDoSelect
      }, true);
    };

    afterDoSelect = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      oldRec = resp;

      if (!oldRec) {
        obj.callback("Record " + obj.id + " not found.");
        return;
      }

      if (oldRec.isDeleted) {
        obj.callback("Record " + obj.id + " already deleted.");
        return;
      }

      // Get keys for properties of child arrays.
      // Count expected callbacks along the way.
      keys = Object.keys(props).filter(function (key) {
        if (typeof props[key].type === "object" &&
            props[key].type.parentOf) {
          clen += oldRec[key].length;
          return true;
        }
      });

      // Delete children recursively
      keys.forEach(function (key) {
        var rel = props[key].type.relation;
        oldRec[key].forEach(function (row) {
          doDelete({
            name: rel,
            id: row.id,
            client: obj.client,
            callback: afterDelete
          }, true);
        });
      });

      // Finally, delete parent object
      obj.client.query(sql, [obj.id], afterDelete);
    };

    // Handle change log
    afterDelete = function (err) {
      var now = f.now();

      if (err) {
        obj.callback(err);
        return;
      }

      // Move on only after all callbacks report back
      c++;
      if (c < clen) { return; }

      if (isChild) {
        afterLog();
        return;
      }

      // Log the completed deletion
      doInsert({
        name: "Log",
        data: {
          objectId: obj.id,
          action: "DELETE",
          created: now,
          createdBy: now,
          updated: now,
          updatedBy: now
        },
        client: obj.client,
        callback: afterLog
      }, true);
    };

    afterLog = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      obj.callback(null, true);
    };

    // Kick off query by getting model, the rest falls through callbacks
    that.getModel({
      name: obj.name,
      client: obj.client,
      callback: afterGetModel
    });
  };

  /** private */
  doInsert = function (obj, isChild, isSuperUser) {
    var sql, col, key, child, pk, n, dkeys, fkeys, len, msg, props, prop, value,
      result, afterGetModel, afterIdCheck, afterNextVal, afterAuthorized,
      buildInsert, afterGetPk, afterHandleRelations, afterInsert,
      afterDoSelect, afterLog, insertFolder, afterHandleFolder, done,
      payload = {name: obj.name, client: obj.client},
      data = JSON.parse(JSON.stringify(obj.data)),
      folder = obj.folder !== false ? obj.folder || "global" : false,
      args = [obj.name.toSnakeCase()],
      tokens = [],
      params = [],
      values = [],
      clen = 1,
      c = 0,
      p = 2;

    afterGetModel = function (err, model) {
      if (err) {
        obj.callback(err);
        return;
      }

      if (!model) {
        obj.callback("Class \"" + obj.name + "\" not found");
      }

      props = model.properties;
      fkeys = Object.keys(props);
      dkeys = Object.keys(data);

      /* Validate properties are valid */
      len = dkeys.length;
      for (n = 0; n < len; n++) {
        if (fkeys.indexOf(dkeys[n]) === -1) {
          obj.callback("Model \"" + obj.name +
            "\" does not contain property \"" + dkeys[n] + "\"");
          return;
        }
      }

      /* Check id for existence and uniqueness and regenerate if any problem */
      if (!data.id) {
        afterIdCheck(null, -1);
        return;
      }

      getKey({
        id: data.id,
        client: obj.client,
        callback: afterIdCheck
      }, true);
    };

    afterIdCheck = function (err, id) {
      if (err) {
        obj.callback(err);
        return;
      }

      if (id !== undefined) {
        data.id = f.createId();
      }

      if (!isChild && isSuperUser === false) {
        that.isAuthorized({
          action: "canCreate",
          model: obj.name,
          folder: folder,
          client: obj.client,
          callback: afterAuthorized
        });
        return;
      }

      afterAuthorized(null, true);
    };

    afterAuthorized = function (err, authorized) {
      var ckeys;

      if (err) {
        obj.callback(err);
        return;
      }

      if (!authorized) {
        msg = "Not authorized to create \"" + obj.name + "\" in folder \"" +
          folder + "\"";
        obj.callback({statusCode: 401, message: msg});
      }

      // Get keys for properties of child arrays.
      // Count expected callbacks along the way.
      ckeys = Object.keys(props).filter(function (key) {
        if (typeof props[key].type === "object" &&
            props[key].type.parentOf &&
            data[key] !== undefined) {
          clen += data[key].length;
          return true;
        }
      });

      // Insert children recursively
      ckeys.forEach(function (key) {
        var rel = props[key].type.relation;
        data[key].forEach(function (row) {
          row[props[key].type.parentOf] = {id: data.id};
          doInsert({
            name: rel,
            data: row,
            client: obj.client,
            callback: afterInsert
          }, true);
        });
      });

      // Set some system controlled values
      data.created = data.updated = f.now();
      data.createdBy = that.getCurrentUser();
      data.updatedBy = that.getCurrentUser();

      // Get primary key
      sql = "select nextval('object__pk_seq')";
      obj.client.query(sql, afterNextVal);
    };

    afterNextVal = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      pk = resp.rows[0].nextval;
      values.push(pk);

      /* Build values */
      len = fkeys.length;
      n = 0;
      buildInsert();
    };

    buildInsert = function () {
      if (n < len) {
        key = fkeys[n];
        child = false;
        prop = props[key];
        n++;

        /* Handle relations */
        if (typeof prop.type === "object") {
          if (prop.type.parentOf) {
          /* To many */
            child = true;

          /* To one */
          } else {
            col = relationColumn(key, prop.type.relation);
            if (data[key] === undefined) {
              value = -1;
            } else {
              getKey({
                id: data[key].id,
                client: obj.client,
                callback: afterGetPk
              });
              return;
            }
          }

        /* Handle discriminator */
        } else if (key === "objectType") {
          child = true;

        /* Handle regular types */
        } else {
          value = data[key];
          col = key.toSnakeCase();

          if (value === undefined) {
            value = prop.default === undefined ?
                types[prop.type].default : prop.default;

            // If we have a class specific default that calls a function
            if (value && typeof value === "string" && value.match(/\(\)$/)) {
              value = f[value.replace(/\(\)$/, "")]();
            }
          }
        }

        afterHandleRelations();
        return;
      }

      sql = ("INSERT INTO %I (_pk, " + tokens.toString(",") +
        ") VALUES ($1," + params.toString(",") + ");").format(args);

      // Perform the insert
      obj.client.query(sql, values, afterInsert);
    };

    afterGetPk = function (err, id) {
      if (err) {
        obj.callback(err);
        return;
      }

      value = id;

      if (value === undefined) {
        err = 'Relation not found in "' + prop.type.relation +
          '" for "' + key + '" with id "' + data[key].id + '"';
      } else if (!isChild && prop.type.childOf) {
        err = "Child records may only be created from the parent.";
      }

      if (err) {
        obj.callback(err);
        return;
      }

      afterHandleRelations();
    };

    afterHandleRelations = function () {
      if (!child) {
        args.push(col);
        tokens.push("%I");
        values.push(value);
        params.push("$" + p);
        p++;
      }

      buildInsert();
    };

    afterInsert = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      // Done only when all callbacks report back
      c++;
      if (c < clen) { return; }

      // We're done here if child
      if (isChild) {
        done();
        return;
      }

      // Otherwise we'll move on to log the change
      doSelect({
        name: obj.name,
        id: data.id,
        client: obj.client,
        callback: afterDoSelect
      });
    };

    afterDoSelect = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      result = resp;

      /* Handle folder */
      if (folder) {
        getKey({id: folder, client: obj.client, callback: insertFolder});
        return;
      }

      afterHandleFolder();
    };

    insertFolder = function (err, resp) {
      sql = "INSERT INTO \"$objectfolder\" VALUES ($1, $2);";
      obj.client.query(sql, [pk, resp], afterHandleFolder);
    };

    afterHandleFolder = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      /* Handle change log */
      doInsert({
        name: "Log",
        data: {
          objectId: data.id,
          action: "POST",
          created: data.created,
          createdBy: data.createdBy,
          updated: data.updated,
          updatedBy: data.updatedBy,
          change: JSON.parse(JSON.stringify(result))
        },
        client: obj.client,
        callback: afterLog
      }, true);
    };

    afterLog = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      // We're geing to return the changes
      result = jsonpatch.compare(obj.data, result);

      /* Handle folder authorization propagation */
      if (obj.name === "Folder") {
        propagateAuth({
          folderId: obj.folder,
          client: obj.client,
          callback: done
        });
        return;
      }

      done();
    };

    done = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      // Report back result
      obj.callback(null, result);
    };

    // Kick off query by getting model, the rest falls through callbacks
    payload.callback = afterGetModel;
    that.getModel(payload);
  };

  /** private */
  doSelect = function (obj, isChild, isSuperUser) {
    var sql, table, keys,
      afterGetModel, afterGetKey, afterGetKeys, mapKeys,
      payload = {name: obj.name, client: obj.client},
      tokens = [],
      cols = [];

    afterGetModel = function (err, model) {
      if (err) {
        obj.callback(err);
        return;
      }

      table = "_" + model.name.toSnakeCase();
      keys = obj.properties || Object.keys(model.properties);

      /* Validate */
      if (!isChild && model.isChild) {
        obj.callback("Can not query directly on a child class");
        return;
      }

      keys.forEach(function (key) {
        tokens.push("%I");
        cols.push(key.toSnakeCase());
      });

      cols.push(table);
      sql = ("SELECT to_json((" +  tokens.toString(",") +
        ")) AS result FROM %I").format(cols);

      /* Get one result by key */
      if (obj.id) {
        payload.id = obj.id;
        payload.callback = afterGetKey;
        getKey(payload, isSuperUser);

      /* Get a filtered result */
      } else {
        payload.filter = obj.filter;
        payload.callback = afterGetKeys;
        getKeys(payload, isSuperUser);
      }

      return this;
    };

    afterGetKey = function (err, key) {
      if (err) {
        obj.callback(err);
        return;
      }

      if (key === undefined) {
        obj.callback(null, undefined);
        return;
      }

      sql +=  " WHERE _pk = $1";

      obj.client.query(sql, [key], function (err, resp) {
        var result;

        if (err) {
          obj.callback(err);
          return;
        }

        result = sanitize(mapKeys(resp.rows[0]));
        obj.callback(null, result);
      });
    };

    afterGetKeys = function (err, keys) {
      var result,
        i = 0;

      if (keys.length) {
        tokens = [];

        while (keys[i]) {
          i++;
          tokens.push("$" + i);
        }

        sql += " WHERE _pk IN (" + tokens.toString(",") + ")";

        obj.client.query(sql, keys, function (err, resp) {
          if (err) {
            obj.callback(err);
            return;
          }

          result = sanitize(resp.rows.map(mapKeys));
          obj.callback(null, result);
        });
      } else {
        obj.callback(null, []);
      }
    };

    mapKeys = function (row) {
      var  result = row.result,
        rkeys = Object.keys(result),
        ret = {},
        i = 0;

      rkeys.forEach(function (key) {
        ret[keys[i]] = result[key];
        i++;
      });

      return ret;
    };

    // Kick off query by getting model, the rest falls through callbacks
    payload.callback = afterGetModel;
    that.getModel(payload);

    return this;
  };

  /** Private */
  doUpdate = function (obj, isChild, isSuperUser) {
    var result, updRec, props, value, keys, sql, pk,
      oldRec, newRec, cpatches, model, tokens, find, noChildProps,
      afterGetModel, afterGetKey, afterAuthorization, afterDoSelect,
      afterUpdate, afterSelectUpdated, done,
      patches = obj.data || [],
      id = obj.id,
      params = [],
      ary = [],
      clen = 0,
      c = 0,
      p = 1;

    find = function (ary, id) {
      var n = 0;

      while (n < ary.length) {
        if (ary[n].id === id) { return ary[n]; }
        n++;
      }

      return false;
    };

    noChildProps = function (key) {
      if (typeof model.properties[key].type !== "object" ||
          !model.properties[key].type.childOf) {
        return true;
      }
    };

    afterGetModel = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      model = resp;
      tokens = [model.name.toSnakeCase()];
      props = model.properties;

      /* Validate */
      if (!isChild && model.isChild) {
        obj.callback("Can not directly update a child class");
        return;
      }

      if (isSuperUser === false) {
        that.isAuthorized({
          action: "canUpdate",
          id: id,
          client: obj.client,
          callback: afterAuthorization
        });
        return;
      }

      afterAuthorization(null, true);
    };

    afterAuthorization = function (err, authorized) {
      if (err) {
        obj.callback(err);
        return;
      }

      if (!authorized) {
        obj.callback("Not authorized to update \"" + id + "\"");
        return;
      }

      getKey({
        id: id,
        client: obj.client,
        callback: afterGetKey
      });
    };

    afterGetKey = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      pk = resp;

      // Get existing record
      doSelect({
        name: obj.name,
        id: obj.id,
        properties: Object.keys(props).filter(noChildProps),
        client: obj.client,
        callback: afterDoSelect
      }, isChild);
    };

    afterDoSelect = function (err, resp) {
      var doList = [];

      if (err) {
        obj.callback(err);
        return;
      }

      oldRec = resp;

      if (!Object.keys(oldRec).length || oldRec.isDeleted) {
        obj.callback(null, false);
        return;
      }

      newRec = JSON.parse(JSON.stringify(oldRec));
      jsonpatch.apply(newRec, patches);

      if (!patches.length) {
        afterUpdate();
        return;
      }

      updRec = JSON.parse(JSON.stringify(newRec));
      updRec.updated = new Date().toJSON();
      updRec.updatedBy = that.getCurrentUser();
      if (props.etag) {
        updRec.etag = f.createId();
      }

      // Process properties
      keys = Object.keys(props);
      keys.forEach(function (key) {
        var relation;

        /* Handle composite types */
        if (typeof props[key].type === "object") {
          /* Handle child records */
          if (Array.isArray(updRec[key])) {
            relation = props[key].type.relation;

            /* Process deletes */
            oldRec[key].forEach(function (row) {
              var cid = row.id;

              if (!find(updRec[key], cid)) {
                clen++;
                doList.push({
                  func: doDelete,
                  payload: {
                    name: relation,
                    id: cid,
                    client: obj.client,
                    callback: afterUpdate
                  }
                });
              }
            });

            /* Process inserts and updates */
            oldRec[key].forEach(function (cNewRec) {
              var cid = cNewRec.id || null,
                cOldRec = find(oldRec[key], cid);

              if (cOldRec) {
                cpatches = jsonpatch.compare(cOldRec, cNewRec);

                if (cpatches.length) {
                  clen++;
                  doList.push({
                    func: doUpdate,
                    payload: {
                      name: relation,
                      id: cid,
                      data: cpatches,
                      client: obj.client,
                      callback: afterUpdate
                    }
                  });
                }
              } else {
                cNewRec[props[key].type.parentOf] = {id: updRec.id};
                clen++;
                doList.push({
                  func: doInsert,
                  payload: {
                    name: relation,
                    data: cNewRec,
                    client: obj.client,
                    callback: afterUpdate
                  }
                });
              }
            });
          }

        /* Handle to one relations */
        } else if (!props[key].type.childOf &&
            updRec[key].id !== oldRec[key].id) {
          value = updRec[key].id ? getKey(updRec[key].id) : -1;
          relation = props[key].type.relation;

          if (value === undefined) {
            obj.callback("Relation not found in \"" + relation +
              "\" for \"" + key + "\" with id \"" + updRec[key].id + "\"");
            return;
          }

          tokens.push(relationColumn(key, relation));
          ary.push("%I = $" + p);
          params.push(value);
          p++;

        /* Handle regular data types */
        } else if (updRec[key] !== oldRec[key] && key !== "objectType") {
          tokens.push(key.toSnakeCase());
          ary.push("%I = $" + p);
          params.push(updRec[key]);
          p++;
        }
      });

      // Execute main object change
      sql = ("UPDATE %I SET " + ary.join(",") + " WHERE _pk = $" + p)
        .format(tokens);
      params.push(pk);
      clen++;
      obj.client.query(sql, params, afterUpdate);

      // Execute child changes
      doList.forEach(function (item) {
        item.func(item.payload, true);
      });
    };

    afterUpdate = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      // Don't proceed until all callbacks report back
      c++;
      if (c < clen) { return; }

      // If child, we're done here
      if (isChild) {
        obj.callback();
        return;
      }

      // If a top level record, return patch of what changed
      doSelect({
        name: model.name,
        id: id,
        client: obj.client,
        callback: afterSelectUpdated
      });
    };

    afterSelectUpdated = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      result = resp;

      /* Handle change log */
      doInsert({
        name: "Log",
        data: {
          objectId: id,
          action: "PATCH",
          created: updRec.updated,
          createdBy: updRec.updatedBy,
          updated: updRec.updated,
          updatedBy: updRec.updatedBy,
          change: jsonpatch.compare(oldRec, result)
        },
        client: obj.client,
        callback: done
      }, true);
    };

    done = function (err) {
      if (err) {
        obj.callback(err);
        return;
      }

      obj.callback(jsonpatch.compare(newRec, result));
    };

    // Kick off query by getting model, the rest falls through callbacks
    that.getModel({
      name: obj.name,
      client: obj.client,
      callback: afterGetModel
    });

    return this;
  };

  /** private */
  isChildModel = function (model) {
    var props = model.properties,
      key;

    for (key in props) {
      if (props.hasOwnProperty(key)) {
        if (typeof props[key].type === "object" &&
            props[key].type.childOf) {
          return true;
        }
      }
    }

    return false;
  };

  /** private */
  getKey = function (obj, isSuperUser) {
    var payload = {
        name: obj.name || "Object",
        filter: {criteria: [{property: "id", value: obj.id}]},
        client: obj.client
      };

    payload.callback = function (err, keys) {
      if (err) {
        obj.callback(err);
        return;
      }

      obj.callback(null, keys.length ? keys[0] : undefined);
    };

    getKeys(payload, isSuperUser);

    return this;
  };

  /** private */
  getKeys = function (obj, isSuperUser) {
    var part, order, op, err, n,
      name = obj.name,
      filter = obj.filter,
      ops = ["=", "!=", "<", ">", "<>", "~", "*~", "!~", "!~*"],
      table = name.toSnakeCase(),
      clause = obj.showDeleted ? "true" : "NOT is_deleted",
      sql = "SELECT _pk FROM %I WHERE " + clause,
      tokens = [table],
      criteria = filter ? filter.criteria || [] : false,
      sort = filter ? filter.sort || [] : false,
      params = [],
      parts = [],
      i = 0,
      p = 1;

    /* Add authorization criteria */
    if (isSuperUser === false) {
      sql += buildAuthSql("canRead", table, tokens);

      params.push(that.getCurrentUser());
      p++;
    }

    /* Process filter */
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
            err = 'Unknown operator "' + criteria[i].operator + '"';
            throw err;
          }
          params.push(criteria[i].value);
          part = " %I" + op + "$" + p++;
          i++;
        }
        parts.push(part);
        i++;
      }

      if (parts.length) {
        sql += " AND " + parts.join(" AND ");
      }

      /* Process sort */
      i = 0;
      parts = [];
      while (sort[i]) {
        order = (sort[i].order || "ASC").toUpperCase();
        if (order !== "ASC" && order !== "DESC") {
          throw 'Unknown operator "' + order + '"';
        }
        tokens.push(sort[i].property);
        parts.push(" %I " + order);
        i++;
      }

      if (parts.length) {
        sql += " ORDER BY " + parts.join(",");
      }

      /* Process offset and limit */
      if (filter.offset) {
        sql += " OFFSET $" + p++;
        params.push(filter.offset);
      }

      if (filter.limit) {
        sql += " LIMIT $" + p;
        params.push(filter.limit);
      }
    }

    sql = sql.format(tokens);

    obj.client.query(sql, params, function (err, resp) {
      var keys;

      if (err) {
        obj.callback(err);
        return;
      }

      keys = resp.rows.map(function (rec) {
        return rec._pk;
      });

      obj.callback(null, keys);
    });
  };

  /** private 
    @param {Object} Payload
    @param {String} [payload.folderId] Folder id. Required.
    @param {String} [payload.roleId] Role id.
    @param {String} [payload.isDeleted] Folder is hard deleted.
    @param {Object} [payload.client] Database client
    @param {Function} [payload.callback] Callback
  */
  propagateAuth = function (obj) {
    var auth, auths, children, child, n,
      afterGetRoleId, getAuths, propagate, updateChild, recurse,
      folderKey = getKey(obj.folderId),
      params = [folderKey, false],
      authSql = "SELECT object_pk, role_pk, can_create, can_read, " +
      " can_update, can_delete " +
      "FROM \"$auth\" AS auth" +
      "  JOIN role ON role_pk=_pk " +
      "WHERE object_pk=$1 " +
      "  AND is_member_auth " +
      "  AND is_inherited= $2",
      childSql = "SELECT _pk, id " +
      "FROM \"$objectfolder\"" +
      " JOIN folder ON object_pk=_pk " +
      "WHERE folder_pk=$1 ",
      delSql = "DELETE FROM \"$auth\"" +
      "WHERE object_pk=$1 AND role_pk=$2 " +
      "  AND is_inherited " +
      "  AND is_member_auth",
      insSql = "INSERT INTO \"$auth\" VALUES (nextval('$auth_pk_seq')," +
      "$1, $2, true, $3, $4, $5, $6, true)",
      roleSql = "SELECT id FROM role WHERE _pk=$1",
      i = 0;

    afterGetRoleId = function (err, roleKey) {
      if (err) {
        obj.callback(err);
        return;
      }

      authSql += " AND role.id=$3";
      params.push(roleKey);
      getAuths();
    };

    // Get all authorizations for this folder
    getAuths = function () {
      obj.client.query(authSql, params, function (err, resp) {
        if (err) {
          obj.callback(err);
          return;
        }

        auths = resp.rows;

        if (!obj.roleId) {
          authSql += " AND role.id=$3";
        }

        propagate();
      });
    };

    // Propagate each authorization to children
    propagate = function () {
      if (i < auths.length) {
        auth = auths[i];
        i++;

        // Only process if auth has no manual over-ride
        params = [folderKey, false, auth.role_pk];
        obj.client.query(authSql, params, function (err, resp) {
          if (!resp.rows.length) {
            // Find child folders
            obj.client.query(childSql, [auth.object_pk], function (err, resp) {
              if (err) {
                obj.callback(err);
                return;
              }

              children = resp.rows;
              n = 0;

              // Kick off update child loop
              updateChild();
            });

            return;
          }

          propagate();
        });

        return;
      }

      // All done
      obj.callback();
    };

    updateChild = function () {
      if (n < children.length) {
        child = children[n];
        n++;

        // Delete old authorizations
        params = [child._pk, auth.role_pk];
        obj.client.query(delSql, params, function (err) {
          if (err) {
            obj.callback(err);
            return;
          }

          // Insert new authorizations
          params = [child._pk, auth.role_pk, auth.can_create, auth.can_read,
            auth.can_update, auth.can_delete];
          if (!obj.isDeleted) {
            obj.client.query(insSql, params, function (err) {
              if (err) {
                obj.callback(err);
                return;
              }

              // Propagate recursively
              if (obj.roleId) {
                recurse(obj.roleId);
                return;
              }

              obj.client.query(roleSql, [auth.role_pk], function (err, resp) {
                if (err) {
                  obj.callback(err);
                  return;
                }

                recurse(resp.rows[0].id);
              });
            });

            return;
          }

          // Move to next child
          updateChild();
        });

        return;
      }

      // Loop to next authorization
      propagate();
    };

    // Propagate recursively
    recurse = function (roleId) {
      propagateAuth({
        folderId: child.id,
        roleId: roleId,
        isDeleted: obj.isDeleted,
        client: obj.client,
        callback: propagate
      });
    };

    // Real work starts here
    if (obj.roleId) {
      getKey({
        id: obj.roleId,
        client: obj.client,
        callback: afterGetRoleId
      });
      return;
    }

    getAuths();
  };

  /** private */
  propagateViews = function (name) {
    var props, key, cprops, ckey,
      catalog = that.getSettings("catalog");

    createView(name);

    /* Propagate relations */
    for (key in catalog) {
      if (catalog.hasOwnProperty(key)) {
        cprops = catalog[key].properties;

        for (ckey in cprops) {
          if (cprops.hasOwnProperty(ckey) &&
              typeof cprops[ckey].type === "object" &&
              cprops[ckey].type.relation === name &&
              !cprops[ckey].type.childOf &&
              !cprops[ckey].type.parentOf) {
            propagateViews(key);
          }
        }
      }
    }

    /* Propagate down */
    for (key in catalog) {
      if (catalog.hasOwnProperty(key) && catalog[key].inherits === name) {
        propagateViews(key);
      }
    }

    /* Propagate up */
    props = catalog[name].properties;
    for (key in props) {
      if (props.hasOwnProperty(key)) {
        if (typeof props[key].type === "object" && props[key].type.childOf) {
          createView(props[key].type.relation);
        }
      }
    }
  };

  /** private */
  relationColumn = function (key, relation) {
    return "_" + key.toSnakeCase() + "_" + relation.toSnakeCase() + "_pk";
  };

  sanitize = function (obj) {
    var oldObj, newObj, oldKey, newKey, keys, klen, n,
      isArray = Array.isArray(obj),
      ary = isArray ? obj : [obj],
      len = ary.length,
      i = 0;

    while (i < len) {
      /* Copy to convert dates back to string for accurate comparisons */
      oldObj = JSON.parse(JSON.stringify(ary[i]));
      newObj = {};

      keys = Object.keys(oldObj);
      klen = keys.length;
      n = 0;

      while (n < klen) {
        oldKey = keys[n];
        n++;

        /* Remove internal properties */
        if (oldKey.match("^_")) {
          delete oldObj[oldKey];
        } else {
          /* Make properties camel case */
          newKey = oldKey.toCamelCase();
          newObj[newKey] = oldObj[oldKey];

          /* Recursively sanitize objects */
          if (typeof newObj[newKey] === "object") {
            newObj[newKey] = newObj[newKey] ? sanitize(newObj[newKey]) : {};
          }
        }
      }

      ary[i] = newObj;
      i++;
    }

    return isArray ? ary : ary[0];
  };

  /** private */
  setCurrentUser = function (user) {
    currentUser = user;
  };
}(exports));


