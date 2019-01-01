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
/*jslint browser*/
import {stream} from "../../common/stream-client.js";
import {dialog} from "./dialog.js";
import {formWidget} from "./form-widget.js";

const formDialog = {};
const m = window.m;

/**
  View model for form dialog.

  @param {Object} Options
*/
formDialog.viewModel = function (options) {
    let vm;
    let substate;
    let onOk = options.onOk;

    // ..........................................................
    // PUBLIC
    //

    options.title = options.title || options.model.toName();
    options.icon = options.icon || "file-text";
    options.onOk = function () {
        let model = vm.formWidget().model();
        model.save().then(function () {
            if (onOk) {
                onOk(model);
            }
        });
    };

    vm = dialog.viewModel(options);
    vm.formWidget = stream();
    vm.modelId = stream(options.id);
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
        // Create dalog view models
        vm.formWidget(formWidget.viewModel({
            model: options.model,
            config: options.config,
            id: vm.modelId(),
            outsideElementIds: [
                vm.ids().header,
                vm.ids().buttonOk
            ],
            containerId: vm.ids().dialog
        }));
        delete vm.style().display;
    });
    substate.content = function () {
        return m(formWidget.component, {
            viewModel: vm.formWidget()
        });
    };
    substate.exit(function () {
        vm.formWidget(undefined);
        vm.style().display = "none";
    });

    delete vm.style().width;
    vm.style().margin = "25px";
    vm.style().top = "0px";
    vm.style().display = "none";

    return vm;
};

/**
  Form dialog component

  @params {Object} View model
*/
formDialog.component = dialog.component;
export {formDialog};