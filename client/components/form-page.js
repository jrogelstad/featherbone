/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*global f, m*/
/**
    @module FormPage
*/

const authTable = {};
const formPage = {};
const instances = f.catalog().register("instances");
const formInstances = f.catalog().register("formInstances");

const authFeather = {
    name: "ObjectAuthorization",
    plural: "ObjectAuthorizations",
    isSystem: true,
    properties: {
        id: {
            description: "Internal id",
            type: "string",
            default: "createId()"
        },
        role: {
            description: "Role name",
            type: "string",
            format: "role",
            isRequired: true
        },
        editorCanRead: {
            description: "Editor for can read feather",
            type: "boolean"
        },
        editorCanUpdate: {
            description: "Editor for can update feather",
            type: "boolean"
        },
        editorCanDelete: {
            description: "Editor for can delete feather",
            type: "boolean"
        },
        canRead: {
            description: "Role can read object",
            type: "string"
        },
        canUpdate: {
            description: "Role can update object",
            type: "string"
        },
        canDelete: {
            description: "Role can update object",
            type: "string"
        },
        hasFeatherAuth: {
            description: "Has feather authorization",
            type: "boolean"
        },
        featherCanRead: {
            description: "Role can read feather",
            type: "boolean"
        },
        featherCanUpdate: {
            description: "Role can update feather",
            type: "boolean"
        },
        featherCanDelete: {
            description: "Role can update feather",
            type: "boolean"
        },
        isDeleted: {
            type: "boolean"
        }
    }
};

function resolveAction(value) {
    if (value === "true") {
        value = true;
    } else if (value === "false") {
        value = false;
    } else if (value === "") {
        value = null;
    }

    return value;
}

