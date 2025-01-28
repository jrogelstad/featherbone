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
    @module ChildTable
*/

const childTable = {};

/**
    View model for child table used inside forms to present editable lists.

    @class ChildTable
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Object} options.parentViewModel Parent view model
    @param {String} options.parentProperty Parent property key
    @param {Array} options.models List of child models
    @param {String} options.feather Feather
    @param {Array} options.config Column configuration
    @param {String} [options.height] Table height setting (optional)
*/
childTable.viewModel = function (options) {
    let tableState;
    let canAdd;
    let root = f.findRoot(options.parentViewModel.model());
    let vm = {};
    let instances = f.catalog().register("instances");

    function toggleCanAdd() {
        let currentState = root.state().current()[0];

        if (
            canAdd() !== false &&
            currentState !== "/Ready/Fetched/ReadOnly" &&
            currentState !== "/Locked"
        ) {
            vm.buttonAdd().enable();
            vm.buttonOpen().enable();
        } else {
            vm.buttonAdd().disable();
            vm.buttonOpen().disable();
        }
    }
    /**
        Actions instantiated as buttons
        @method actionButtons
        @param {Form.FormAction} action
        @return {Array}
    */
    vm.actionButtons = f.prop([]);
    /**
        Add button view model.
        @method buttonAdd
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonAdd = f.prop();

    /**
        Open button view model.
        @method buttonOpen
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonOpen = f.prop();

    /**
        Remove button view model.
        @method buttonDone
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonRemove = f.prop();

    /**
        Undo button view model.
        @method buttonUndo
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonUndo = f.prop();

    /**
        Remove button view model.
        @method buttonUp
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonUp = f.prop();

    /**
        Down button view model.
        @method buttonDown
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonDown = f.prop();

    /**
        @method childForm
        @param {ViewModels.ChildFormPage} page
        @return {ViewModels.ChildFormPage}
    */
    vm.childForm = f.prop();

    /**
        Open the child form page.
        @method doChildOpen
    */
    vm.doChildOpen = function () {
        let selection = vm.tableWidget().selection();
        let models = vm.tableWidget().models();
        let feather;

        if (!selection) {
            feather = options.feather.name;
            selection = f.createModel(feather);
            models.add(selection);
        }

        instances[selection.id()] = selection;

        if (selection) {
            m.route.set("/traverse/:feather/:key", {
                feather: options.feather.name.toSpinalCase(),
                key: selection.id()
            }, {
                state: {
                    parentProperty: options.parentProperty,
                    form: options.config.form
                }
            });
        }
    };

    /**
        @method moveDown
    */
    vm.moveDown = function () {
        let tw = vm.tableWidget();
        let sel = tw.selection();
        let models = tw.models();
        let idx = models.indexOf(sel) + 1;

        tw.models().moveDown(sel);
        tw.select(models[idx]);
    };
    /**
        @method moveUp
    */
    vm.moveUp = function () {
        let tw = vm.tableWidget();
        let sel = tw.selection();
        let models = tw.models();
        let idx = models.indexOf(sel) - 1;

        tw.models().moveUp(sel);
        tw.select(models[idx]);
    };

    /**
        Table widget view model.
        @method tableWidget
        @param {ViewModels.TableWidget} widget
        @return {ViewModels.TableWidget}
    */
    vm.tableWidget = f.prop();

    /**
        Parent view model.
        @method parentViewModel
        @param {Object} viewModel
        @return {Object} View model
    */
    vm.parentViewModel = f.prop(options.parentViewModel);

    /**
        @method refresh
    */
    vm.refresh = function () {
        vm.tableWidget().refresh();
    };

    // ..........................................................
    // PRIVATE
    //
    // Add action buttons defined in form
    let config = f.copy(options.config);
    config.actions = config.actions || [];
    let modelName = options.feather.name.toCamelCase();
    let actidx = config.actions.length - 1;
    let action;
    let fn;
    let theClass = "fb-toolbar-button fb-toolbar-button-right ";
    let btn;
    let validator = function (check) {
        return !Boolean(check(vm.tableWidget().selections(), vm));
    };
    let onClick = (act) => act(vm);

    while (actidx >= 0) {
        action = config.actions[actidx];
        fn = f.catalog().store().models()[modelName];

        btn = f.createViewModel("Button", {
            onclick: onClick.bind(null, fn.static()[action.method]),
            label: action.name,
            title: action.title,
            icon: action.icon,
            class: theClass
        });
        if (Boolean(action.validator)) {
            btn.isDisabled = validator.bind(
                null,
                fn.static()[action.validator]
            );
        }
        vm.actionButtons().push(btn);
        actidx -= 1;
    }

    // Create table widget view model
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: options.config,
        models: options.models,
        feather: options.feather,
        containerId: vm.parentViewModel().containerId(),
        height: options.height
    }));
    vm.tableWidget().toggleEdit();
    vm.tableWidget().isQuery(false);

    // Create button view models
    vm.buttonAdd(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelNew,
        title: "Insert",
        hotkey: "I",
        label: "Add",
        icon: "add_circle_outline",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelDelete,
        title: "Delete",
        hotkey: "D",
        label: "Remove",
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
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));
    vm.buttonUndo().hide();

    vm.buttonOpen(f.createViewModel("Button", {
        onclick: vm.doChildOpen,
        title: "Open",
        hotkey: "O",
        icon: "file_open",
        outline: false,
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.buttonUp(f.createViewModel("Button", {
        onclick: vm.moveUp,
        icon: "keyboard_arrow_up",
        title: "Move up",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white",
            float: "right"
        }
    }));

    vm.buttonDown(f.createViewModel("Button", {
        onclick: vm.moveDown,
        icon: "keyboard_arrow_down",
        title: "Move down",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white",
            float: "right"
        }
    }));

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonRemove().disable();
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(function () {
        let current = root.state().current()[0];
        if (
            current !== "/Ready/Fetched/ReadOnly" &&
            current !== "/Locked" &&
            vm.tableWidget().selection().canDelete()
        ) {
            vm.buttonRemove().enable();
        }

        vm.buttonOpen().icon("file_open");
        vm.buttonOpen().enable();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
        vm.buttonRemove().hide();
        vm.buttonUndo().show();
    });
    root.state().resolve("/Ready/Fetched/Clean").enter(function () {
        let selection = vm.tableWidget().selection();

        function found(model) {
            return selection.id() === model.id();
        }

        // Unselect potentially deleted model
        if (selection && !vm.tableWidget().models().some(found)) {
            vm.tableWidget().select(undefined);
        }
    });
    canAdd = vm.tableWidget().models().canAdd;

    root.state().resolve("/Ready/Fetched/ReadOnly").enter(() => canAdd(false));
    root.state().resolve("/Locked").enter(() => canAdd(false));
    root.state().resolve("/Ready/Fetched/ReadOnly").exit(() => canAdd(true));
    root.state().resolve("/Locked").exit(() => canAdd(true));
    root.state().resolve("/Ready/Fetched/Clean").enter(vm.tableWidget().select);
    canAdd.state().resolve("/Changing").exit(toggleCanAdd);
    toggleCanAdd();

    // No child form button if inside a dialog container
    if (vm.parentViewModel().containerId()) {
        vm.buttonOpen().style().display = "none";
    }

    return vm;
};

