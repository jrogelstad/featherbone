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
    @Module DataList
*/

const dataList = {};
const table = {};

table.viewModel = function (options) {
    let tableState;
    let vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.buttonAdd = f.prop();
    vm.buttonOpen = f.prop();
    vm.buttonRemove = f.prop();
    vm.buttonUndo = f.prop();
    vm.tableWidget = f.prop();

    // ..........................................................
    // PRIVATE
    //

    // Create table widget view model
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: {
            columns: [{
                attr: "value"
            }, {
                attr: "label"
            }]
        },
        models: options.models,
        feather: "DataListOption",
        height: "250px"
    }));
    vm.tableWidget().toggleEdit();
    vm.tableWidget().isQuery(false);

    // Create button view models
    vm.buttonAdd(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelNew,
        title: "Insert",
        hotkey: "I",
        icon: "add_circle",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelDelete,
        title: "Delete",
        hotkey: "D",
        icon: "delete",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));
    vm.buttonRemove().disable();

    vm.buttonUndo(f.createViewModel("Button", {
        onclick: vm.tableWidget().undo,
        title: "Undo",
        hotkey: "U",
        icon: "undo",
        style: {
            backgroundColor: "white"
        }
    }));
    vm.buttonUndo().hide();

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonRemove().disable();
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(function () {
        vm.buttonRemove().enable();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
        vm.buttonRemove().hide();
        vm.buttonUndo().show();
    });

    return vm;
};

table.component = {
    oninit: function (vnode) {
        this.viewModel = vnode.attrs.viewModel;
    },

    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m(btn, {
                viewModel: vm.buttonAdd()
            }),
            m(btn, {
                viewModel: vm.buttonRemove()
            }),
            m(btn, {
                viewModel: vm.buttonUndo()
            }),
            m(tw, {
                viewModel: vm.tableWidget()
            })
        ]);
    }
};

/**
    View model editor for objects with type `DataList`.
    @class DataList
    @constructor
    @namespace ViewModels
    @param {Object} options Options
    @param {Object} options.parentViewModel
    @param {String} options.parentProperty
    @param {String} [options.id]
    @param {Object} [options.style]
*/
dataList.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;
    let dlg;

    /**
        @method buttonEdit
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonEdit = f.prop();
    /**
        @method dataListDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.dataListDialog = f.prop();
    /**
        @method content
        @return {Object} View
    */
    vm.content = function () {
        let val = vm.prop() || [];

        return f.types.array.tableData({
            value: val,
            options: {}
        });
    };
    /**
        Open edit dialog.
        @method doEdit
    */
    vm.doEdit = function () {
        let models = vm.models();
        let dataListDialog = vm.dataListDialog();
        let value = vm.prop() || [];
        let dataListOption = f.catalog().store().models().dataListOption;

        function applyEdit() {
            models = models.slice();
            models = models.filter((i) => i.state().current()[0] !== "/Delete");

            vm.prop(models.map(function (i) {
                return {
                    value: i.data.value(),
                    label: i.data.label()
                };
            }));
        }

        models.reset();
        value.forEach(function (i) {
            let instance = dataListOption(i);

            instance.state().goto("/Ready/Fetched/Clean");
            models.add(instance);
        });
        models.state().goto("/Fetched/Clean");
        dataListDialog.onOk(applyEdit);
        dataListDialog.okDisabled(true);
        dataListDialog.show();
    };
    /**
        @method key
        @param {String} key
        @return {String}
    */
    vm.key = f.prop(options.key || f.createId());
    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id || f.createId());
    /**
        Array of key/value pair models.
        @method models
        @return {Array}
    */
    vm.models = f.prop(f.createList("DataListOption", {fetch: false}));
    /**
        Parent model property.
        @method prop
        @param {String} property
        @return {String}
    */
    vm.prop = parent.model().data[options.parentProperty];
    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop(options.style || {});
    /**
        Table editor view model for dialog;
        @method table
        @param {Object} viewModel
        @return {Object}
    */
    vm.table = f.prop();

    // ..........................................................
    // PRIVATE
    //

    vm.dataListDialog(f.createViewModel("Dialog", {
        icon: "edit",
        title: "Data list"
    }));

    dlg = vm.dataListDialog();
    dlg.content = function () {
        return m(table.component, {
            viewModel: vm.table()
        });
    };
    dlg.style().width = "480px";
    dlg.style().height = "450px";

    vm.models().canAdd = f.prop(true);
    vm.models().state().resolve("/Fetched/Dirty").enter(
        () => dlg.okDisabled(false)
    );

    vm.table(table.viewModel({
        models: vm.models(),
        containterId: vm.dataListDialog().ids().dialog
    }));

    vm.buttonEdit(f.createViewModel("Button", {
        onclick: vm.doEdit,
        title: "Edit relation details",
        icon: "edit",
        class: "fb-data-type-edit-button"
    }));

    return vm;
};

/**
    Editor component for objects with format `DataList`.
    @class DataList
    @static
    @namespace Components
*/
dataList.component = {
    /**
        @method onint
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {Object} vnode.attrs.parentViewModel
        @param {String} vnode.attrs.parentProperty
        @param {String} [vnode.attrs.id]
        @param {Object} [vnode.attrs.style]
        @param {Boolean} [vnode.attrs.readonly]
    */
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = dataList.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            key: options.key,
            style: options.style
        });
    },

    /**
        @method view
        @param {Object} vnode Virtual node
    */
    view: function (vnode) {
        let vm = this.viewModel;
        let theStyle = vm.style();
        let readonly = vnode.attrs.readonly === true;
        let theId = vm.id();
        let btn = f.getComponent("Button");
        let dlg = f.getComponent("Dialog");

        if (readonly) {
            vm.buttonEdit().disable();
        } else {
            vm.buttonEdit().enable();
        }

        theStyle.display = theStyle.display || "inline-block";

        // Build the view
        return m("div", {
            style: theStyle,
            key: vm.key()
        }, [
            m(dlg, {
                viewModel: vm.dataListDialog()
            }),
            m("input", {
                id: theId,
                class: "fb-data-list-input",
                onchange: vm.onchange,
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                value: vm.content(),
                readonly: true,
                title: vm.content()
            }),
            m(btn, {
                viewModel: vm.buttonEdit()
            })
        ]);
    }
};

f.catalog().register("components", "dataList", dataList.component);

