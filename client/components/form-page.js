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
import button from "./button.js";
import catalog from "../models/catalog.js";
import formWidget from "./form-widget.js";
import dialog from "./dialog.js";
import model from "../models/model.js";
import datasource from "../datasource.js";
import list from "../models/list.js";
import tableWidget from "./table-widget.js";

const authTable = {};
const formPage = {};
const m = window.m;

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
        objectId: {
            description: "Object id",
            type: "string"
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

// Model for handling object authorization
function authModel(data) {
    let that = model(data, authFeather);
    let d = that.data;

    function resolveAction(value) {
        if (value === "true") {
            value = true;
        } else if (value === "false") {
            value = false;
        }

        return value;
    }

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

            if (d[oaction]() === d[faction]()) {
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

    function save() {
        return new Promise(function (resolve, reject) {
            let payload = {
                method: "POST",
                path: "/do/save-authorization",
                data: {
                    id: d.objectId(),
                    actions: {
                        canCreate: null,
                        canRead: resolveAction(d.canRead()),
                        canUpdate: resolveAction(d.canUpdate()),
                        canDelete: resolveAction(d.canDelete())
                    }
                }
            };

            function callback(resp) {
                resolve(resp);
            }

            datasource.request(payload).then(callback).catch(reject);
        });
    }

    // Redirect save event toward custom save function
    that.state().resolve("/Busy/Saving/Posting").enters.pop();
    that.state().resolve("/Busy/Saving/Posting").enter(save);
    that.state().resolve("/Ready/Fetched/Dirty").event("save", function () {
        that.state().goto("/Busy/Saving/Posting");
    });

    that.onLoad(function () {
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

catalog.register("feathers", "ObjectAuthorization", authFeather);
catalog.registerModel("objectAuthorization", authModel);

authTable.viewModel = function (options) {
    let tableState;
    let vm = {};

    vm.buttonAdd = f.prop();
    vm.buttonRemove = f.prop();
    vm.buttonUndo = f.prop();
    vm.tableWidget = f.prop();

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
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
                attr: "editorCanUpdate",
                width: 60
            }]
        },
        feather: "ObjectAuthorization",
        height: "200px"
    }));
    vm.tableWidget().toggleEdit();
    vm.tableWidget().isQuery(false);

    // Create button view models
    vm.buttonAdd(button.viewModel({
        onclick: vm.tableWidget().modelNew,
        title: "Insert",
        hotkey: "I",
        icon: "plus-circle",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(button.viewModel({
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

    vm.buttonUndo(button.viewModel({
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
        return m("div", [
            m(button.component, {
                viewModel: this.viewModel.buttonAdd()
            }),
            m(button.component, {
                viewModel: this.viewModel.buttonRemove()
            }),
            m(button.component, {
                viewModel: this.viewModel.buttonUndo()
            }),
            m(tableWidget.component, {
                viewModel: this.viewModel.tableWidget()
            })
        ]);
    }
};

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
    let instances = catalog.register("instances");
    let sseState = catalog.store().global().sseState;
    let feather = options.feather.toCamelCase(true);
    let form = f.getForm({
        form: options.form,
        feather: feather
    });
    let vm = {};
    let pageIdx = options.index || 1;
    let isNew = options.create && options.isNew !== false;
    let authorizations = list("ObjectAuthorization")({fetch: false});
    let authViewModel = authTable.viewModel({models: authorizations()});

    // Helper function to pass back data to sending model
    function callReceiver() {
        let receivers;
        if (options.receiver) {
            receivers = catalog.register("receivers");
            if (receivers[options.receiver]) {
                receivers[options.receiver].callback(vm.model());
            }
        }

        if (window.receiver) {
            window.receiver(vm.model());
        }
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

    vm.buttonApply = f.prop();
    vm.buttonAuth = f.prop();
    vm.buttonBack = f.prop();
    vm.buttonSave = f.prop();
    vm.buttonSaveAndNew = f.prop();
    vm.doApply = function () {
        vm.model().save().then(function () {
            callReceiver(false);
        });
    };
    vm.doBack = function () {
        let instance = vm.model();

        if (instance.state().current()[0] === "/Ready/Fetched/Dirty") {
            instance.state().send("undo");
        }

        // Once we consciously leave, purge memoize
        delete instances[vm.model().id()];

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
    vm.doSave = function () {
        vm.model().save().then(function () {
            callReceiver();
            vm.doBack();
        });
    };
    vm.doSaveAndNew = function () {
        vm.model().save().then(function () {
            callReceiver();
            delete instances[vm.model().id()];
            vm.doNew();
        });
    };
    vm.editAuthDialog = f.prop(dialog.viewModel({
        icon: "key",
        title: "Edit Authorizations",
        onOk: authorizations.save
    }));
    vm.editAuthDialog().content = function () {
        return m(authTable.component, {viewModel: authViewModel});
    };
    vm.editAuthDialog().style().width = "575px";
    vm.editAuthDialog().state().resolve("/Display/Showing").enter(function () {
        authorizations().fetch({
            criteria: [{
                property: "id",
                value: vm.model().id()
            }]
        }).then(function () {
            // Add in feather auths
            let auths = catalog.getFeather(feather).authorization;

            auths.forEach(function (auth) {
                let actions = auth.actions;
                let found = authorizations().find(function (a) {
                    return a.data.role() === auth.role;
                });

                if (found) {
                    found.set({
                        role: auth.role,
                        editorCanRead: (
                            found.data.canRead() === null
                            ? actions.canRead
                            : !Boolean(found.data.canRead() === "true")
                        ),
                        editorCanUpdate: (
                            found.data.canUpdate() === null
                            ? actions.canUpdate.toString()
                            : !Boolean(found.data.canUpdate() === "true")
                        ),
                        editorCanDelete: (
                            found.data.canDelete() === null
                            ? actions.canDelete.toString()
                            : !Boolean(found.data.canDelete() === "true")
                        ),
                        hasFeatherAuth: true,
                        featherCanRead: actions.canRead,
                        featherCanUpdate: actions.canUpdate,
                        featherCanDelete: actions.canDelete
                    }, true, true);
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
                    found.state().goto("/Ready/Fetched/Clean");
                    authorizations().add(found);
                }
            });
        });
    });
    vm.formWidget = f.prop();
    vm.isNew = f.prop(isNew);
    vm.model = function () {
        return vm.formWidget().model();
    };
    vm.sseErrorDialog = f.prop(dialog.viewModel({
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
    vm.title = function () {
        return options.feather.toName();
    };
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
    vm.formWidget(formWidget.viewModel({
        isNew: isNew,
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
    vm.buttonBack(button.viewModel({
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
        class: "fb-toolbar-button"
    }));

    vm.buttonApply(button.viewModel({
        onclick: vm.doApply,
        label: "&Apply",
        class: "fb-toolbar-button"
    }));

    vm.buttonAuth(button.viewModel({
        onclick: vm.editAuthDialog().show,
        icon: "key",
        title: "Edit Authorizations",
        class: "fb-toolbar-button fb-toolbar-button-right"
    }));

    vm.buttonSave(button.viewModel({
        onclick: vm.doSave,
        label: "&Save",
        icon: "cloud-upload-alt",
        class: "fb-toolbar-button"
    }));

    vm.buttonSaveAndNew(button.viewModel({
        onclick: vm.doSaveAndNew,
        label: "Save and &New",
        icon: "plus-circle",
        class: "fb-toolbar-button"
    }));
    if (catalog.getFeather(feather).isReadOnly) {
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

formPage.component = {
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || formPage.viewModel(vnode.attrs)
        );
    },

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

    view: function () {
        let lock;
        let title;
        let vm = this.viewModel;
        let fmodel = vm.model();
        let icon = "file-alt";

        vm.toggleNew();
        vm.buttonAuth().disable();

        if (fmodel.canUpdate() === false) {
            icon = "lock";
            title = "Unauthorized to edit";
        } else {
            switch (fmodel.state().current()[0]) {
            case "/Locked":
                icon = "user-lock";
                lock = fmodel.data.lock() || {};
                title = (
                    "User: " + lock.username + "\nSince: " +
                    new Date(lock.created).toLocaleTimeString()
                );
                break;
            case "/Ready/Fetched/Dirty":
                icon = "pencil-alt";
                title = "Editing record";
                break;
            case "/Ready/New":
                icon = "plus";
                title = "New record";
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
                class: "fb-toolbar"
            }, [
                m(button.component, {
                    viewModel: vm.buttonAuth()
                }),
                m(button.component, {
                    viewModel: vm.buttonBack()
                }),
                m(button.component, {
                    viewModel: vm.buttonApply()
                }),
                m(button.component, {
                    viewModel: vm.buttonSave()
                }),
                m(button.component, {
                    viewModel: vm.buttonSaveAndNew()
                })
            ]),
            m("div", {
                class: "fb-title",
                id: "title"
            }, [
                m("i", {
                    class: "fa fa-" + icon + " fb-title-icon",
                    title: title
                }),
                m("label", vm.title())
            ]),
            m(dialog.component, {
                viewModel: vm.sseErrorDialog()
            }),
            m(dialog.component, {
                viewModel: vm.editAuthDialog()
            }),
            m(formWidget.component, {
                viewModel: vm.formWidget()
            })
        ]);
    }
};

catalog.register("components", "formPage", formPage.component);

export default Object.freeze(formPage);
