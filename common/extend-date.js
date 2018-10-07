/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
  'strict';

  /**
     Change string with underscores '_' or '-' to camel case.
     @param {Boolean} Convert first character to upper case. Default false.
     @returns {String}
  */
  Date.prototype.toLocalDateTime = function () {
    return this.getFullYear() + '-' + this.getMonth().pad(2) + '-' + this.getDate().pad(2) +
      "T" + this.getHours().pad(2) + ":" + this.getMinutes().pad(2);
  };

}());

