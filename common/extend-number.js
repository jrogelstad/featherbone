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
/*jslint this */
(function () {
    'strict';
    /**
        Add padding to a number.

          pad(9, 3);      // "009";
          pad(12, 3);     // "012"
          pad(9, 3, '-')  // "--9"

        @param {Number} Number
        @param {Number} Width
        @param {String} Pad character, default 0
        @return {String}
    */
    Number.prototype.pad = function (width, str) {
        var n = this + '',
            a = [];
        str = str || '0';
        if (n.length < width) {
            a.length = width - n.length + 1;
        }

        return a.length
            ? a.join(str) + n
            : n;
    };


}());