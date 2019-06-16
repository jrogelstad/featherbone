/*
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
*/
/*jslint this, browser*/
import f from "../core.js";
import relationWidget from "./relation-widget.js";
import catalog from "../models/catalog.js";

/*
    @class contactRelation
*/
const contactRelation = {};
const m = window.m;

/*

    @method viewModel
    @param {Object} Options
    @param {Object} [options.parentViewModel] Parent view-model. Required
    property "relations" returning javascript object to attach relation
    view model to.
    @param {String} [options.parentProperty] Name of the relation
    in view model to attached to
    @param {String} [options.valueProperty] Value property
    @param {Object} [options.form] Form configuration
    @param {Object} [options.list] (Search) List configuration
    @param {Boolean} [options.isCell] Use style for cell in table
    @param {Object} [options.filter] Filter object used for search
*/
contactRelation.viewModel = function (options) {
    let vm = relationWidget.viewModel(options);

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
                                    "fa fa-phone fb-contact-relation-icon " +
                                    "fb-icon-button"
                                )
                            })
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
                                class: (
                                    "fa fa-envelope " +
                                    "fb-contact-relation-icon " +
                                    "fb-icon-button"
                                )
                            })
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
                                    "fa fa-map-marker " +
                                    "fb-contact-relation-icon " +
                                    "fb-icon-button"
                                )
                            })
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

contactRelation.component = {
    oninit: function (vnode) {
        let list;
        let form;
        let options = vnode.attrs;
        let id = vnode.attrs.form || "6kir5kogekam";
        let relations = options.parentViewModel.relations();

        form = catalog.store().data().forms().find(
            (row) => id === row.id
        );

        if (form) {
            form = form.toJSON();
        }

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
                form: form,
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
    view: relationWidget.component.view,
    labelProperty: f.prop("phone"),
    valueProperty: f.prop("fullName")
};

catalog.register(
    "components",
    "contactRelation",
    contactRelation.component
);

export default Object.freeze(contactRelation);