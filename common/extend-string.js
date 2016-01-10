/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

(function () {

  /**
     Change string with underscores '_' or '-' to camel case.
     @param {Boolean} Convert first character to upper case. Default false.
     @returns {String}
  */
  String.prototype.toCamelCase = function (upper) {
    var f = this.slice(0, 1),
      str = this.replace(/[_,-]+(.)?/g, function (match, chr) {
        return chr ? chr.toUpperCase() : '';
      });

    return (upper ? f.toUpperCase() : f.toLowerCase()) + str.slice(1);
  };

  /**
     Change a path to a capitalized name.

     "contact.name".toName() // "Contact Name"

     @returns {String}
  */
  String.prototype.toName = function () {
    return this.replace(/\./g,' _').toCamelCase().toProperCase(true);
  };

  /**
     Change a camel case string to proper case.
     @returns {String} The argument modified
  */
  String.prototype.toProperCase = function () {
    var str = this.replace((/([a-z])([A-Z])/g), '$1 $2');
    return str.slice(0, 1).toUpperCase() + str.slice(1);
  };

  /**
     Change a camel case string to snake case.
     @returns {String} The argument modified
  */
  String.prototype.toSnakeCase = function () {
    return this.replace((/([a-z])([A-Z])/g), '$1_$2').toLowerCase();
  };

  /**
     Change a camel case string to spinal case.
     @returns {String} The argument modified
  */
  String.prototype.toSpinalCase = function () {
    return this.replace((/([a-z])([A-Z])/g), '$1-$2').toLowerCase();
  };

}());

