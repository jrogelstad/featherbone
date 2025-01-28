/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
*/
/*jslint this*/
/**
    @module String
*/
(function () {
    "use strict";
    /**
        Helper functions added to JavaScript
        <a href='https://developer.mozilla.org/
        en-US/docs/Web/JavaScript/Reference/
        Global_Objects/String'>String</a> prototype.

        @class String
        @constructor
        @returns {String}
    */

    /**
        Change string with underscores '_' or '-' to camel case.

        @example
            let str = "contact_name"
            str.toCamelCase() // "contactName"

        @method toCamelCase
        @param {Boolean} Convert first character to upper case. Default false.
        @chainable
        @return {String}
    */
    String.prototype.toCamelCase = function (upper) {
        let f = this.slice(0, 1);
        let re = new RegExp("[_,-]+(.)?", "g");
        let str = this.replace(re, function (ignore, chr) {
            return (
                chr
                ? chr.toUpperCase()
                : ""
            );
        });

        return (
            upper
            ? f.toUpperCase()
            : f.toLowerCase()
        ) + str.slice(1);
    };

    /**
       Change a path to a capitalized name.

        @example
            let str = "contact.name"
            str.toName() // "Contact Name"

        @method toName
        @chainable
        @return {String}
    */
    String.prototype.toName = function () {
        return this.replace(/\./g, " _").toCamelCase().toProperCase();
    };

    /**
        Change a camel case string to proper case.

        @example
            let str = "contactName"
            str.toProperCase() // "Contact Name"

        @method toProperCase
        @chainable
        @return {String}
    */
    String.prototype.toProperCase = function () {
        let str = this.replace((/([a-z])([A-Z])/g), "$1 $2");
        return str.slice(0, 1).toUpperCase() + str.slice(1);
    };

    /**
        Change a camel case string to snake case.

        @example
            let str = "contactName"
            str.toSnakeCase() // "contact_name"

        @method toSnakeCase
        @chainable
        @return {String} The argument modified
    */
    String.prototype.toSnakeCase = function () {
        return this.replace((/([a-z])([A-Z])/g), "$1_$2").toLowerCase();
    };

    /**
       Change a camel case string to spinal case.

        @example
            let str = "contactName"
            str.toSpinalCase() // "contact-name"

        @method toSpinalCase
        @chainable
        @return {String} The argument modified
    */
    String.prototype.toSpinalCase = function () {
        return this.replace((/([a-z])([A-Z])/g), "$1-$2").toLowerCase();
    };

}());