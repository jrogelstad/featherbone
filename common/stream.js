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
/*global module*/
/*jslint white, es6*/
(function () {
  "use strict";

  /**
    This is used instead of Mithril `stream` because
    we aren't using all the stream features there
    and would prefer to avoid the overhead.
    
    Returns a getter setter function.
    
      var prop1 = stream("Demo"),
      var prop2 = stream(5);
      
      console.log(prop1())           // Prints 'Demo'
      console.log(prop2())           // Prints 5
      console.log(prop1(10))         // Prints 10;
      console.log(prop1() * prop2()) // Prints 50
    
    @param {Any} Value to persist locally
    @return {Function}
  */
  function stream (value) {
    var store = value;

    return function (...args) {
      if (args.length &&
          args[0] !== store) {
        store = args[0];
      }

      return store;
    };
  }

  module.exports = stream;
}());

