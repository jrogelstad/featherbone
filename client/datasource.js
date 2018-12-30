/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
const that = {
    /**
    Returns the base url used to fetch and post data
    @return {String}
    */
    baseUrl: function () {
        let l = window.location;
        return "http://" + l.hostname + ":" + l.port;
    },

    request: function (options) {
        options.url = that.baseUrl() + options.path;
        if (options.id) {
            options.url += options.id;
        }
        delete options.name;
        delete options.id;

        return m.request(options);
    }
}

export const datasource = Object.freeze(that);

