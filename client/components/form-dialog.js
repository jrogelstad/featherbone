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
/*jslint browser, unordered*/
/*global f, m*/
/**
    @module FormDialog
*/

const formDialog = {};

/**
    @class FormDialog
    @constructor
    @extends ViewModels.Dialog
    @namespace ViewModels
*/
formDialog.viewModel = function (options) {
    let vm;
    let substate;
    let onOk = options.onOk;

    // ..........................................................
    // PUBLIC
    //

    options.title = options.title || options.model.toName();
    options.icon = options.icon || "article";
    options.onOk = function () {
        let model = vm.formWidget().model();
        model.save().then(function () {
            if (onOk) {
                onOk(model);
            }
        });
    };

    vm = f.createViewModel("Dialog", options);
    /**
        @method formWidget
        @param {ViewModels.FormWidget} [widget]
        @return {ViewModels.FormWidget}
    */
    vm.formWidget = f.prop();
    /**
        @method modelId
        @param {String} [id]
        @return {String}
    */
    vm.modelId = f.prop(options.id);
    vm.okDisabled = function () {
        let w = vm.formWidget();
        return (
            w
            ? !w.model().canSave()
            : true
        );
    };
    vm.okTitle = function () {
        let w = vm.formWidget();
        let def = "Record is unchanged";
        return (
            w
            ? w.model().lastError() || def
            : ""
        );
    };
    vm.content = function () {
        let state = vm.state();
        return state.resolve(state.current()[0]).content();
    };

    // ..........................................................
    // PRIVATE
    //

    // Only create the form instance when showing. Otherwise leads to
    // creating forms
    // for entire relation tree which is too heavy and could lead to
    // infinite loops
    substate = vm.state().resolve("/Display/Closed");
    substate.content = function () {
        return m("div");
    };
    substate = vm.state().resolve("/Display/Showing");
    substate.enter(function () {
        let ht = vm.style().height;
        if (ht) {
            ht = ht.slice(0, ht.length - 2);
            ht = ht - 160;
            ht = ht + "px";
        }

        // Create dalog view models
        vm.formWidget(f.createViewModel("FormWidget", {
            model: options.model,
            config: options.config,
            id: vm.modelId(),
            outsideElementIds: [
                vm.ids().header,
                vm.ids().buttonOk
            ],
            containerId: vm.ids().dialog,
            isScrollable: false,
            height: ht
        }));
        delete vm.style().display;
    });
    substate.content = function () {
        return m(f.getComponent("FormWidget"), {
            viewModel: vm.formWidget()
        });
    };
    substate.exit(function () {
        vm.formWidget(undefined);
        vm.style().display = "none";
    });

    vm.style().top = "50px";

    return vm;
};

f.catalog().register("viewModels", "formDialog", formDialog.viewModel);

/**
    Form dialog component

    @class FormDialog
    @static
    @uses Components.Dialog
    @namespace Components
*/
formDialog.component = f.getComponent("Dialog");

f.catalog().register("components", "formDialog", formDialog.component);