/**
    Model for handling object authorization
    @class ObjectAuthorization
    @namespace Models
    @static
    @extends Model
*/
/**
    Internal id.

    __Type:__ `String`

    @property data.id
    @type Property
*/
/**
    Role name.

    __Type:__ `String`

    @property data.role
    @type Property
*/
/**
    Editor for can read feather.

    __Type:__ `Boolean`

    @property data.editorCanRead
    @type Property
*/
/**
    Editor for can update feather.

    __Type:__ `Boolean`

    @property data.editorCanUpdate
    @type Property
*/
/**
    Editor for can delete feather.

    __Type:__ `Boolean`

    @property data.editorCanDelete
    @type Property
*/
/**
    Role can read object.

    __Type:__ `String`

    @property data.canRead
    @type Property
*/
/**
    Role can update object.

    __Type:__ `String`

    @property data.canUpdate
    @type Property
*/
/**
    Role can delete object.

    __Type:__ `String`

    @property data.canDelete
    @type Property
*/
/**
    Has feather authorization.

    __Type:__ `Boolean`

    @property data.hasFeatherAuth
    @type Property
*/
/**
    Role can read feather.

    __Type:__ `Boolean`

    @property data.featherCanRead
    @type Property
*/
/**
    Role can update feather.

    __Type:__ `Boolean`

    @property data.featherCanUpdate
    @type Property
*/
/**
    Role can read feather.

    __Type:__ `Boolean`

    @property data.featherCanDelete
    @type Property
*/
function authModel(data) {
    let that = f.createModel(data, authFeather);
    let d = that.data;
    let state;

    // Three way switch
    function editing(action, prop) {
        let oaction = "can" + action;
        let faction = "featherCan" + action;
        let value;

        if (d.hasFeatherAuth()) {
            if (d[oaction]() === null) {
                value = !d[faction]();
                d[oaction](value.toString());
                return;
            }

            if (resolveAction(d[oaction]()) === d[faction]()) {
                d[oaction](null);
                prop.newValue(prop.oldValue());
                return;
            }
        }

        value = !resolveAction(d[oaction]());
        d[oaction](value.toString());
    }

    function actionChanged(action) {
        let oaction = "can" + action;
        let eaction = "editorCan" + action;

        d[eaction].style(
            (d[oaction]() === null && d.hasFeatherAuth())
            ? "DEFAULT"
            : ""
        );
    }

    function handleEditor() {
        function getValue(action) {
            if (resolveAction(d["can" + action]()) !== null) {
                return resolveAction(d["can" + action]());
            }
            if (d.hasFeatherAuth()) {
                return d["featherCan" + action]();
            }
            return null;
        }

        // Silently set editor default values
        that.set({
            editorCanRead: getValue("Read"),
            editorCanUpdate: getValue("Update"),
            editorCanDelete: getValue("Delete")
        }, true);
    }

    function doSave(context) {
        let isDeleting = context.isDeleting;
        let payload = {
            method: "POST",
            path: "/do/save-authorization",
            data: {
                id: that.objectId(),
                role: d.role(),
                actions: {
                    canCreate: null,
                    canRead: resolveAction(d.canRead()),
                    canUpdate: resolveAction(d.canUpdate()),
                    canDelete: resolveAction(d.canDelete())
                }
            }
        };

        if (isDeleting) {
            payload.data.actions.canRead = null;
            payload.data.actions.canUpdate = null;
            payload.data.actions.canDelete = null;
        }

        function callback(resp) {
            if (resp && !isDeleting) {
                state.goto("/Ready/Fetched/Clean");
            } else {
                state.goto("/Deleted");
            }
            context.resolve();
        }

        f.datasource().request(payload).then(callback);
    }

    that.objectId = f.prop();

    // Redirect save event toward custom save function
    state = that.state();
    state.resolve("/Busy/Saving/Posting").enters.pop();
    state.resolve("/Busy/Saving/Posting").enter(doSave);
    state.resolve("/Ready/Fetched/Dirty").event("save", function (pContext) {
        that.state().goto("/Busy/Saving/Posting", {
            context: pContext
        });
    });
    state.resolve("/Ready/Fetched/Clean").event("changed", function () {
        this.goto("../Dirty");
    });
    state.resolve("/Delete").enters.shift();
    state.resolve("/Delete").event("save", function (pContext) {
        pContext.isDeleting = true;
        that.state().goto("/Busy/Saving/Posting", {
            context: pContext
        });
    });

    that.onLoad(function () {
        handleEditor();
        actionChanged("Read");
        actionChanged("Update");
        actionChanged("Delete");
    });
    that.onChange("editorCanRead", editing.bind(null, "Read"));
    that.onChange("editorCanUpdate", editing.bind(null, "Update"));
    that.onChange("editorCanDelete", editing.bind(null, "Delete"));
    that.onChanged("canRead", actionChanged.bind(null, "Read"));
    that.onChanged("canUpdate", actionChanged.bind(null, "Update"));
    that.onChanged("canDelete", actionChanged.bind(null, "Delete"));
    that.onChanged("featherCanRead", actionChanged.bind(null, "Read"));
    that.onChanged("featherCanUpdate", actionChanged.bind(null, "Update"));
    that.onChanged("featherCanDelete", actionChanged.bind(null, "Delete"));

    return that;
}

f.catalog().register("feathers", "ObjectAuthorization", authFeather);
f.catalog().registerModel("objectAuthorization", authModel);

authTable.viewModel = function (options) {
    let tableState;
    let vm = {};

    vm.buttonAdd = f.prop();
    vm.buttonRemove = f.prop();
    vm.buttonUndo = f.prop();
    vm.tableWidget = f.prop();

    // Create table widget view model
    vm.tableWidget(f.createViewModel("TableWidget", {
        models: options.models,
        config: {
            columns: [{
                attr: "role"
            }, {
                label: "Read",
                attr: "editorCanRead",
                width: 60
            }, {
                label: "Update",
                attr: "editorCanUpdate",
                width: 60
            }, {
                label: "Delete",
                attr: "editorCanDelete",
                width: 60
            }]
        },
        feather: "ObjectAuthorization",
        height: "200px"
    }));
    vm.tableWidget().toggleEdit();
    vm.tableWidget().isQuery(false);

    // Create button view models
    vm.buttonAdd(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelNew,
        title: "Insert",
        hotkey: "I",
        icon: "plus-circle",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelDelete,
        title: "Delete",
        hotkey: "D",
        icon: "trash",
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

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonRemove().disable();
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(vm.buttonRemove().enable);
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

authTable.component = {
    oninit: function (vnode) {
        this.viewModel = vnode.attrs.viewModel;
    },

    view: function () {
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m(btn, {
                viewModel: this.viewModel.buttonAdd()
            }),
            m(btn, {
                viewModel: this.viewModel.buttonRemove()
            }),
            m(btn, {
                viewModel: this.viewModel.buttonUndo()
            }),
            m(tw, {
                viewModel: this.viewModel.tableWidget()
            })
        ]);
    }
};

