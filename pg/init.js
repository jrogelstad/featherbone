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
return (function () {
  var result, row,
    sql = "SELECT * FROM \"$script\"",
    loaded = {},
    i = 0,
    load = function (name, script, requires) {
      if (loaded[name]) { return; }

      var req, n = 0,
        required = result.filter(function (rec) {
          return requires.indexOf(rec.name) !== -1;
        }) || [];

      /* Recursively load requirements */
      while (n < required.length) {
        req = required[n];

        load(req.name, req.script, req.requires);

        n++;
      }

      eval(script);
      loaded[name] = true;
    };

  result = plv8.execute(sql);

  while (i < result.length) {
    row = result[i];

    load(row.name, row.script, row.requires);

    i++;
  }

  plv8._init = true;
}());

