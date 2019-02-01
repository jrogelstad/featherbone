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
/*jslint this, browser*/
import f from "../core.js";
import catalog from "../models/catalog.js";
import dialog from "./dialog.js";

const dataType = {};
const m = window.m;

dataType.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;

    vm.dataTypeDialog = f.prop();
    vm.childOf = f.prop("");
    vm.feathers = function () {
        let countries = catalog.store().data().countries().map(
            function (model) {
                return model.data.name();
            }
        ).sort();

        countries.unshift("");

        return countries;
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
    vm.onchange = function (e) {
        if (e.target.value === "relation") {
            vm.dataTypeDialog().show();
        } else {
            vm.prop(e.target.value);
        }
    };
    vm.properties = function () {
        let props = [];
        let feather;
        let relation = vm.relation();

        if (relation) {
            feather = catalog.getFeather(relation);
            props = Object.keys(feather.properties);
        }

        return props;
    };
    vm.propertiesAvailable = function () {
        let props = vm.properties().slice();
        let selected = vm.propertiesSelected();

        return props.filter(function (p) {
            return selected.indexOf(p) !== -1;
        });
    };
    vm.propertiesSelected = f.prop([]);
    vm.relation = f.prop();
    vm.style = f.prop(options.style || {});
    vm.prop = options.parentViewModel.model().data[options.parentProperty];
    vm.type = function () {
        let type = vm.prop();

        if (typeof type === "object") {
            return "relation";
        }

        return type;
    };
    vm.types = f.prop(Object.freeze([
        "array",
        "integer",
        "number",
        "object",
        "relation",
        "string"
    ]));
    vm.update = function () {
        let type = vm.type();
        let relation = vm.relation();
        let childOf = vm.childOf();
        let value = type;
        let props;

        if (type === "relation") {
            value = {
                relation: relation
            };

            props = vm.propertiesSelected();
            if (props) {
                value.properties = props;
            } else if (childOf) {
                value.childOf = childOf;
            }
        }

        vm.prop(value);
    };

    // ..........................................................
    // PRIVATE
    //

    vm.dataTypeDialog(dialog.viewModel({
        icon: "edit",
        title: "Data type"
    }));

    vm.dataTypeDialog().content = function () {
        let id = vm.id();
        let v = m("select", {
            id: id,
            key: id,
            onchange: vm.onchange,
            value: vm.type()
        }, vm.types().map(function (item) {
            return m("option", {
                value: item,
                label: item,
                key: id + "$" + item
            });
        }));

        return v;
    };

    return vm;
};

dataType.component = {
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = dataType.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            isCell: options.isCell,
            style: options.style,
            disabled: options.disabled
        });
    },

    view: function (vnode) {
        let ret;
        let vm = this.viewModel;
        let id = vm.id();
        let style = vm.style();
        let disabled = vnode.attrs.disabled === true;

        style.display = style.display || "inline-block";

        // Build the view
        ret = m("div", {
            style: style
        }, [
            m(dialog.component, {
                viewModel: vm.dataTypeDialog()
            }),
            m("select", {
                id: id,
                key: id,
                onchange: vm.onchange,
                value: vm.type(),
                disabled: disabled
            }, vm.types().map(function (item) {
                let opts = {
                    value: item,
                    label: item,
                    key: id + "$" + item
                };
                if (vm.type() === item) {
                    opts.selected = true;
                }
                return m("option", opts);
            }))
        ]);

        return ret;
    }
};

catalog.register(
    "components",
    "dataType",
    dataType.component
);
