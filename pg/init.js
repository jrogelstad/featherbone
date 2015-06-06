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
/*global eval: true*/
(function () {
  //"use strict";

  // ..........................................................
  // LOCAL
  //

  var modules = plv8.execute("SELECT * FROM \"$module\""),
    i = 0, module, script;

  // ..........................................................
  // GLOBAL
  //

  /**
    Helper debug function. Raises a plv8 notice passing the value argument.
    @returns {String} Value
  */
  debug = function (value) {
    value = typeof value === "object" ? JSON.stringify(value, null, 2) : value;
    plv8.elog(NOTICE, value);
  };

  /**
    Load a module.
    @param {String} Module name
    @returns {Object} Exports
  */
  require = function (module) {
    var found = modules.filter(function (row) {
        return row.name === module;
      }), exports = {};

    if (!found.length) {
      plv8.elog(ERROR, "Module " + module + " not found.");
    }

    eval(found[0].script);

    return exports;
  };

  /**
    * Escape strings to prevent sql injection
      http://www.postgresql.org/docs/9.1/interactive/functions-string.html#FUNCTIONS-STRING-OTHER
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

    return plv8.execute("select format(" + params.toString(",") + ")", ary)[0].format;
  };

  /**
     Change string with underscores '_' to camel case.
     @returns {String}
  */
  String.prototype.toCamelCase = function () {
    return this.replace(/_+(.)?/g, function(match, chr) {
      return chr ? chr.toUpperCase() : '';
    });
  };

  /**
     Change a camel case string to snake case.
     @returns {String} The argument modified
  */
  String.prototype.toSnakeCase = function () {
    return this.replace((/([a-z])([A-Z])/g), '$1_$2').toLowerCase();
  };

  /**
     Change string with underscores '_' to proper case.
     @returns {String}
  */
  String.prototype.toProperCase = function () {
    return this.slice(0, 1).toUpperCase() + this.toCamelCase().slice(1);
  };

  // Load global modules
  while (i < modules.length) {
    module = modules[i];

    if (module.is_global) {
      script = module.name + "= require(\"" + module.name + "\");";
      eval(script);
    }

    i++;
  }
}());

