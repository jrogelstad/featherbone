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
/*jslint browser unordered*/
/**
    @module Datasource
*/
const m = window.m;
/**
    @class Datasource
    @static
*/
const datasource = {
    /**
        Returns the base url used to fetch and post data

        @method baseUrl
        @return {String}
    */
    baseUrl: function () {
        let l = window.location;
        let pathname = l.pathname.replaceAll("/", "");

        let port = (
            l.port
            ? ":" + l.port
            : ""
        );
        return (
            location.protocol + "//" +
            l.hostname + port + "/" +
            pathname
        );
    },

    /**
        Ajax request. (Need to explain this)

        @method request
        @return {String}
    */
    request: function (options) {
        options.url = datasource.baseUrl() + options.path;
        if (options.id) {
            options.url += options.id;
        }
        delete options.name;
        delete options.id;

        return m.request(options);
    }
};

export default Object.freeze(datasource);

