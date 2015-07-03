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
(function () {

  /**
     Change string with underscores '_' to camel case.
     @param {Boolean} Convert first character to upper case. Default false.
     @returns {String}
  */
  String.prototype.toCamelCase = function (upper) {
    var str = this.replace(/-+(.)?/g, function (match, chr) {
      return chr ? chr.toUpperCase() : '';
    });

    return upper ? str.slice(0, 1).toUpperCase() + str.slice(1) : str;
  };

  /**
     Change a camel case string to snake case.
     @returns {String} The argument modified
  */
  String.prototype.toSnakeCase = function () {
    return this.replace((/([a-z])([A-Z])/g), '$1_$2').toLowerCase();
  };

}());

