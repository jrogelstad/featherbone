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
/*jslint this, browser, unordered*/
/*global f, m*/
/**
    @module ContactRelation
*/

const contactRelation = {};

/**
    @class ContactRelation
    @extends ViewModels.RelationWidget
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
contactRelation.viewModel = function (options) {
    let vm = f.createViewModel("RelationWidget", options);

    vm.labels = function () {
        let phone;
        let email;
        let address;
        let phoneUrl;
        let emailUrl;
        let addressUrl;
        let elements = [];
        let parentModel = options.parentViewModel.model();
        let model = parentModel.data[options.parentProperty]();

        if (model) {
            phone = (
                model.data.phone
                ? model.data.phone()
                : ""
            );
            email = (
                model.data.email
                ? model.data.email()
                : ""
            );
            address = (
                model.data.address
                ? model.data.address()
                : ""
            );

            if (phone) {
                phoneUrl = "tel:" + phone;
                elements.push(
                    m("li", {
                        class: "pure-menu-item"
                    }, [
                        m("a", {
                            href: phoneUrl,
                            target: "_blank"
                        }, [
                            m("i", {
                                class: (
                                    "material-icons " +
                                    "fb-contact-relation-icon " +
                                    "fb-icon-button"
                                )
                            }, "phone")
                        ])
                    ], phone)
                );
            }

            if (email) {
                emailUrl = "mailto:" + email;

                elements.push(
                    m("li", {
                        class: "pure-menu-item"
                    }, [
                        m("a", {
                            href: emailUrl,
                            target: "_blank"
                        }, [
                            m("i", {
                                style: {
                                    verticalAlign: "bottom",
                                    fontSize: "18px"
                                },
                                class: (
                                    "material-icons " +
                                    "fb-contact-relation-icon " +
                                    "fb-icon-button"
                                )
                            }, "email")
                        ])
                    ], email)
                );
            }

            if (address) {
                addressUrl = "https://maps.google.com/?q=";
                addressUrl += address.data.street() + ", ";
                addressUrl += address.data.city() + ", ";
                addressUrl += address.data.state() + ", ";
                addressUrl += address.data.postalCode() + "/";

                elements.push(
                    m("li", {
                        class: "pure-menu-item"
                    }, [
                        m("a", {
                            href: addressUrl,
                            target: "_blank"
                        }, [
                            m("i", {
                                class: (
                                    "material-icons " +
                                    "fb-contact-relation-icon " +
                                    "fb-icon-button"
                                )
                            }, "place")
                        ])
                    ], address.data.city() + ", " + address.data.state())
                );
            }
        }

        return m("ul", {
            class: "pure-menu-list"
        }, elements);
    };

    return vm;
};

f.catalog().register(
    "viewModels",
    "contactRelation",
    contactRelation.viewModel
);

/**
    @class ContactRelation
    @uses Components.RelationWidget
    @namespace Components
*/
contactRelation.component = {
    oninit: function (vnode) {
        let list;
        let options = vnode.attrs;
        let relations = options.parentViewModel.relations();

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

        options.isCell = (
            options.isCell === undefined
            ? false
            : options.isCell
        );

        // Set up viewModel if required
        if (!relations[options.parentProperty]) {
            relations[options.parentProperty] = contactRelation.viewModel({
                parentViewModel: options.parentViewModel,
                parentProperty: options.parentProperty,
                valueProperty: options.valueProperty || "fullName",
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
    labelProperty: f.prop("phone"),
    valueProperty: f.prop("fullName")
};

f.catalog().register(
    "components",
    "contactRelation",
    contactRelation.component
);
