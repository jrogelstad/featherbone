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
/*global require, module*/
/*jslint this, es6*/
(function () {
    "use strict";

    var contactRelation = {},
        catalog = require("catalog"),
        relationWidget = require("relation-widget").component,
        stream = require("stream");

    /**
      @param {Object} Options
      @param {Object} [options.parentViewModel] Parent view-model. Required
        property "relations" returning javascript object to attach relation view model to.
      @param {String} [options.parentProperty] Name of the relation
        in view model to attached to
      @param {String} [options.valueProperty] Value property
      @param {Object} [options.form] Form configuration
      @param {Object} [options.list] (Search) List configuration
      @param {Boolean} [options.isCell] Use style for cell in table
      @param {Object} [options.filter] Filter object used for search
    */
    contactRelation.viewModel = function (options) {
        var vm = relationWidget(options);

        return vm;
    };

    contactRelation.component = {
        oninit: function (vnode) {
            var list,
                options = vnode.attrs,
                id = vnode.attrs.form || "6kir5kogekam",
                oninit = relationWidget.oninit.bind(this);

            list = {
                columns: [{
                    "attr": "firstName"
                }, {
                    "attr": "lastName"
                }, {
                    "attr": "phone"
                }, {
                    "attr": "email"
                }, {
                    "attr": "address.city"
                }, {
                    "attr": "address.state"
                }]
            };

            options.parentProperty = options.parentProperty;
            options.valueProperty = options.valueProperty || "fullName";
            options.labelProperty = options.labelProperty || "phone";
            options.form = catalog.store().forms()[id];
            options.list = options.list || list;
            options.style = options.style || {};
            options.isCell = options.isCell === undefined
                ? false
                : options.isCell;
            oninit(vnode);
        },
        view: relationWidget.view,
        labelProperty: stream("phone"),
        valueProperty: stream("fullName")
    };

    catalog.register("components", "contactRelation", contactRelation.component);
    module.exports = contactRelation;

}());