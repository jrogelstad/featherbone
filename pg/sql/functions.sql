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

/** Expose JavaScript functions to the database **/
CREATE OR REPLACE FUNCTION init() RETURNS void AS $$
  return (function () {

    var sql = "SELECT script FROM \"$script\"",
      i = 0, result;

    plv8.execute(sql);
    while (i < result.length) {
      eval(result[i].script);
      i++;
    }

    plv8._init = true;

  }());
$$ LANGUAGE plv8;

CREATE OR REPLACE FUNCTION request(obj json, init boolean default false) RETURNS json AS $$
  return (function () {
    if (init || !plv8._init) { plv8.execute('SELECT init()'); }

    return featherbone.request(obj);
  }());
$$ LANGUAGE plv8;