f.catalog().register("viewModels", "childTable", childTable.viewModel);

/**
  Child table component

  @class ChildTable
  @static
  @namespace Components
*/
childTable.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} vnode.attrs.parentViewModel
        @param {String} vnode.attrs.parentProprety
        @param {String} [vnode.attrs.height] Height
    */
    oninit: function (vnode) {
        let theConfig;
        let overload;
        let keys;
        let theParentProperty = vnode.attrs.parentProperty;
        let theParentViewModel = vnode.attrs.parentViewModel;
        let prop = theParentViewModel.model().data[theParentProperty];
        let theModels = prop();
        let theFeather = f.catalog().getFeather(prop.type.relation);
        let parentFeather = f.catalog().getFeather(
            theParentViewModel.model().name
        );
        let overloads = parentFeather.overloads || {};
        let relations = vnode.attrs.parentViewModel.relations();

        theConfig = theParentViewModel.config().attrs.find(function (item) {
            return item.attr === theParentProperty;
        });

        // Apply parent defined overloads to child feather
        overload = overloads[theParentProperty];
        if (overload) {
            theFeather.overloads = theFeather.overloads || {};
            keys = Object.keys(overload);
            keys.forEach(function (key) {
                theFeather.overloads[key] = overload[key];
            });
        }

        // Set up viewModel if required
        if (!relations[theParentProperty]) {
            relations[theParentProperty] = childTable.viewModel({
                parentViewModel: theParentViewModel,
                parentProperty: theParentProperty,
                models: theModels,
                feather: theFeather,
                config: theConfig,
                height: vnode.attrs.height
            });
        }
        this.viewModel = relations[theParentProperty];
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let sel = vm.tableWidget().selection();
        let ary = vm.tableWidget().models();
        let index = ary.indexOf(sel);
        let buttonUp = vm.buttonUp();
        let buttonDown = vm.buttonDown();
        let controls;

        buttonUp.disable();
        buttonDown.disable();

        if (ary.canMove && ary.canMove() && sel) {
            if (ary.length > 1) {
                if (index < ary.length - 1) {
                    buttonDown.enable();
                }
                if (index > 0) {
                    buttonUp.enable();
                }
            }
        }

        controls = [
            m(btn, {viewModel: vm.buttonAdd()}),
            m(btn, {viewModel: vm.buttonRemove()}),
            m(btn, {viewModel: vm.buttonUndo()}),
            m(btn, {viewModel: vm.buttonOpen()}),
            m(btn, {viewModel: vm.buttonDown()}),
            m(btn, {viewModel: vm.buttonUp()})
        ];

        vm.actionButtons().forEach(function (ab) {
            return controls.push(m(btn, {viewModel: ab}));
        });

        controls.push(
            m(f.getComponent("TableWidget"), {
                viewModel: vm.tableWidget()
            })
        );

        return m("div", controls);
    }
};

f.catalog().register("components", "childTable", childTable.component);
