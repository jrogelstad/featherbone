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
import State from "../state.js";

const formPage = {};
const m = window.m;
const console = window.console;

const authFeather = {
    name: "FormAuthorization",
    plural: "FormAuthorizations",
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
            isRequired: true
        },
        canRead: {
            description: "Role can read object",
            type: "boolean",
            default: null
        },
        canUpdate: {
            description: "Role can update object",
            type: "boolean",
            default: null
        },
        canDelete: {
            description: "Role can update object",
            type: "boolean",
            default: null
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
        }
    }
};

// Local model for handling authorization
function authModel(data) {
    let that = model(data, authFeather);
    let d = that.data;

    // Three way switch
    function action(...args) {
        let oaction = "can" + args[0];
        let faction = "featherCan" + args[0];

        if (args.length === 2) {
            d[action].style("");
            if (d[faction]() !== null) {
                if (d[oaction]() === null) {
                    d[oaction](!d[faction]());
                } else if (d[oaction]() === d[faction]()) {
                    d[oaction](null);
                    d[oaction].style("DEFAULT");
                } else {
                    d[oaction](!d[oaction]);
                }
            } else {
                d[oaction](!d[oaction]);
            }
        }

        if (d[oaction]() === null) {
            return d[faction]();
        } else {
            return d[oaction]();
        }
    }

    function featherActionChange(action, prop) {
        action = "can" + action;

        d[action].style(
            (d[action]() === null && prop.newValue() !== null)
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
                        canRead: d.canRead(),
                        canUpdate: d.canUpdate(),
                        canDelete: d.canDelete()
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

    that.addCalculated({
        name: "editorCanRead",
        type: "boolean",
        function: action.bind(null, "Read")
    });

    that.addCalculated({
        name: "editorCanUpdate",
        type: "boolean",
        function: action.bind(null, "Update")
    });

    that.addCalculated({
        name: "editorCanDelete",
        type: "boolean",
        function: action.bind(null, "Delete")
    });

    that.onChange("featherCanRead", featherActionChange.bind(null, "Read"));
    that.onChange("featherCanUpdate", featherActionChange.bind(null, "Update"));
    that.onChange("featherCanDelete", featherActionChange.bind(null, "Delete"));
}

// Custom list for authorization handling
function createAuthList() {
    let state;
    let ary = [];
    let dirty = [];

    function doFetch(context) {
        let payload;
        let body = {};

        // Undo any edited rows
        ary.forEach((model) => model.undo());

        function callback(data) {
            ary.reset();

            data.forEach(function (item) {
                let amodel = authModel(item);

                amodel.state().goto("/Ready/Fetched");
                ary.add(amodel);
            });

            state.send("fetched");
            context.resolve(ary);
        }

        payload = {
            method: "POST",
            url: "do/get-authorizations",
            data: body
        };

        return m.request(payload).then(callback).catch(console.error);
    }

    function doSave(context) {
        let requests = [];

        dirty.forEach((model) => requests.push(model.save()));

        Promise.all(requests).then(context.resolve).catch(context.reject);
    }

    function doSend(...args) {
        let evt = args[0];

        return new Promise(function (resolve, reject) {
            let context = {
                resolve: resolve,
                reject: reject
            };

            state.send(evt, context);
        });
    }

    function onClean() {
        dirty.remove(this);
        state.send("changed");
    }

    function onDelete() {
        ary.remove(this);
        state.send("changed");
    }

    function onDirty() {
        dirty.push(this);
        state.send("changed");
    }

    ary.add = function (model) {
        let mstate;
        let id = model.id();
        let idx = ary.index();
        let oid = Number(idx[id]);

        if (!Number.isNaN(oid)) {
            dirty.remove(ary[oid]);
            ary.splice(oid, 1, model);
        } else {
            idx[id] = ary.length;
            ary.push(model);
        }

        mstate = model.state();
        mstate.resolve("/Delete").enter(onDirty.bind(model));
        mstate.resolve("/Ready/Fetched/Dirty").enter(onDirty.bind(model));
        mstate.resolve("/Ready/Fetched/Clean").enter(onClean.bind(model));
        mstate.resolve("/Deleted").enter(onDelete.bind(model));

        if (model.state().current()[0] === "/Ready/New") {
            dirty.push(model);
            state.send("changed");
        }
    };

    ary.fetch = () => doSend("fetch");

    ary.index = f.prop({});

    // Remove a model from the list
    ary.remove = function (model) {
        let id = model.id();
        let idx = ary.index();
        let i = Number(idx[id]);

        if (!Number.isNaN(i)) {
            ary.splice(i, 1);
            Object.keys(idx).forEach(function (key) {
                if (idx[key] > i) {
                    idx[key] -= 1;
                }
            });
            delete idx[id];
        }
        dirty.remove(model);
    };

    ary.reset = function () {
        ary.length = 0;
        dirty.length = 0;
        ary.index({});
    };

    ary.save = () => doSend("save");

    ary.state = () => state;

    dirty.remove = function (model) {
        let i = dirty.indexOf(model);

        if (i > -1) {
            dirty.splice(i, 1);
        }
    };

    // Define statechart
    state = State.define(function () {
        this.state("Unitialized", function () {
            this.event("fetch", function (context) {
                this.goto("/Busy", {context: context});
            });
        });

        this.state("Busy", function () {
            this.state("Fetching", function () {
                this.enter(doFetch);
            });
            this.state("Saving", function () {
                this.enter(doSave);
                this.event("changed", function () {
                    this.goto("/Fetched");
                });
                this.canExit = () => !dirty.length;
            });
            this.event("fetched", function () {
                this.goto("/Fetched");
            });
        });

        this.state("Fetched", function () {
            this.event("changed", function () {
                this.goto("/Fetched", {force: true});
            });
            this.c = this.C; // Squelch jslint complaint
            this.c(function () {
                if (dirty.length) {
                    return "./Dirty";
                }
                return "./Clean";
            });
            this.event("fetch", function (context) {
                this.goto("/Busy", {context: context});
            });
            this.state("Clean", function () {
                this.enter(function () {
                    dirty.length = 0;
                });
            });
            this.state("Dirty", function () {
                this.event("save", function (context) {
                    this.goto("/Busy/Saving", {context: context});
                });
            });
        });
    });
    state.goto();

    return ary;
}

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
    let authorizations = createAuthList();

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
        message: (
            "Content here!"
        ),
        onOk: function () {
            return;
        }
    }));
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