/**
    @class FormPage
    @namespace ViewModels
    @constructor
    @param {Object} options
    @param {String} options.feather Feather name
    @param {String} [options.form] Form id
    @param {Object} [options.config] Layout configuration
    @param {String} [options.receiever] Receiver id to send back changes
    @param {Boolean} [options.isNew]
    @param {Boolean} [options.create]
    @param {Integer} [options.index]
    @param {String} [options.key]
    @param {Boolean} [options.isNewWindow]
*/
formPage.viewModel = function (options) {
    // Handle options where opened as a new window
    if (window.options) {
        Object.keys(window.options).forEach(function (key) {
            options[key] = window.options[key];
        });
    }

    let isDisabled;
    let applyTitle;
    let saveTitle;
    let fmodel;
    let sseState = f.catalog().store().global().sseState;
    let theFeather = options.feather.toCamelCase(true);
    let form = f.getForm({
        form: options.form,
        feather: theFeather
    });
    let vm = {};
    let pageIdx = options.index || 1;
    let isNew = options.create && options.isNew !== false;
    let authorizations = f.createList("ObjectAuthorization", {fetch: false});
    authorizations.checkUpdate = false;
    let authViewModel = authTable.viewModel({models: authorizations});
    let toolbarButtonClass = "fb-toolbar-button";

    switch (f.currentUser().mode) {
    case "test":
        toolbarButtonClass += " fb-toolbar-button-test";
        break;
    case "dev":
        toolbarButtonClass += " fb-toolbar-button-dev";
        break;
    }

    // Helper function to pass back data to sending model
    function callReceiver() {
        let receivers;
        if (options.receiver) {
            receivers = f.catalog().register("receivers");
            if (receivers[options.receiver]) {
                receivers[options.receiver].callback(vm.model());
            }
        }

        if (window.receiver) {
            window.receiver(vm.model());
        }
    }

    // Process feather auths after object authorization fetch
    function postProcess() {
        // Add in feather auths
        let auths = f.catalog().getFeather(theFeather).authorizations;

        auths.forEach(function (auth) {
            let actions = auth.actions;
            let found = authorizations.find(function (a) {
                return a.data.role() === auth.role;
            });

            if (found) {
                found.set({
                    hasFeatherAuth: true,
                    featherCanRead: actions.canRead,
                    featherCanUpdate: actions.canUpdate,
                    featherCanDelete: actions.canDelete
                });
            } else {
                found = authModel({
                    role: auth.role,
                    canRead: null,
                    canUpdate: null,
                    canDelete: null,
                    editorCanRead: actions.canRead,
                    editorCanUpdate: actions.canUpdate,
                    editorCanDelete: actions.canDelete,
                    hasFeatherAuth: true,
                    featherCanRead: actions.canRead,
                    featherCanUpdate: actions.canUpdate,
                    featherCanDelete: actions.canDelete
                });
                authorizations.add(found);
            }
            found.state().goto("/Ready/Fetched/Clean");
        });

        // Sort
        authorizations.sort(function (a, b) {
            if (a.data.role() < b.data.role()) {
                return -1;
            }
            return 1;
        });
    }

    function doPrintPdf() {
        let dlg = vm.confirmDialog();
        let p = f.catalog().getFeather(
            theFeather
        ).properties;
        let now = new Date();
        let nkey = Object.keys(p).find(function (k) {
            return p[k].isNaturalKey;
        }) || "id";
        let file = (
            vm.model().data[nkey]() + " " +
            now.toLocalDate() + " " +
            now.getHours() +
            now.getMinutes()
        );

        console.log(file);
        function error(err) {
            dlg.message(err.message);
            dlg.title("Error");
            dlg.icon("window-close");
            dlg.buttonCancel().hide();
            dlg.show();
        }

        function openPdf(resp) {
            let url = (
                window.location.protocol + "//" +
                window.location.hostname + ":" +
                window.location.port + "/pdf/" + resp
            );

            window.open(url);
        }
	
        let payload;
        let theBody = {
            id: vm.model().id(),
            form: form.name,
            filename: file
        };

        payload = {
            method: "POST",
            url: "/do/print-pdf/form/",
            body: theBody
        };

        return m.request(payload).then(openPdf).catch(error);
    }

    // Check if we've already got a model instantiated
    if (options.key && instances[options.key]) {
        fmodel = instances[options.key];
    } else {
        fmodel = options.feather.toCamelCase();
    }

    // ..........................................................
    // PUBLIC
    //

    /**
        @method buttonApply
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonApply = f.prop();
    /**
        @method buttonAuth
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonAuth = f.prop();
    /**
        @method buttonPdf
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonPdf = f.prop();
    /**
        @method buttonBack
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonBack = f.prop();
    /**
        @method buttonSave
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSave = f.prop();
    /**
        @method buttonSaveAndNew
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSaveAndNew = f.prop();
    /**
        @method confirmDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.confirmDialog = f.prop(f.createViewModel("Dialog", {
        icon: "question-circle",
        title: "Confirm close",
        message: ("You will lose changes you have made. Are you sure?"),
        onOk: function () {
            vm.model().state().send("undo");
            vm.doBack(true);
        }
    }));
    /**
        @method doApply
    */
    vm.doApply = function () {
        vm.model().save().then(function () {
            callReceiver(false);
        });
    };
    /**
        @method doBack
    */
    vm.doBack = function (force) {
        let instance = vm.model();
        let current = instance.state().current()[0];

        if (
            (
                current === "/Ready/New" ||
                current === "/Ready/Fetched/Dirty"
            ) &&
            force !== true
        ) {
            vm.confirmDialog().show();
            return;
        }

        // Once we consciously leave, purge memoize
        delete instances[vm.model().id()];
        delete formInstances[vm.model().id()];

        if (options.isNewWindow) {
            sseState.send("close");
            window.close();
            return;
        }

        if (window.history.state === null) {
            m.route.set("/home");
            return;
        }

        window.history.go(pageIdx * -1);
    };
    /**
        @method doNew
    */
    vm.doNew = function () {
        let opts = {
            feather: options.feather,
            key: f.createId()
        };
        let state = {
            state: {
                form: options.form,
                index: pageIdx + 1,
                create: true,
                receiver: options.receiver
            }
        };
        m.route.set("/edit/:feather/:key", opts, state);
    };
    /**
        @method doSave
    */
    vm.doSave = function () {
        vm.model().save().then(function () {
            callReceiver();
            vm.doBack();
        });
    };
    /**
        @method doSaveAndNew
    */
    vm.doSaveAndNew = function () {
        vm.model().save().then(function () {
            callReceiver();
            delete instances[vm.model().id()];
            delete formInstances[vm.model().id()];
            vm.doNew();
        });
    };
    /**
        @method editAuthDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.editAuthDialog = f.prop(f.createViewModel("Dialog", {
        icon: "key",
        title: "Edit Authorizations",
        onOk: function () {
            let id = vm.model().id();

            authorizations.forEach((a) => a.objectId(id));
            authorizations.save();
        }
    }));
    vm.editAuthDialog().content = function () {
        return m(authTable.component, {viewModel: authViewModel});
    };
    vm.editAuthDialog().style().width = "575px";
    vm.editAuthDialog().state().resolve("/Display/Showing").enter(function () {
        authorizations.fetch({
            criteria: [{
                property: "id",
                value: vm.model().id()
            }]
        }, false).then(postProcess);
    });
    /**
        @method formWidget
        @param {ViewModels.FormWidget} widget
        @return {ViewModels.FormWidget}
    */
    vm.formWidget = f.prop();
    /**
        @method isNew
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isNew = f.prop(isNew);
    /**
        @method model
        @return {Model}
    */
    vm.model = function () {
        return vm.formWidget().model();
    };
    /**
        @method buttonEdit
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.sseErrorDialog = f.prop(f.createViewModel("Dialog", {
        icon: "window-close",
        title: "Connection Error",
        message: (
            "You have lost connection to the server." +
            "Click \"Ok\" to attempt to reconnect."
        ),
        onOk: function () {
            document.location.reload();
        }
    }));
    vm.sseErrorDialog().buttonCancel().hide();
    /**
        @method title
        @return {String}
    */
    vm.title = function () {
        return options.feather.toName();
    };
    /**
        @method toggleNew
    */
    vm.toggleNew = function () {
        vm.buttonSaveAndNew().title("");
        if (!vm.model().canSave()) {
            vm.buttonSaveAndNew().label("&New");
            vm.buttonSaveAndNew().onclick(vm.doNew);
        } else {
            vm.buttonSaveAndNew().label("Save and &New");
            vm.buttonSaveAndNew().onclick(vm.doSaveAndNew);
        }
    };

    // Create form widget
    vm.formWidget(f.createViewModel("FormWidget", {
        isNew: Boolean(isNew),
        model: fmodel,
        id: options.key,
        config: form,
        outsideElementIds: ["toolbar", "title"]
    }));

    // Once model instantiated let history know already created so we know
    // to fetch if navigating back here through history
    if (isNew) {
        options.isNew = false;
        m.route.set(m.route.get(), null, {
            replace: true,
            state: options
        });
    }

    // Memoize our model instance in case we leave and come back while
    // zooming deeper into detail
    instances[vm.model().id()] = vm.model();

    // Create button view models
    vm.buttonBack(f.createViewModel("Button", {
        onclick: vm.doBack,
        label: (
            window.history.state === null
            ? "&Done"
            : "&Back"
        ),
        icon: (
            window.history.state === null
            ? ""
            : "arrow-left"
        ),
        class: toolbarButtonClass
    }));

    vm.buttonApply(f.createViewModel("Button", {
        onclick: vm.doApply,
        label: "&Apply",
        class: toolbarButtonClass
    }));

    vm.buttonAuth(f.createViewModel("Button", {
        onclick: vm.editAuthDialog().show,
        icon: "key",
        title: "Edit Authorizations",
        class: toolbarButtonClass + " fb-toolbar-button-right"
    }));

    vm.buttonPdf(f.createViewModel("Button", {
        onclick: doPrintPdf,
        icon: "file-pdf",
        title: "Print to PDF",
        class: toolbarButtonClass + " fb-toolbar-button-right"
    }));

    vm.buttonSave(f.createViewModel("Button", {
        onclick: vm.doSave,
        label: "&Save",
        icon: "cloud-upload-alt",
        class: toolbarButtonClass
    }));

    vm.buttonSaveAndNew(f.createViewModel("Button", {
        onclick: vm.doSaveAndNew,
        label: "Save and &New",
        icon: "plus-circle",
        class: toolbarButtonClass
    }));
    if (f.catalog().getFeather(theFeather).isReadOnly) {
        vm.buttonSaveAndNew().label("&New");
        vm.buttonSaveAndNew().title("Data is read only");
        vm.buttonSaveAndNew().disable();
    }

    // Bind model state to display state
    isDisabled = function () {
        return !vm.model().canSave();
    };
    applyTitle = vm.buttonApply().title;
    saveTitle = vm.buttonSave().title;
    vm.buttonApply().isDisabled = isDisabled;
    vm.buttonApply().title = function () {
        if (isDisabled()) {
            return vm.model().lastError() || "No changes to apply";
        }
        return applyTitle();
    };
    vm.buttonSave().isDisabled = isDisabled;
    vm.buttonSave().title = function () {
        if (isDisabled()) {
            return vm.model().lastError() || "No changes to save";
        }
        return saveTitle();
    };

    sseState.resolve("Error").enter(function () {
        vm.sseErrorDialog().show();
    });

    return vm;
};

