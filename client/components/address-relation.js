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
/*jslint this*/
(function () {
    "use strict";

    var addressRelation = {},
        m = require("mithril"),
        f = require("common-core"),
        formDialog = require("form-dialog"),
        stream = require("stream"),
        catalog = require("catalog"),
        button = require("button");

    addressRelation.viewModel = function (options) {
        var vm = {},
            parent = options.parentViewModel;

        vm.addressDialog = stream();
        vm.buttonClear = stream();
        vm.content = function (isCell) {
            var d, content;

            if (!vm.model()) {
                return content;
            }
            d = vm.model().data;

            content = d.street();

            if (isCell) {
                return content;
            }

            if (d.unit()) {
                content += "\x0A" + d.unit();
            }

            content += "\x0A" + d.city() + ", " +
                    d.state() + " " + d.postalCode() +
                    "\x0A" + d.country();

            return content;
        };
        vm.countries = function () {
            var countries = catalog.store().data().countries().map(function (model) {
                return model.data.name();
            }).sort();

            countries.unshift("");

            return countries;
        };
        vm.doClear = function () {
            vm.addressDialog().cancel();
            vm.model(null);
        };
        vm.doEdit = function () {
            var value, dmodel,
                    addressDialog = vm.addressDialog();

            function applyEdit() {
                vm.model(dmodel.toJSON());
            }

            addressDialog.onOk(applyEdit);
            addressDialog.show();
            dmodel = vm.addressDialog().formWidget().model();
            if (vm.model()) {
                value = vm.model().toJSON();
                dmodel.set(value);
                dmodel.state().goto("/Ready/Fetched/Clean");
            }
        };
        vm.id = stream(options.id || f.createId());
        vm.isCell = stream(options.isCell);
        vm.model = parent.model().data[options.parentProperty];
        vm.onkeydown = function (e) {
            if (e.key === "Enter") { // Enter key
                vm.doEdit();
            } else if (e.key !== "Tab") {
                e.preventDefault();
            }
        };
        vm.states = function () {
            var states = catalog.store().data().states().map(function (model) {
                return model.data.code();
            }).sort();

            states.unshift("");
            return states;
        };
        vm.style = stream(options.style || {});

        // ..........................................................
        // PRIVATE
        //

        vm.addressDialog(formDialog.viewModel({
            title: "Address",
            model: "address",
            config: {
                attrs: [{
                    attr: "type"
                }, {
                    attr: "street"
                }, {
                    attr: "unit"
                }, {
                    attr: "city"
                }, {
                    attr: "state",
                    dataList: vm.states()
                }, {
                    attr: "postalCode"
                }, {
                    attr: "country",
                    dataList: vm.countries()
                }]
            }
        }));

        vm.buttonClear(button.viewModel({
            onclick: vm.doClear,
            label: "C&lear"
        }));

        vm.addressDialog().buttons().push(vm.buttonClear);

        return vm;
    };

    addressRelation.component = {
        oninit: function (vnode) {
            var options = vnode.attrs;

            // Set up viewModel if required
            this.viewModel = addressRelation.viewModel({
                parentViewModel: options.parentViewModel,
                parentProperty: options.parentProperty,
                id: options.id,
                isCell: options.isCell,
                style: options.style,
                disabled: options.disabled
            });
        },

        view: function (vnode) {
            var ret,
                vm = this.viewModel,
                style = vm.style(),
                disabled = vnode.attrs.disabled === true;

            style.display = style.display || "inline-block";

            // Build the view
            ret = m("div", {
                style: style
            }, [
                m(formDialog.component, {
                    viewModel: vm.addressDialog()
                }),
                m("textarea", {
                    id: vm.id(),
                    title: "Click or Enter key to edit",
                    class: "fb-input",
                    onkeydown: vm.onkeydown,
                    onclick: vm.doEdit,
                    value: vm.content(vm.isCell()),
                    disabled: disabled,
                    rows: 4
                })
            ]);

            return ret;
        }
    };

    catalog.register("components", "addressRelation", addressRelation.component);
    module.exports = addressRelation;

}());


