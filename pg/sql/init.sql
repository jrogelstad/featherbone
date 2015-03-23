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

create or replace function fp.init() returns void as $$
  return (function () {

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
      return this.replace(/_+(.)?/g, function(match, chr) {
        return chr ? chr.toUpperCase() : '';
      });
    }

    /**
       Change a camel case string to snake case.
       @returns {String} The argument modified
    */
    String.prototype.toSnakeCase = function () {
      return this.replace((/([a-z])([A-Z])/g), '$1_$2').toLowerCase();
    }

    /** TODO: We want to load these from tables **/
    plv8.execute("select fp.load_fp();");
    plv8.execute("select fp.load_jsonpatch();");
    plv8._init = true;

  }());
$$ language plv8;