drop function if exists fp.init();

create or replace function fp.init() returns void as $$
  return (function () {

    // ..........................................................
    // NATIVES
    //

    Object.prototype.isString = function () {
      return toString.call(this) === "[object String]";
    }

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
      Create a new table.

     * @param {Object} Specification to create a table.
     * @return {String}
    */
    FP.createClass = function (obj) {
      obj = obj || {};

      var schema = obj.namespace || 'fp',
        table = obj.name ? obj.name.toSnakeCase() : false,
        inheritSchema = (obj.inherits ? obj.inherits.ere || 'fp' : 'fp').toSnakeCase(),
        inheritTable = (obj.inherits ? obj.inherits.hind : 'object').toSnakeCase(),
        sql = 'select * from pg_tables where schemaname = $1 and tablename = $2;';

      if (!table || plv8.execute(sql, [schema, table]).length) { return false };

      sql = FP.formatSql('create table %I.%I() inherits (%I.%I)', [schema, table, inheritSchema, inheritTable]);
      plv8.execute(sql);
      
      return true;
    };

    /**
      Return a universally unique identifier.

      From http://stackoverflow.com/a/8809472/251019
      @return {String}
    */
    FP.createUuid = function () {
      var d = new Date().getTime();
      var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === 'x' ? r : (r&0x7|0x8)).toString(16);
      });

      return uuid;
    };

    /**
      Drop a table.

      * @param {Object} Table to drop.
      * @return {String}
    */
    FP.destroyClass = function (obj) {
      obj = obj || {};

      var schema = (obj.namespace || 'fp').toSnakeCase(),
        table = obj.name ? obj.name.toSnakeCase() : false,
        sql = 'select * from pg_tables where schemaname = $1 and tablename = $2;';

      if (!table || !plv8.execute(sql, [schema, table]).length) { return false };

      sql = FP.formatSql('drop table %I.%I', [schema, table]);
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
    FP.formatSql = function (str, args) {
      var params = [],
        n = 1;

      args = args || [];

      args.unshift(str);

      args.forEach(function() {
        params.push("$" + n);
        n++;
      });

      return plv8.execute("select format(" + params.toString(",") + ")", args)[0].format;
    }

    /**
      Return a the current user.

      @return {String}
    */
    FP.getCurrentUser = function () {

      return plv8.execute('select current_user as user')[0].user;
    }

    plv8._init = true;

  }());
$$ language plv8;