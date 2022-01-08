/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*jslint this, browser*/
/*global f, m*/
/**
    @module ResourceLinkRelation
*/

const resourceLinkRelation = {};

/**
    @class ResourceLinkRelation
    @extends ViewModels.ResourceLinkRelationWidget
    @constructor
    @namespace ViewModels
    @param {Object} options Options
    @param {Object} options.parentViewModel Parent view-model. Requires
    property `relations` returning javascript object to attach relation
    view model to.
    @param {String} options.parentProperty Name of the relation
    in view model to attached to
    @param {String} options.valueProperty Value property
    @param {Object} [options.form] Form configuration
    @param {Object} [options.list] (Search) List configuration
    @param {Boolean} [options.isCell] Use style for cell in table
    @param {Object} [options.filter] Filter object used for search
*/
resourceLinkRelation.viewModel = function (options) {
    let vm = f.createViewModel("RelationWidget", options);
    vm.labelClass = "fb-relation-label truncate";
    vm.labels = function () {
        let resource;
        let icon;
        let elements = [];
        let parentModel = options.parentViewModel.model();
        let model = parentModel.data[options.parentProperty]();

        if (model) {
            resource = (
                model.data.resource
                ? model.data.resource()
                : ""
            );
            icon = (
                model.data.icon
                ? model.data.icon()
                : ""
            );

            if (resource) {
                elements.push(
                    m("a", {
                        href: resource,
                        target: "_blank"
                    }, [
                        m("i", {
                            class: "material-icons fb-menu-list-icon"
                        }, (icon || "resource")),
                        resource
                    ])
                );
            }
        }
        return elements;
    };

    return vm;
};

f.catalog().register(
    "viewModels",
    "resourceLinkRelation",
    resourceLinkRelation.viewModel
);

/**
    @class ResourceLinkRelation
    @uses Components.RelationWidget
    @namespace Components
*/
resourceLinkRelation.component = {
    oninit: function (vnode) {
        let list;
        let theForm;
        let options = vnode.attrs;
        let id = vnode.attrs.form || "k529a1omkxdw";
        let relations = options.parentViewModel.relations();

        theForm = f.catalog().store().data().forms().find(
            (row) => id === row.id
        );

        if (theForm) {
            theForm = theForm.toJSON();
        }

        list = {
            columns: [{
                "attr": "icon"
            }, {
                "attr": "label"
            }, {
                "attr": "resource"
            }, {
                "attr": "displayValue"
            }]
        };

        options.isCell = (
            options.isCell === undefined
            ? false
            : options.isCell
        );

        // Set up viewModel if required
        if (!relations[options.parentProperty]) {
            relations[options.parentProperty] = resourceLinkRelation.viewModel({
                parentViewModel: options.parentViewModel,
                parentProperty: options.parentProperty,
                valueProperty: options.valueProperty || "displayValue",
                form: theForm,
                list: options.list || list,
                filter: options.filter,
                isCell: options.isCell,
                id: options.id,
                isReadOnly: options.isReadOnly,
                style: options.style || {}
            });
        }
        this.viewModel = relations[options.parentProperty];
    },

    view: f.getComponent("RelationWidget").view,
    labelProperty: f.prop("displayValue"),
    valueProperty: f.prop("displayValue")
};

f.catalog().register(
    "components",
    "resourceLinkRelation",
    resourceLinkRelation.component
);
