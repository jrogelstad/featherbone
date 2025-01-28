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
    @module AutoNumber
*/

const autonumber = {};

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

    that = f.createModel(undefined, feather);

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

/**
    @class AutoNumber
    @namespace ViewModels
    @param {Object} options
    @param {Object} options.parentViewModel
    @param {String} options.parentProprety
    @param {String} [options.id]
    @param {String} [options.key]
    @param {String} [options.readonly]
    @param {Object} [options.style]
*/
autonumber.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;

    /**
        Edit dialog view model.
        @method authonumberDialog
        @param {ViewModels.FormDialog} formDialog
        @return {ViewModels.FormDialog}
    */
    vm.autonumberDialog = f.prop();
    /**
        Clear button view model.
        @method buttonClear
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonClear = f.prop();
    /**
        Edit button view model.
        @method buttonEdit
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonEdit = f.prop();
    /**
        Edit dialog content.
        @method content
        @param {Boolean} isCell
        @return {Object} View
    */
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
    /**
        @method doClear
    */
    vm.doClear = function () {
        vm.autonumberDialog().cancel();
        vm.model(null);
    };
    /**
        Show edit dialog.
        @method doEdit
    */
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
    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id || f.createId());

    /**
        @method key
        @param {String} key
        @return {String}
    */
    vm.key = f.prop(options.key || f.createId());

    /**
        @method model
        @return {Model} Parent model
    */
    vm.model = parent.model().data[options.parentProperty];
    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop(options.style || {});

    // ..........................................................
    // PRIVATE
    //

    vm.autonumberDialog(f.createViewModel("FormDialog", {
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

    vm.buttonClear(f.createViewModel("Button", {
        onclick: vm.doClear,
        label: "C&lear"
    }));

    vm.buttonEdit(f.createViewModel("Button", {
        onclick: vm.doEdit,
        title: "Edit autonumber details",
        icon: "edit",
        class: "fb-data-type-edit-button"
    }));

    vm.autonumberDialog().buttons().push(vm.buttonClear);

    return vm;
};

/**
    Auto number component

    @class AutoNumber
    @static
    @namespace Components
*/
autonumber.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} vnode.attrs.parentViewModel
        @param {String} vnode.attrs.parentProprety
        @param {String} [vnode.attrs.id]
        @param {String} [vnode.attrs.readonly]
        @param {Object} [vnode.attrs.style] Style
    */
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

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} View
    */
    view: function (vnode) {
        let ret;
        let vm = this.viewModel;
        let theStyle = vm.style();
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

        theStyle.display = theStyle.display || "inline-block";

        // Build the view
        ret = m("div", {
            style: theStyle,
            key: vm.key()
        }, [
            m(f.getComponent("Dialog"), {
                viewModel: vm.autonumberDialog()
            }),
            m("input", options),
            m(f.getComponent("Button"), {
                viewModel: vm.buttonEdit()
            })
        ]);

        return ret;
    }
};

f.catalog().register(
    "components",
    "autonumber",
    autonumber.component
);


