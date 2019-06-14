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
import catalog from "../models/catalog.js";
import button from "./button.js";
import formDialog from "./form-dialog.js";

const addressRelation = {};
const m = window.m;

addressRelation.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;

    vm.addressDialog = f.prop();
    vm.buttonClear = f.prop();
    vm.content = function (isCell) {
        let d;
        let content = "";
        let cr = "\n";

        if (!vm.model()) {
            return content;
        }
        d = vm.model().data;

        content = d.street();

        if (isCell) {
            return content;
        }

        if (d.unit()) {
            content += cr + d.unit();
        }

        content += cr + d.city() + ", ";
        content += d.state() + " " + d.postalCode();
        content += cr + d.country();

        return content;
    };
    vm.countries = function () {
        let countries = catalog.store().data().countries().map(
            function (model) {
                return model.data.name();
            }
        ).sort();

        countries.unshift("");

        return countries;
    };
    vm.doClear = function () {
        vm.addressDialog().cancel();
        vm.model(null);
    };
    vm.doEdit = function () {
        let value;
        let dmodel;
        let addressDialog = vm.addressDialog();

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
    vm.id = f.prop(options.id || f.createId());
    vm.isCell = f.prop(options.isCell);
    vm.model = parent.model().data[options.parentProperty];
    vm.onkeydown = function (e) {
        if (e.key === "Enter") { // Enter key
            vm.doEdit();
        } else if (e.key !== "Tab") {
            e.preventDefault();
        }
    };
    vm.states = function () {
        let states = catalog.store().data().states().map(function (model) {
            return model.data.code();
        }).sort();

        states.unshift("");
        return states;
    };
    vm.style = f.prop(options.style || {});

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
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = addressRelation.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            isCell: options.isCell,
            style: options.style,
            readonly: options.readonly
        });
    },

    view: function (vnode) {
        let ret;
        let vm = this.viewModel;
        let style = vm.style();
        let readonly = vnode.attrs.isReadOnly() === true;
        let options = {
            id: vm.id(),
            class: "fb-input",
            value: vm.content(vm.isCell()),
            readonly: readonly,
            rows: 4
        };

        if (vm.isCell()) {
            options.rows = 1;
            options.style = {
                width: "100%"
            };
        }

        if (!readonly) {
            options.title = "Click or Enter key to edit";
            options.onkeydown = vm.onkeydown;
            options.onclick = vm.doEdit;
        }

        style.display = style.display || "inline-block";

        // Build the view
        ret = m("div", {
            style: style
        }, [
            m(formDialog.component, {
                viewModel: vm.addressDialog()
            }),
            m("textarea", options)
        ]);

        return ret;
    }
};

catalog.register(
    "components",
    "addressRelation",
    addressRelation.component
);
export default Object.freeze(addressRelation);