/**
    @class FormPage
    @static
    @namespace Components
*/
formPage.component = {
    /**
        Must pass view model instance, or options to build one.
        @method oninit
        @param {Object} vnode Virtual nodeName
        @param {Object} vnode.attrs Options
        @param {Object} [vnode.attrs.viewModel] View model
        @param {String} [vnode.attrs.feather] Feather name
        @param {String} [vnode.attrs.form] Form id
        @param {Object} [vnode.attrs.config] Layout configuration
        @param {String} [vnode.attrs.receiever] Receiver id to send back changes
        @param {Boolean} [vnode.attrs.isNew]
        @param {Boolean} [vnode.attrs.create]
        @param {Integer} [vnode.attrs.index]
        @param {String} [vnode.attrs.key]
        @param {Boolean} [vnode.attrs.isNewWindow]
    */
    oninit: function (vnode) {
        let frminstances = f.catalog().store().formInstances();
        let key = vnode.attrs.key;
        let existing = frminstances[key];

        if (!vnode.attrs.viewModel && existing) {
            vnode.attrs.viewModel = existing;
        }
        this.viewModel = (
            vnode.attrs.viewModel || formPage.viewModel(vnode.attrs)
        );
        frminstances[key] = this.viewModel;
    },
    /**
        Feather icon.
        @method onupdate
    */
    onupdate: function () {
        let key = (
            this.viewModel.isNew()
            ? "(New)"
            : this.viewModel.model().naturalKey()
        );
        let title = this.viewModel.title() + (
            key
            ? ": " + key
            : ""
        );
        document.getElementById("fb-title").text = title;
    },
    /**
        @method view
        @return {Object} view
    */
    view: function () {
        let lock;
        let theTitle;
        let vm = this.viewModel;
        let fmodel = vm.model();
        let icon = "file-alt";
        let btn = f.getComponent("Button");
        let dlg = f.getComponent("Dialog");
        let fw = f.getComponent("FormWidget");
        let toolbarClass = "fb-toolbar";

        switch (f.currentUser().mode) {
        case "test":
            toolbarClass += " fb-toolbar-test";
            break;
        case "dev":
            toolbarClass += " fb-toolbar-dev";
            break;
        }

        vm.toggleNew();
        vm.buttonAuth().disable();

        if (fmodel.canUpdate() === false) {
            icon = "lock";
            theTitle = "Unauthorized to edit";
        } else {
            switch (fmodel.state().current()[0]) {
            case "/Locked":
                icon = "user-lock";
                lock = fmodel.data.lock() || {};
                theTitle = (
                    "User: " + lock.username + "\nSince: " +
                    new Date(lock.created).toLocaleTimeString()
                );
                break;
            case "/Ready/Fetched/Dirty":
                icon = "pencil-alt";
                theTitle = "Editing record";
                break;
            case "/Ready/New":
                icon = "plus";
                theTitle = "New record";
                break;
            default:
                if (
                    fmodel.data.owner &&
                    fmodel.data.owner() === f.currentUser().name
                ) {
                    vm.buttonAuth().enable();
                }
            }
        }

        // Build view
        return m("div", [
            m("div", {
                id: "toolbar",
                class: toolbarClass
            }, [
                m(btn, {
                    viewModel: vm.buttonAuth()
                }),
                m(btn, {
                    viewModel: vm.buttonPdf()
                }),
                m(btn, {
                    viewModel: vm.buttonBack()
                }),
                m(btn, {
                    viewModel: vm.buttonApply()
                }),
                m(btn, {
                    viewModel: vm.buttonSave()
                }),
                m(btn, {
                    viewModel: vm.buttonSaveAndNew()
                })
            ]),
            m("div", {
                class: "fb-title",
                id: "title"
            }, [
                m("i", {
                    class: "fa fa-" + icon + " fb-title-icon",
                    title: theTitle
                }),
                m("label", vm.title())
            ]),
            m(dlg, {
                viewModel: vm.confirmDialog()
            }),
            m(dlg, {
                viewModel: vm.sseErrorDialog()
            }),
            m(dlg, {
                viewModel: vm.editAuthDialog()
            }),
            m(fw, {
                viewModel: vm.formWidget()
            })
        ]);
    }
};

f.catalog().register("components", "formPage", formPage.component);

