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
/*global require, module*/
/*jslint browser*/
(function () {
    "use strict";

    const catalog = require("catalog");
    const model = require("model");
    const list = require("list");

    /*
      Contact Model
    */
    function contactModel(data, feather) {
        feather = feather || catalog.getFeather("Contact");
        let that = model(data, feather);
        let d = that.data;

        function handleName() {
            if (d.firstName()) {
                d.fullName(d.firstName() + " " + d.lastName());
            } else {
                d.fullName(d.lastName());
            }
        }

        that.onChanged("firstName", handleName);
        that.onChanged("lastName", handleName);

        return that;
    }

    contactModel.list = list("Contact");

    catalog.register("models", "contact", contactModel);
    module.exports = contactModel;

}());