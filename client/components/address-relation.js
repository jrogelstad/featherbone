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
    @module AddressRelation
*/

const addressRelation = {};
/**
    Generate view model for address relation.

    @class AddressRelation
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {Object} options.parentViewModel
    @param {String} options.parentProprety
    @param {String} [options.id]
    @param {Boolean} [options.isCell]
    @param {String} [options.readonly]
    @param {Object} [options.style]
*/
addressRelation.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;
    /**
        Address dialog view model.
        @method addressDialog
        @param {ViewModels.FormDialog} formDialog
        @return {ViewModels.FormDialog}
    */
    vm.addressDialog = f.prop();
    /**
        Clear button view model.
        @method buttonClear
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonClear = f.prop();
    /**
        Edit dialog content.
        @method content
        @param {Boolean} isCell
        @return {Object} View
    */
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

        if (d.name && d.name()) {
            content = d.name() + cr + content;
        }
        if (d.unit && d.unit()) {
            content += cr + d.unit();
        }

        if (d.city) {
            content += cr + d.city() + ", ";
        }
        if (d.state) {
            content += d.state() + " " + d.postalCode();
        }
        if (d.country) {
            content += cr + d.country();
        }
        if (d.phone && d.phone()) {
            content += cr + "Ph: " + d.phone();
        }

        return content;
    };
    /**
        @method countries
        @return {Array} Array of geographical country names
    */
    vm.countries = function () {
        let countries = f.catalog().store().data().countries().map(
            function (model) {
                return model.data.name();
            }
        ).sort();

        countries.unshift("");

        return countries;
    };
    /**
        @method doClear
    */
    vm.doClear = function () {
        vm.addressDialog().cancel();
        vm.model(null);
    };
    /**
        Show edit dialog.
        @method doEdit
    */
    vm.doEdit = function () {
        let value;
        let dmodel;
        let addressDialog = vm.addressDialog();

        addressDialog.show();
        dmodel = vm.addressDialog().formWidget().model();
        // No locking
        dmodel.isChild = true;
        dmodel.state().resolve(
            "/Ready/Fetched/Clean"
        ).event("changed", function () {
            dmodel.state().goto("/Ready/Fetched/Dirty");
        });
        if (vm.model()) {
            value = vm.model().toJSON();
            dmodel.set(value, true, true);
            dmodel.state().goto("/Ready/Fetched/Clean");
        }
    };
    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id || f.createId());
    /**
        @method isCell
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isCell = f.prop(options.isCell);
    /**
        @method model
        @return {Model} Parent model
    */
    vm.model = parent.model().data[options.parentProperty];
    /**
        @method onkeydown
        @param {Event} event
    */
    vm.onkeydown = function (e) {
        if (e.key === "Enter") { // Enter key
            vm.doEdit();
        } else if (e.key !== "Tab") {
            e.preventDefault();
        }
    };
    /**
        @method states
        @return {Array} Array of geographical state names
    */
    vm.states = function () {
        let states = f.catalog().store().data().states().map(function (model) {
            return model.data.code();
        }).sort();

        states.unshift("");
        return states;
    };
    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop(options.style || {});

    // ..........................................................
    // PRIVATE
    //

    vm.addressDialog(f.createViewModel("FormDialog", {
        title: "Address",
        model: "address",
        config: {
            attrs: [{
                attr: "type"
            }, {
                attr: "name"
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
            }, {
                attr: "phone"
            }]
        }
    }));
    vm.addressDialog().onOk(function () {
        vm.model(vm.addressDialog().formWidget().model().toJSON());
    });

    vm.buttonClear(f.createViewModel("Button", {
        onclick: vm.doClear,
        label: "C&lear"
    }));

    vm.addressDialog().buttons().push(vm.buttonClear);

    return vm;
};

/**
    Address relation component

    @class AddressRelation
    @static
    @namespace Components
*/
addressRelation.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} vnode.attrs.parentViewModel
        @param {String} vnode.attrs.parentProprety
        @param {String} [vnode.attrs.id]
        @param {Boolean} [vnode.attrs.isCell]
        @param {String} [vnode.attrs.readonly]
        @param {Object} [vnode.attrs.style] Style
    */
    oninit: function (vnode) {
        let options = vnode.attrs;
        let parentProperty = options.parentProperty;
        let relations = options.parentViewModel.relations();

        // Set up viewModel if required
        if (!relations[parentProperty]) {
            relations[parentProperty] = addressRelation.viewModel({
                parentViewModel: options.parentViewModel,
                parentProperty: options.parentProperty,
                id: options.id,
                isCell: options.isCell,
                style: options.style,
                readonly: options.readonly
            });
        }

        this.viewModel = relations[parentProperty];
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
        let readOnly = vnode.attrs.isReadOnly() === true;
        let options = {
            id: vm.id(),
            class: "fb-input",
            value: vm.content(vm.isCell()),
            readonly: readOnly,
            rows: 7
        };
        let dlg;

        options.style = {
            width: "100%"
        };

        if (vm.isCell()) {
            options.rows = 1;
        }

        if (!readOnly) {
            options.title = "Click or Enter key to edit";
            options.onkeydown = vm.onkeydown;
            options.onclick = vm.doEdit;
            dlg = m(f.getComponent("FormDialog"), {
                viewModel: vm.addressDialog()
            });
        }

        theStyle.display = theStyle.display || "inline-block";
        theStyle.width = "60%";

        // Build the view
        ret = m("div", {
            style: theStyle
        }, [
            dlg,
            m("textarea", options)
        ]);

        return ret;
    }
};

f.catalog().register(
    "components",
    "addressRelation",
    addressRelation.component
);


