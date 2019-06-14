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
import model from "../models/model.js";
import button from "./button.js";
import formDialog from "./form-dialog.js";

const autonumber = {};
const m = window.m;

function autonumberModel() {
    let feather;
    let that;

    feather = {
        name: "autonumber",
        properties: {
            id: {
                type: "string",
                default: "createId()"
            },
            prefix: {
                description: "Character(s) to prefix number",
                type: "string"
            },
            sequence: {
                description: "The name of the number sequence",
                type: "string"
            },
            length: {
                description: "Number of digits in number",
                type: "integer",
                default: 5,
                min: 1,
                max: 8
            },
            suffix: {
                description: "Character(s) to suffix number",
                type: "string"
            }
        }
    };

    that = model(undefined, feather);

    that.onChange("sequence", function (prop) {
        let value = prop.newValue();

        if (typeof value === "string") {
            prop.newValue(value.toSnakeCase());
        } else {
            prop.newValue("");
        }
    });

    that.state().resolve("/Ready/Fetched/Locking").enters.shift();
    that.state().resolve("/Ready/Fetched/Locking").enter(function () {
        this.goto("../Dirty");
    });

    return that;
}

autonumber.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;

    vm.autonumberDialog = f.prop();
    vm.buttonClear = f.prop();
    vm.buttonEdit = f.prop();
    vm.content = function () {
        let d = vm.model();
        let content = "";
        let n = 0;

        if (!d) {
            return content;
        }

        content = d.prefix + n.pad(d.length) + d.suffix;

        return content;
    };
    vm.doClear = function () {
        vm.autonumberDialog().cancel();
        vm.model(null);
    };
    vm.doEdit = function () {
        let value;
        let dmodel;
        let autonumberDialog = vm.autonumberDialog();

        function applyEdit() {
            value = dmodel.toJSON();
            delete value.id;
            vm.model(value);
        }

        autonumberDialog.onOk(applyEdit);
        autonumberDialog.show();
        dmodel = vm.autonumberDialog().formWidget().model();
        if (vm.model()) {
            value = vm.model();
            dmodel.set(value);
            dmodel.state().goto("/Ready/Fetched/Clean");
        } else {
            dmodel.clear();
        }
    };
    vm.id = f.prop(options.id || f.createId());
    vm.model = parent.model().data[options.parentProperty];
    vm.style = f.prop(options.style || {});

    // ..........................................................
    // PRIVATE
    //

    vm.autonumberDialog(formDialog.viewModel({
        title: "Auto number",
        model: autonumberModel(),
        config: {
            attrs: [{
                attr: "prefix"
            }, {
                attr: "sequence"
            }, {
                attr: "length"
            }, {
                attr: "suffix"
            }]
        }
    }));

    vm.buttonClear(button.viewModel({
        onclick: vm.doClear,
        label: "C&lear"
    }));

    vm.buttonEdit(button.viewModel({
        onclick: vm.doEdit,
        title: "Edit autonumber details",
        icon: "edit",
        class: "fb-data-type-edit-button"
    }));

    vm.autonumberDialog().buttons().push(vm.buttonClear);

    return vm;
};

autonumber.component = {
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = autonumber.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            style: options.style,
            readonly: options.readonly
        });
    },

    view: function (vnode) {
        let ret;
        let vm = this.viewModel;
        let style = vm.style();
        let options = {
            id: vm.id(),
            class: "fb-data-list-input",
            value: vm.content(),
            readonly: true
        };

        if (vnode.attrs.readonly) {
            vm.buttonEdit().disable();
        } else {
            vm.buttonEdit().enable();
        }

        style.display = style.display || "inline-block";

        // Build the view
        ret = m("div", {
            style: style
        }, [
            m(formDialog.component, {
                viewModel: vm.autonumberDialog()
            }),
            m("input", options),
            m(button.component, {
                viewModel: vm.buttonEdit()
            })
        ]);

        return ret;
    }
};

catalog.register(
    "components",
    "autonumber",
    autonumber.component
);
export default Object.freeze(autonumber);

