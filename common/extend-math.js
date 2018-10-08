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
/*jslint white */
(function () {
  'strict';

  /**
    Add two numbers to a give scale, or an array of numbers to a given scale.
    If no scale is provided, scale will default to zero.

    @param {Number} Value 1
    @param {Number} Value 2 or Scale if first parameter is array
    @param {Number} Scale, default 8
  */
  Math.add = function (value1, value2, scale) {
    var x = 0.0,
      power;

    scale =  scale || 8;
    power = Math.pow(10, scale);
    x = value1 * power + value2 * power;

    return x !== 0 ? Math.round(x) / power : x;
  };

  /**
    @param {Number} Value 1
    @param {Number} Value 2
    @param {Number} Scale, default 8
  */
  Math.subtract = function (value1, value2, scale) {
    scale =  scale || 8;
  
    var power = Math.pow(10, scale),
      res = Math.round(value1 * power - value2 * power);

    return res !== 0 ? res / power : 0;
  };

}());

