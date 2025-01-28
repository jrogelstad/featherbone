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
    @module Date
*/
(function () {
    "use strict";
    /**
        Helper functions added to JavaScript
        <a href='https://developer.mozilla.org/
        en-US/docs/Web/JavaScript/Reference/
        Global_Objects/Date'>Date</a> prototype.

        @class Date
        @constructor
        @returns {Date}
    */

    /**
        Convert date to "YYYY-MM-DDTHH:MM" date time format.

        @method toLocalDateTime
        @return {String}
    */
    Date.prototype.toLocalDateTime = function () {
        let month = this.getMonth() + 1;
        let ret;

        ret = this.getFullYear() + "-" + month.pad(2) + "-";
        ret += this.getDate().pad(2) + "T" + this.getHours().pad(2);
        ret += ":" + this.getMinutes().pad(2);

        return ret;
    };

    /**
       Convert date to "YYYY-MM-DD" format.

        @method toLocalDate
        @return {String}
    */
    Date.prototype.toLocalDate = function () {
        let month = this.getMonth() + 1;
        let ret;

        ret = this.getFullYear() + "-" + month.pad(2) + "-";
        ret += this.getDate().pad(2);

        return ret;
    };

    /**
        Strip time off date

        @method toDate
        @return {String}
    */
    Date.prototype.toDate = function () {
        this.setHours(0);
        this.setMinutes(0);
        this.setSeconds(0);
        this.setMilliseconds(0);
        return this;
    };

    /**
       Return the week number of the date.

       From: https://weeknumber.net/how-to/javascript

       @method getWeek
       @return {number}
    */
    Date.prototype.getWeek = function () {
        let date = new Date(this.getTime());
        let week1;

        date.setHours(0, 0, 0, 0);
        // Thursday in current week decides the year.
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        // January 4 is always in week 1.
        week1 = new Date(date.getFullYear(), 0, 4);
        // Adjust to Thursday in week 1 and count number of weeks
        // from date to week1.
        return 1 + Math.round(
            (
                (
                    date.getTime() - week1.getTime()
                ) / 86400000 - 3 + (week1.getDay() + 6) % 7
            ) / 7
        );
    };
}());