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
        relationWidget = require("relation-widget"),
        stream = require("stream"),
        m = require("mithril");

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
        var vm = relationWidget.viewModel(options);

        vm.labels = function () {
            var phone, email, address, phoneUrl, emailUrl, addressUrl,
                    elements = [],
                    model = options.parentViewModel.model().data[options.parentProperty]();

            if (model) {
                phone = model.data.phone();
                email = model.data.email();
                address = model.data.address();

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
                                    class: "fa fa-phone suite-contact-relation-icon"
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
                                    class: "fa fa-envelope-o suite-contact-relation-icon"
                                })
                            ])
                        ], email)
                    );
                }

                if (address) {
                    addressUrl = "https://maps.google.com/?q=" +
                            address.data.street() + ", " +
                            address.data.city() + ", " +
                            address.data.state() + ", " +
                            address.data.postalCode() + "/";

                    elements.push(
                        m("li", {
                            class: "pure-menu-item"
                        }, [
                            m("a", {
                                href: addressUrl,
                                target: "_blank"
                            }, [
                                m("i", {
                                    class: "fa fa-map-marker suite-contact-relation-icon"
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
            var list,
                options = vnode.attrs,
                id = vnode.attrs.form || "6kir5kogekam",
                relations = options.parentViewModel.relations();

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

            options.isCell = options.isCell === undefined
                ? false
                : options.isCell;

            // Set up viewModel if required
            if (!relations[options.parentProperty]) {
                relations[options.parentProperty] = contactRelation.viewModel({
                    parentViewModel: options.parentViewModel,
                    parentProperty: options.parentProperty,
                    valueProperty: options.valueProperty || "fullName",
                    form: catalog.store().forms()[id],
                    list: options.list || list,
                    filter: options.filter,
                    isCell: options.isCell,
                    id: options.id,
                    disabled: options.disabled,
                    style: options.style || {}
                });
            }
            this.viewModel = relations[options.parentProperty];
        },
        view: relationWidget.component.view,
        labelProperty: stream("phone"),
        valueProperty: stream("fullName")
    };

    catalog.register("components", "contactRelation", contactRelation.component);
    module.exports = contactRelation;

}());