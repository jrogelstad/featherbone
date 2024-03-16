 /*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
/*jslint this, browser, unordered, devel*/
/*global f, jsonpatch, m*/
/**
   @module WorkbookPage
*/

const workbookPage = {};
const editWorkbookConfig = {
    tabs: [{
        name: "Definition"
    }, {
        name: "Authorizations"
    }],
    attrs: [{
        attr: "name",
        grid: 1
    }, {
        attr: "description",
        grid: 1
    }, {
        attr: "label",
        grid: 1
    }, {
        attr: "icon",
        grid: 1
    }, {
        attr: "sequence",
        grid: 1
    }, {
        attr: "module",
        dataList: "modules",
        grid: 1
    }, {
        attr: "authorizations",
        showLabel: false,
        height: "183px",
        grid: 2,
        columns: [{
            attr: "role"
        }, {
            label: "Read",
            attr: "canRead",
            width: 60
        }, {
            label: "Update",
            attr: "canUpdate",
            width: 70
        }]
    }]
};

const editSheetConfig = {
    tabs: [{
        name: "Sheet"
    }, {
        name: "Columns"
    }, {
        name: "Actions"
    }],
    attrs: [{
        attr: "name",
        grid: 1
    }, {
        attr: "feather",
        grid: 1
    }, {
        attr: "form",
        grid: 1,
        label: "Drill down form"
    }/*, { This is buggy on scroll
        attr: "drawerForm",
        label: "Drawer form",
        grid: 1
    }*/, {
        attr: "isEditModeEnabled",
        label: "Enable edit mode",
        grid: 1
    }, {
        attr: "helpLink",
        grid: 1,
        label: "Help Page"
    }, {
        attr: "columns",
        showLabel: false,
        height: "208px",
        grid: 2,
        columns: [{
            attr: "attr",
            label: "Column",
            width: 165
        }, {
            attr: "label",
            width: 165
        }]
    }, {
        attr: "actions",
        showLabel: false,
        height: "208px",
        grid: 3,
        columns: [{
            attr: "name",
            width: 165
        }, {
            attr: "title",
            width: 165
        }, {
            attr: "icon",
            width: 165
        }, {
            attr: "method",
            dataList: "methodList",
            width: 165
        }, {
            attr: "validator",
            dataList: "methodList",
            width: 165
        }, {
            attr: "hasSeparator",
            width: 100,
            label: "Separator"
        }]
    }]
};

let profileInvalid = false;

function saveProfile(name, config, dlg) {
    let oldProfile = f.catalog().store().data().profile();
    let newProfile = f.copy(oldProfile);
    let thePatch;

    function callback(resp) {
        newProfile.etag = resp;
        f.catalog().store().data().profile(newProfile);
    }

    if (profileInvalid) {
        return;
    }

    if (oldProfile) {
        if (!newProfile.data.workbooks) {
            newProfile.data.workbooks = {};
        }

        if (config) {
            newProfile.data.workbooks[name] = f.copy(config);
        } else {
            delete newProfile.data.workbooks[name];
        }
        thePatch = jsonpatch.compare(oldProfile.data, newProfile.data);
        if (thePatch && thePatch.length) {
            f.datasource().request({
                method: "PATCH",
                path: "/profile",
                body: {
                    etag: oldProfile.etag,
                    patch: thePatch
                }
            }).then(callback).catch(function (err) {
                profileInvalid = true;
                dlg.message(err.message);
                dlg.icon("error");
                dlg.buttonCancel().hide();
                dlg.show();
            });
        }
    } else if (config) {
        newProfile = {data: {workbooks: {}}};
        newProfile.data.workbooks[name] = f.copy(config);
        f.datasource().request({
            method: "PUT",
            path: "/profile",
            body: newProfile.data
        }).then(callback);
    }
}

/**
    Define workbook view model
    @class WorkbookPage
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {String} options.workbook name
    @param {String} options.page worksheet name
*/
workbookPage.viewModel = function (options) {
    let listState;
    let tableState;
    let searchState;
    let currentSheet;
    let theFeather;
    let sseState = f.catalog().store().global().sseState;
    let workbook = f.catalog().store().workbooks()[
        options.workbook.toCamelCase()
    ];

    if (!workbook) {
        m.route.set("/home");
        options.isInvalid = true;
        return;
    }

    let config = workbook.getConfig();
    let the_sheet = config.find(function (sheet) {
        return sheet.name.toSpinalCase() === options.page;
    });

    if (!the_sheet) {
        m.route.set("/home");
        options.isInvalid = true;
        return;
    }

    let sheetId = the_sheet.id;
    let receiverKey = f.createId();
    let vm = {};
    let toolbarButtonClass = "fb-toolbar-button";
    let formWorkbookClass = "fb-form-workbook";
    let sheetEditModel = f.createModel("Worksheet");

    // ..........................................................
    // PUBLIC
    //
    /**
        @method aggregateDialog
        @param {ViewModels.TableDialog} dialog
        @return {ViewModels.TableDialog}
    */
    vm.aggregateDialog = f.prop();
    /**
        @method buttonAggregate
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonAggregate = f.prop();
    /**
        @method buttonClear
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonClear = f.prop();
    /**
        @method buttonDelete
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonDelete = f.prop();
    /**
        @method buttonEdit
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonEdit = f.prop();
    /**
        @method buttonFilter
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonFilter = f.prop();
    /**
        @method buttonHelp
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonHelp = f.prop();
    /**
        @method buttonNew
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonNew = f.prop();
    /**
        @method buttonRefresh
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonRefresh = f.prop();
    /**
        @method buttonSave
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSave = f.prop();
    /**
        @method buttonSort
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSort = f.prop();
    /**
        @method buttonUndo
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonUndo = f.prop();
    /**
        Layout configuration.
        @method config
        @param {Object} config
        @return {Object}
    */
    vm.config = f.prop(config);
    /**
        @method confirmDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.confirmDialog = f.prop(f.createViewModel("Dialog", {
        icon: "help_outline",
        title: "Confirmation"
    }));
    /**
        Open worksheet configuration dialog.
        @method configureSheet
    */
    vm.configureSheet = function (e) {
        if (!vm.workbook().canUpdate()) {
            return;
        }
        let dlg = vm.sheetConfigureDialog();
        let sheet = vm.sheet(e.sheetId);
        let data = {
            id: sheet.id,
            name: sheet.name,
            feather: sheet.feather,
            form: sheet.form || "D",
            drawerForm: sheet.drawerForm || "N",
            isEditModeEnabled: sheet.isEditModeEnabled,
            openInNewWindow: sheet.openInNewWindow,
            actions: sheet.actions || [],
            columns: sheet.list.columns || [],
            helpLink: sheet.helpLink || ""
        };

        sheetEditModel.set(data, true, true);
        sheetEditModel.state().send("fetched");
        vm.sheetConfigureDialog().onOk = function () {
            data = sheetEditModel.toJSON();

            // Update sheet with new values
            sheet.name = data.name;
            sheet.feather = data.feather;
            sheet.form = data.form;
            sheet.drawerForm = data.drawerForm;
            sheet.isEditModeEnabled = data.isEditModeEnabled;
            sheet.openInNewWindow = data.openInNewWindow;
            sheet.list.columns.length = 0;
            sheet.actions = sheet.actions || [];
            sheet.actions.length = 0;
            sheet.helpLink = data.helpLink;
            data.columns.forEach(function (d) {
                if (d === undefined) { // Deleted
                    return;
                }
                sheet.list.columns.push({
                    attr: d.attr,
                    label: d.label,
                    width: d.width
                });
            });
            data.actions.forEach(function (d) {
                if (d === undefined) { // Deleted
                    return;
                }
                sheet.actions.push({
                    name: d.name,
                    title: d.title,
                    icon: d.icon,
                    method: d.method,
                    validator: d.validator,
                    hasSeparator: Boolean(d.hasSeparator)
                });
            });

            if (data.isEditModeEnabled) {
                vm.buttonEdit().enable();
            } else {
                vm.buttonEdit().disable();
            }
            vm.tableWidget().isEditModeEnabled(data.isEditModeEnabled);
            handleDrawer();

            vm.saveProfile();
            vm.refresh();
        };
        dlg.show();
    };
    /**
        @method footerId
        @param {String} id
        @return {String}
    */
    vm.footerId = f.prop(f.createId());
    /**
        Drop event handler for deleting sheets.
        @method deleteSheet
        @param {Event} event
    */
    vm.deleteSheet = function (ev) {
        let doDelete;
        let idx = ev.dataTransfer.getData("text") - 0;
        let confirmDialog = vm.confirmDialog();

        doDelete = function () {
            let activeSheetId = vm.sheet().id;
            let deleteSheetId = vm.config()[idx].id;

            vm.config().splice(idx, 1);
            if (activeSheetId === deleteSheetId) {
                if (idx === vm.config().length) {
                    idx -= 1;
                }
                vm.tabClicked(config[idx].name);
            }
            vm.saveProfile();
        };

        confirmDialog.message(
            "Are you sure you want to delete this sheet?"
        );
        confirmDialog.icon("help_outline");
        confirmDialog.onOk(doDelete);
        confirmDialog.show();
    };
    /**
        Editor dialog for workbook.
        @method editWorkbookDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.editWorkbookDialog = f.prop();
    /**
        @method filter
        @param {Filter} filter
        @return {Filter}
    */
    vm.filter = f.prop();
    /**
        @method filterDialog
        @param {ViewModels.FilterDialog} dialog
        @return {ViewModels.FilterDialog}
    */
    vm.filterDialog = f.prop();
    /**
        Form widget for inline viewing

        @method formWidget
        @param {ViewModels.FormWidget} [widget]
        @return {ViewModels.FormWidget}
    */
    vm.formWidget = f.prop();

    /**
        @method goHome
    */
    vm.goHome = function () {
        m.route.set("/home");
    };
    /**
        @method goSignOut
    */
    vm.goSignOut = function () {
        f.state().send("signOut");
    };
    /**
        @method goSettings
    */
    vm.goSettings = function () {
        m.route.set("/settings/:settings", {
            settings: workbook.data.launchConfig().settings
        });
    };
    /**
        @method isDraggingTab
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isDraggingTab = f.prop(false);
    /**
        @method hasSettings
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.hasSettings = f.prop(
        Boolean(workbook.data.launchConfig().settings)
    );
    /**
        Create a new model in form, tab or row depending on state.
        @method modelNew
    */
    vm.modelNew = function () {
        let form = f.catalog().store().data().forms().find(function (frm) {
            return vm.sheet().form === frm.name;
        }) || {};

        if (!vm.tableWidget().modelNew()) {
            m.route.set("/edit/:feather/:key", {
                feather: theFeather.name.toSpinalCase(),
                key: f.createId()
            }, {
                state: {
                    form: form.id,
                    receiver: receiverKey,
                    create: true
                }
            });
        }
    };
    /**
        Open model in form.
        @method openModel
    */
    vm.modelOpen = function () {
        let selection = vm.tableWidget().selection();
        let sheet = vm.sheet() || {};
        let form = f.catalog().store().data().forms().find(function (frm) {
            return sheet.form === frm.name;
        }) || {};
        let type = vm.tableWidget().model().data.objectType();

        if (selection) {
            m.route.set("/edit/:feather/:key", {
                feather: type,
                key: selection.id()
            }, {
                state: {
                    form: form.id,
                    receiver: receiverKey
                }
            });
        }
    };
    /**
        @method menu
        @param {ViewModels.NavigatorMenu} navigator
        @return {ViewModels.NavigatorMenu}
    */
    vm.menu = f.prop(f.createViewModel("NavigatorMenu"));
    /**
        Add a new sheet to the workbook.
        @method newSheet
    */
    vm.newSheet = function () {
        let undo;
        let newSheet;
        let sheetName;
        let next;
        let dialogSheetConfigure = vm.sheetConfigureDialog();
        let theId = f.createId();
        let sheets = vm.sheets();
        let sheet = f.copy(vm.sheet());
        let i = 0;

        while (!sheetName) {
            i += 1;
            next = "Sheet" + i;
            if (sheets.indexOf(next) === -1) {
                sheetName = next;
            }
        }

        i = 0;

        newSheet = {
            id: theId,
            name: sheetName,
            feather: sheet.feather,
            list: {
                columns: sheet.list.columns
            },
            actions: []
        };

        undo = function () {
            vm.config().pop();
            dialogSheetConfigure.onCancel(undefined);
        };

        vm.config().push(newSheet);
        dialogSheetConfigure.onCancel(undo);
        vm.configureSheet({sheetId: theId});
    };
    /**
        @method ondragend
    */
    vm.ondragend = function () {
        vm.isDraggingTab(false);
    };
    /**
        @method ondragover
        @param {Event} event
    */
    vm.ondragover = function (ev) {
        ev.preventDefault();
    };
    /**
        @method ondragstart
        @param {Integer} index
        @param {Event} event
    */
    vm.ondragstart = function (idx, ev) {
        vm.isDraggingTab(true);
        ev.dataTransfer.setData("text", idx);
    };
    /**
        @method ondrop
        @param {Integer} index
        @param {Array} ary
        @param {Event} event
    */
    vm.ondrop = function (toIdx, ary, ev) {
        let moved;
        let fromIdx;

        ev.preventDefault();
        fromIdx = ev.dataTransfer.getData("text") - 0;
        if (fromIdx !== toIdx) {
            moved = ary.splice(fromIdx, 1)[0];
            ary.splice(toIdx, 0, moved);
            vm.saveProfile();
        }
        vm.isDraggingTab(false);
    };
    /**
        Handle keyboard up and down keys.
        @method onkeydown
        @param {Event} event
    */
    vm.onkeydown = function (ev) {
        let key = ev.key || ev.keyIdentifier;

        switch (key) {
        case "Up":
        case "ArrowUp":
            vm.tableWidget().goPrevRow();
            break;
        case "Down":
        case "ArrowDown":
            vm.tableWidget().goNextRow();
            break;
        }
    };
    /**
        Handle on click of actions menu.
        @method onclickactions
    */
    vm.onclickactions = function () {
        vm.showActions(true);
    };
    /**
        Hide actions menu if mouse out.
        @method onmouseoutactions
        @param {Event} event
    */
    vm.onmouseoutactions = function (ev) {
        if (
            !ev || !ev.relatedTarget || !ev.relatedTarget.id ||
            ev.relatedTarget.id.indexOf("nav-actions") === -1
        ) {
            vm.showActions(false);
        }
    };
    /**
        Handle on click of workbook menu.
        @method onclickmenu
    */
    vm.onclickmenu = function () {
        vm.showMenu(!vm.showMenu());
    };
    /**
        Hide workbook menu if mouse out.
        @method onmouseoutactions
        @param {Event} event
    */
    vm.onmouseoutmenu = function (ev) {
        if (
            !ev || !ev.relatedTarget || !ev.relatedTarget.id ||
            ev.relatedTarget.id.indexOf("nav-menu") === -1
        ) {
            vm.showMenu(false);
        }
    };
    /**
        Requery list.
        @method refresh
    */
    vm.refresh = function () {
        vm.tableWidget().refresh();
    };
    /**
        Revert selected model if dirty.
        @method revert
    */
    vm.revert = function () {
        saveProfile(workbook.data.name(), undefined, vm.confirmDialog());
        document.location.reload();
    };
    /**
        Save user workbook configuration to server.
        @method saveProfile
    */
    vm.saveProfile = function () {
        if (!vm.workbook().canUpdate()) {
            return;
        }
        saveProfile(
            workbook.data.name(),
            vm.config,
            vm.confirmDialog()
        );
    };
    /**
        @method searchInput
        @param {ViewModels.SearchInput} input
        @return {ViewModels.SearchInput}
    */
    vm.searchInput = f.prop();
    /**
        Make user's model configuration the new default.
        @method share
    */
    vm.share = function () {
        let confirmDialog = vm.confirmDialog();
        let action = f.prop("Default");
        let name = f.prop("");
        let template = f.prop("");
        let lastError = f.prop("");
        let dlgSelectId1 = f.createId();
        let dlgSelectId2 = f.createId();
        let workbooks = f.catalog().store().workbooks();
        let temps = Object.keys(workbooks).filter(
            (k) => workbooks[k].data.isTemplate()
        ).map(function (t) {
            return m("option", {
                value: t
            }, workbooks[t].data.name());
        });
        let names = Object.keys(workbooks);
        let profileData = f.copy(vm.config());
        let mdlname;
        let data;
        let opts;
        let wb;

        function isValid() {
            switch (action()) {
            case "Copy":
            case "New":
                if (!name()) {
                    lastError("Name is required");
                    return false;
                }

                if (names.some((n) => workbooks[n].data.name() === name())) {
                    lastError("Name is already used");
                    return false;
                }

                break;
            case "Update":
                if (!template()) {
                    lastError("Select a template to update");
                    return false;
                }

                break;
            }
            lastError("");
            return true;
        }

        async function copy(isTmpl) {
            data = workbook.toJSON();
            delete data.authorizations;
            data.defaultConfig = profileData;
            data.localConfig = [];
            data.id = f.createId();
            data.name = name();
            data.label = name();
            data.isTemplate = isTmpl;
            opts = {
                workbook: data.name.toSpinalCase(),
                key: data.defaultConfig[0].name.toSpinalCase()
            };
            mdlname = name().toSpinalCase().toCamelCase();

            // Instantiate copy
            wb = f.catalog().store().models().workbook();
            wb.set(data);
            // Save it to server
            await wb.save();
            wb.checkUpdate();
            // Register it locally
            f.catalog().register("workbooks", mdlname, wb);
        }

        async function doShare() {
            switch (action()) {
            case "Default":
                workbook.data.localConfig(profileData);
                workbook.save();
                break;
            case "Copy":
                await copy(false);

                // Go to new copy
                m.route.set("/workbook/:workbook/:key", opts);
                break;
            case "New":
                await copy(true);
                break;
            case "Update":
                wb = workbooks[template()];
                data = workbook.toJSON();
                delete data.authorizations;
                delete data.id;
                delete data.name;
                delete data.isTemplate;
                data.defaultConfig = profileData;
                data.localConfig = [];
                wb.set(data);
                wb.save();
                break;
            }
        }

        if (!vm.workbook().canUpdate()) {
            return;
        }

        confirmDialog.content = function () {
            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: dlgSelectId1
                    }, "Share Layout As:"),
                    m("select", {
                        id: dlgSelectId1,
                        onchange: (e) => action(e.target.value),
                        value: action()
                    }, [
                        m("option", {
                            value: "Default"
                        }, "Default for this workbook"),
                        m("option", {
                            value: "Copy"
                        }, "Copy to a new workbook"),
                        m("option", {
                            value: "New"
                        }, "New workbook template"),
                        m("option", {
                            value: "Update"
                        }, "Update to a template")
                    ])
                ]),
                m("div", {
                    class: "pure-control-group",
                    style: {display: (
                        (action() === "Default" || action() === "Update")
                        ? "none"
                        : undefined
                    )}
                }, [
                    m("label", {}, "Workbook Name:"),
                    m("input", {
                        onchange: (e) => name(e.target.value),
                        value: name(),
                        autocomplete: "off"
                    })
                ]),
                m("div", {
                    class: "pure-control-group",
                    style: {display: (
                        action() !== "Update"
                        ? "none"
                        : undefined
                    )}
                }, [
                    m("label", {
                        for: dlgSelectId2
                    }, "Template:"),
                    m("select", {
                        id: dlgSelectId2,
                        onchange: (e) => template(e.target.value),
                        value: template()
                    }, temps)
                ])
            ]);
        };
        confirmDialog.icon("share");
        confirmDialog.title("Share");
        confirmDialog.onOk(doShare);
        confirmDialog.buttonOk().isDisabled = () => !isValid();
        confirmDialog.buttonOk().title = function () {
            if (!isValid()) {
                return lastError();
            }
        };
        confirmDialog.show();
    };
    /**
        Return sheet configuration. Passing `value` will set
        the sheet to the configuration of `value`.
        @method sheet
        @param {Object | String} id
        @param {Object} value
        @return {Object} sheet
    */
    vm.sheet = function (id, value) {
        let idx = 0;

        if (id) {
            if (typeof id === "object") {
                value = id;
                id = sheetId;
            }
        } else {
            id = sheetId;
        }

        if (currentSheet && currentSheet.id === id && !value) {
            return currentSheet;
        }

        config.some(function (item) {
            if (id === item.id) {
                return true;
            }
            idx += 1;
        });
        if (value) {
            vm.config().splice(idx, 1, value);
        }
        currentSheet = vm.config()[idx];

        return currentSheet;
    };
    /**
        Return an array of sheet names.
        @method sheets
        @return {Array}
    */
    vm.sheets = function () {
        return vm.config().map(function (sheet) {
            return sheet.name;
        });
    };
    /**
        @method sheetConfigureDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.sheetConfigureDialog = f.prop();
    /**
        @method showFilterDialog
    */
    vm.showFilterDialog = function () {
        if (vm.tableWidget().models().canFilter()) {
            vm.filterDialog().show();
        }
    };
    /**
        @method showActions
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.showActions = f.prop(false);
    /**
        @method showMenu
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.showMenu = f.prop(false);
    /**
        @method showSortDialog
    */
    vm.showSortDialog = function () {
        if (vm.tableWidget().models().canFilter()) {
            vm.sortDialog().show();
        }
    };
    /**
        @method sortDialog
        @param {ViewModels.SortDialog} dialog
        @return {ViewModels.SortDialog}
    */
    vm.sortDialog = f.prop();
    /**
        Dialog for handling server side events.
        @method sseDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.sseErrorDialog = f.prop(f.createViewModel("Dialog", {
        icon: "error",
        title: "Connection Error",
        message: (
            "You have lost connection to the server. " +
            "Click \"Ok\" to attempt to reconnect."
        ),
        onOk: function () {
            document.location.reload();
        }
    }));
    vm.sseErrorDialog().buttonCancel().hide();
    /**
        Navigate to sheet.
        @method tabClicked
        @param {String} name Sheet name
    */
    vm.tabClicked = function (sheet) {
        let wb = workbook.data.name().toSpinalCase();
        let pg = sheet.toSpinalCase();

        m.route.set("/workbook/:workbook/:page", {
            workbook: wb,
            page: pg,
            key: f.hashCode(wb + "-" + pg)
        });
    };
    /**
        @method tableWidget
        @param {ViewModels.TableWidget} widget
        @return {ViewModels.TableWidget}
    */
    vm.tableWidget = f.prop();
    /**
        @method workbook
        @return {Models.Workbook} dialog
    */
    vm.workbook = function () {
        return workbook;
    };
    /**
        @method zoom
        @param {Integer} percent
        @return {Integer}
    */
    vm.zoom = function (value) {
        let w = vm.tableWidget();
        if (value !== undefined) {
            w.zoom(value);
        }
        return w.zoom();
    };

    // ..........................................................
    // PRIVATE
    //
    theFeather = f.catalog().getFeather(vm.sheet().feather);

    // Register callback
    f.catalog().register("receivers", receiverKey, {
        callback: function (model) {
            let tableModel = vm.tableWidget().selection();

            if (!(tableModel && tableModel.id() === model.id())) {
                vm.tableWidget().models().add(model, true, true);
            }
        }
    });

    // Create search widget view model
    vm.searchInput(f.createViewModel("SearchInput", {
        refresh: vm.refresh
    }));

    function hasDrawer() {
        return (
            vm.sheet().drawerForm &&
            vm.sheet().drawerForm !== "N"
        );
    }

    // Create table widget view model
    vm.tableWidget(f.createViewModel("TableWidget", {
        class: formWorkbookClass,
        actions: vm.sheet().actions,
        config: vm.sheet().list,
        isEditModeEnabled: vm.sheet().isEditModeEnabled,
        feather: vm.sheet().feather,
        search: vm.searchInput().value,
        ondblclick: vm.modelOpen,
        subscribe: true,
        footerId: vm.footerId(),
        loadAllProperties: hasDrawer(),
        printTitle: vm.sheet().name.toName()
    }));
    vm.actions = function () {
        let acts = vm.tableWidget().actions();
        acts.forEach(function (act) {
            let oc = act.attrs.onclick;
            act.attrs.onclick = function (ev) {
                oc(ev);
                vm.showActions(false);
                ev.preventDefault();
                ev.stopPropagation();
            };
        });
        return acts;
    };

    function getDrawerForm() {
        let df = vm.sheet().drawerForm;
        if (!df || df === "N") {
            return false;
        }
        let form = {};

        if (df !== "D") {
            form = f.catalog().store().data().forms().find(function (frm) {
                return df === frm.name;
            }) || {};
        }
        return f.getForm({
            form: form.id,
            feather: theFeather.name
        });
    }

    function handleDrawer() {
        vm.tableWidget().isMultiSelectEnabled(!hasDrawer());
        vm.tableWidget().isLoadAllProperties(hasDrawer());
    }

    vm.tableWidget().state().resolve("/Selection/On").enter(function () {
        let df = vm.sheet().drawerForm || "N";
        if (df === "N") {
            vm.formWidget(undefined);
            return;
        }
        let mdl = vm.tableWidget().selections()[0];
        let formWidget = vm.formWidget();

        if (
            formWidget &&
            formWidget.model() &&
            formWidget.model().id() === mdl.id()
        ) {
            return;
        }

        vm.formWidget(undefined);
        m.redraw.sync(); // Force refresh
        mdl.state().send("freeze");
        vm.formWidget(f.createViewModel("FormWidget", {
            model: mdl,
            config: getDrawerForm(),
            maxHeight: "300px",
            isScrollable: true
        }));
        vm.formWidget().style().width = "92%";
    });
    vm.tableWidget().state().resolve("/Selection/Off").enter(function () {
        vm.formWidget(undefined);
    });
    handleDrawer();

    // Watch when columns change and save profile
    vm.tableWidget().isDragging.state().resolve("/Changing").exit(function () {
        if (!vm.tableWidget().isDragging()) {
            vm.saveProfile();
        }
    });

    // Create dialog view models
    vm.filterDialog(f.createViewModel("FilterDialog", {
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: theFeather,
        onOk: vm.saveProfile
    }));

    vm.editWorkbookDialog(f.createViewModel("FormDialog", {
        icon: "backup_table",
        title: "Edit workbook",
        model: workbook,
        config: editWorkbookConfig
    }));
    vm.editWorkbookDialog().style().width = "500px";
    vm.editWorkbookDialog().style().height = "450px";

    vm.editWorkbookDialog().buttons().push(
        f.prop(f.createViewModel("Button", {
            label: "Delete",
            onclick: function () {
                let dlg = vm.confirmDialog();
                dlg.message(
                    "This will permanently delete this workbook. Are you sure?"
                );
                dlg.icon("report_problem");
                dlg.onOk(function () {
                    let name = workbook.data.name();
                    name = name.toSpinalCase().toCamelCase();

                    function callback() {
                        f.catalog().unregister("workbooks", name);
                        vm.editWorkbookDialog().cancel();
                        m.route.set("/home");
                    }

                    workbook.delete(true).then(callback);
                });
                dlg.show();
            },
            class: "fb-button-delete"
        }))
    );
    if (!f.currentUser().isSuper) {
        vm.editWorkbookDialog().buttons()[2]().disable();
        vm.editWorkbookDialog().buttons()[2]().title(
            "Must be a super user to delete this workbook"
        );
    }

    vm.sheetConfigureDialog(f.createViewModel("FormDialog", {
        icon: "table_chart",
        title: "Configure worksheet",
        model: sheetEditModel,
        config: editSheetConfig
    }));
    vm.sheetConfigureDialog().style().width = "520px";
    vm.sheetConfigureDialog().style().height = "475px";
    vm.sheetConfigureDialog().state().resolve(
        "/Display/Showing"
    ).exit(() => sheetEditModel.state().send("clear"));

    vm.aggregateDialog(f.createViewModel("AggregateDialog", {
        aggregates: vm.tableWidget().aggregates,
        list: vm.tableWidget().models(),
        feather: theFeather,
        onOk: function () {
            vm.refresh();
            vm.saveProfile();
        }
    }));

    vm.sortDialog(f.createViewModel("SortDialog", {
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: theFeather,
        onOk: vm.saveProfile
    }));

    // Create button view models
    vm.buttonEdit(f.createViewModel("Button", {
        onclick: function () {
            vm.tableWidget().toggleMode();
            vm.sheet().isEditMode = vm.isEditMode();
            vm.saveProfile();
        },
        title: "Edit mode",
        hotkey: "E",
        class: toolbarButtonClass
    }));
    vm.isEditMode = () => vm.tableWidget().mode().current()[0] === "/Mode/Edit";
    vm.buttonEdit().icon = function () {
        if (vm.isEditMode()) {
            return "edit";
        }
        return "edit_off";
    };
    if (!vm.tableWidget().isEditModeEnabled()) {
        vm.buttonEdit().disable();
    }

    vm.buttonSave(f.createViewModel("Button", {
        onclick: vm.tableWidget().save,
        label: "&Save",
        icon: "cloud_upload",
        class: toolbarButtonClass
    }));
    vm.buttonSave().hide();

    vm.buttonNew(f.createViewModel("Button", {
        onclick: vm.modelNew,
        label: "&New",
        icon: "add_circle_outline",
        class: toolbarButtonClass
    }));

    vm.buttonDelete(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelDelete,
        label: "&Delete",
        icon: "delete",
        class: toolbarButtonClass
    }));
    vm.buttonDelete().disable();

    if (theFeather.isReadOnly || theFeather.isChild) {
        vm.buttonNew().disable();
        vm.buttonNew().title("Table is read only");
        vm.buttonDelete().title("Table is read only");
    }

    vm.buttonUndo(f.createViewModel("Button", {
        onclick: vm.tableWidget().undo,
        label: "&Undo",
        icon: "undo",
        class: toolbarButtonClass
    }));
    vm.buttonUndo().hide();

    vm.buttonRefresh(f.createViewModel("Button", {
        onclick: vm.refresh,
        title: "Refresh",
        hotkey: "R",
        icon: "autorenew",
        class: "fb-toolbar-button fb-toolbar-button-left-side"
    }));

    vm.buttonClear(f.createViewModel("Button", {
        onclick: vm.searchInput().clear,
        title: "Clear search",
        hotkey: "C",
        icon: "clear",
        class: (
            toolbarButtonClass +
            " fb-toolbar-button-clear"
        )
    }));
    vm.buttonClear().disable();

    vm.buttonSort(f.createViewModel("Button", {
        onclick: vm.showSortDialog,
        icon: "sort_by_alpha",
        hotkey: "T",
        title: "Sort results",
        class: "fb-toolbar-button fb-toolbar-button-middle-side"
    }));

    vm.buttonFilter(f.createViewModel("Button", {
        onclick: vm.showFilterDialog,
        icon: "filter_list",
        hotkey: "F",
        title: "Filter results",
        class: "fb-toolbar-button fb-toolbar-button-middle-side"
    }));

    vm.buttonAggregate(f.createViewModel("Button", {
        onclick: vm.aggregateDialog().show,
        icon: "calculate",
        title: "Calculate sum, count and other aggregations",
        class: "fb-toolbar-button fb-toolbar-button-right-side"
    }));

    vm.buttonHelp(f.createViewModel("Button", {
        onclick: function () {
            let link = vm.sheet().helpLink;

            if (link && link.resource) {
                window.open(link.resource);
            }
        },
        icon: "help",
        hotkey: "H",
        title: "Open help page",
        class: "fb-menu-button fb-menu-setup fb-toolbar-button-right-side"
    }));

    // Bind button states to list statechart events
    listState = vm.tableWidget().models().state();
    listState.resolve("/Fetched").enter(function () {
        let model = vm.tableWidget().selection();

        if (model && model.canUndo()) {
            vm.buttonDelete().hide();
            vm.buttonUndo().show();
            return;
        }

        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    listState.resolve("/Fetched/Clean").enter(function () {
        vm.buttonSave().disable();
    });
    listState.state().resolve("/Fetched/Dirty").enter(function () {
        vm.buttonSave().enable();
    });

    // Bind button states to search statechart events
    searchState = vm.searchInput().state();
    searchState.resolve("/Search/On").enter(function () {
        vm.buttonClear().enable();
    });
    searchState.resolve("/Search/Off").enter(function () {
        vm.buttonClear().disable();
    });

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Mode/View").enter(function () {
        vm.buttonEdit().deactivate();
        vm.buttonSave().hide();
    });
    tableState.resolve("/Mode/Edit").enter(function () {
        vm.buttonEdit().activate();
        vm.buttonSave().show();
    });
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonDelete().disable();
        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
        vm.buttonDelete().hide();
        vm.buttonUndo().show();
    });

    sseState.resolve("Error").enter(function () {
        vm.sseErrorDialog().show();
    });

    f.catalog().isAuthorized({
        feather: theFeather.name,
        action: "canCreate"
    }).then(function (canCreate) {
        if (!canCreate) {
            vm.buttonNew().disable();
            vm.buttonNew().title("Unauthorized");
        }
    }).catch(function (err) {
        console.error(err.message);
    });

    if (vm.sheet().isEditMode) {
        vm.tableWidget().toggleMode();
    }

    return vm;
};

/**
    Define workbook component.
    @class WorkbookPage
    @static
    @namespace Components
*/

function spinButtonView() {
    let vm = this.viewModel.buttonRefresh();
    let tw = this.viewModel.tableWidget();
    let iclass = "material-icons-outlined fb-button-icon ";

    if (tw.models().state().current()[0].slice(0, 5) === "/Busy") {
        iclass += "fb-spin";
    }

    return m("button", {
        class: "pure-button " + vm.class(),
        id: vm.id(),
        type: "button",
        style: vm.style(),
        disabled: vm.isDisabled(),
        onclick: vm.onclick(),
        oncreate: function () {
            document.addEventListener("keydown", vm.onkeydown);
        },
        onremove: function () {
            document.removeEventListener("keydown", vm.onkeydown);
        },
        title: vm.title()
    }, [
        m("i", {
            class: iclass
        }, vm.icon())
    ], vm.label());
}

workbookPage.component = {
    /**
        Must pass view model instance or options to build one.
        @method oninit
        @param {Object} [vnode] Virtual node
        @param {Object} [vnode.attrs] Options
        @param {String} [vnode.attrs.workbook] Workbook name
        @param {Object} [vnode.attrs.page] Worksheet name
        @param {String} [vnode.attrs.isInvalid] Passed if view model
        was determined invalid. View will return nothing.
    */
    oninit: function (vnode) {
        let workbook = vnode.attrs.workbook;
        let sheet = vnode.attrs.page;
        let viewModels = f.catalog().register("workbookViewModels");

        if (viewModels[workbook] && viewModels[workbook][sheet]) {
            this.viewModel = viewModels[workbook][sheet];
            m.redraw();
            return;
        }

        this.viewModel = workbookPage.viewModel(vnode.attrs);

        if (vnode.attrs.isInvalid) {
            return; // Nothing to see here folks...
        }

        this.viewModel.menu().selected(workbook);

        // Memoize the model for total state persistence
        if (!viewModels[workbook]) {
            viewModels[workbook] = {};
        }

        viewModels[workbook][sheet] = this.viewModel;
    },

    /**
        @method onupdate
        @param {Object} vnode Virtual node
    */
    onupdate: function (vnode) {
        this.viewModel.menu().selected(vnode.attrs.workbook);
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} view
    */
    view: function (vnode) {
        if (vnode.attrs.isInvalid) {
            return; // Nothing to see here folks...
        }

        let filterMenuClass;
        let tabs;
        let vm = this.viewModel;
        let createTabClass = "pure-button fb-workbook-tab-edit";
        let deleteTabClass = "pure-button fb-workbook-tab-edit";
        let activeSheet = vm.sheet();
        let config = vm.config();
        let idx = 0;
        let btn = f.getComponent("Button");
        let srtdlg = f.getComponent("SortDialog");
        let fltdlg = f.getComponent("FilterDialog");
        let frmdlg = f.getComponent("FormDialog");
        let aggdlg = f.getComponent("AggregateDialog");
        let srch = f.getComponent("SearchInput");
        let tw = f.getComponent("TableWidget");
        let dlg = f.getComponent("Dialog");
        let nav = f.getComponent("NavigatorMenu");
        let menu = f.getComponent("AccountMenu");
        let toolbarClass = "fb-toolbar";
        let menuButtonClass = "fb-menu-button";
        let menuAuthLinkClass = (
            "pure-menu-link " + (
                vm.workbook().canUpdate()
                ? ""
                : " pure-menu-disabled"
            )
        );
        let fw = f.getComponent("FormWidget");
        let formWidget = vm.formWidget();
        let drawerForm;
        let spbtn = {
            oninit: btn.oninit,
            view: spinButtonView
        };

        let hbtn = vm.buttonHelp();
        let setstyle = {};

        if (!vm.sheet().helpLink || !vm.sheet().helpLink.resource) {
            hbtn.disable();
            hbtn.title("No help page assigned to this worksheet");
            setstyle.borderTopRightRadius = "6px";
            setstyle.borderBottomRightRadius = "6px";
        } else {
            hbtn.enable();
            hbtn.title("Open help page (Alt+H)");
            setstyle.borderTopRightRadius = "0px";
            setstyle.borderBottomRightRadius = "0px";
        }

        if (formWidget) {
            drawerForm = m("div", {
                id: formWidget.model().id() + "wrapper",
                style: {height: "300px"}
            }, [m(fw, {viewModel: formWidget})]);
        }

        if (vm.tableWidget().selections().some((s) => s.canDelete())) {
            vm.buttonDelete().enable();
        } else {
            vm.buttonDelete().disable();
        }

        // Build tabs
        tabs = vm.sheets().map(function (sheet) {
            let tab;
            let tabOpts;
            let csheet = vm.config().find((sh) => sh.name === sheet);

            // Build tab
            tabOpts = {
                class: (
                    "fb-workbook-tab pure-button" + (
                        activeSheet.name.toName() === sheet.toName()
                        ? " pure-button-primary"
                        : ""
                    )
                ),
                onclick: vm.tabClicked.bind(this, sheet)
            };

            if (vm.config().length > 1) {
                tabOpts.ondragover = vm.ondragover;
                tabOpts.draggable = true;
                tabOpts.ondragstart = vm.ondragstart.bind(this, idx);
                tabOpts.ondrop = vm.ondrop.bind(this, idx, config);
                tabOpts.ondragend = vm.ondragend;
                tabOpts.class += " fb-workbook-tab-draggable";
            }

            if (csheet && f.hiddenFeathers().indexOf(csheet.feather) !== -1) {
                if (f.currentUser().isSuper) {
                    tabOpts.style = {color: "red"};
                    tabOpts.title = (
                        "Feather hidden: " +
                        "this tab is only visible to super users"
                    );
                } else {
                    tabOpts.style = {display: "none"};
                }
            }

            tab = m("button[type=button]", tabOpts, sheet.toName());
            idx += 1;

            return tab;
        });

        // Create/delete tab buttons
        if (vm.isDraggingTab()) {
            createTabClass += " fb-workbook-tab-edit-hide";
            deleteTabClass += " fb-workbook-tab-edit-show";
        } else {
            createTabClass += " fb-workbook-tab-edit-show";
            deleteTabClass += " fb-workbook-tab-edit-hide";
        }

        tabs.push(m("button[type=button]", {
            class: createTabClass,
            title: "Add sheet",
            onclick: vm.newSheet
        }, [m("i", {
            class: "material-icons-outlined"
        }, "add")]));

        // Delete target
        tabs.push(m("div", {
            class: deleteTabClass,
            ondragover: vm.ondragover,
            ondrop: vm.deleteSheet
        }, [m("i", {
            class: "material-icons-outlined"
        }, "delete")]));

        // Finally assemble the whole view
        filterMenuClass = "pure-menu-link";
        if (!vm.tableWidget().models().canFilter()) {
            filterMenuClass += " pure-menu-disabled";
        }

        return m("div", {
            id: "workbook-table",
            class: "pure-form",
            oncreate: function () {
                let title = vm.sheet().name.toName();
                document.getElementById("fb-title").text = title;
            }
        }, [
            m(srtdlg, {
                viewModel: vm.sortDialog()
            }),
            m(fltdlg, {
                viewModel: vm.filterDialog()
            }),
            m(aggdlg, {
                viewModel: vm.aggregateDialog()
            }),
            m(frmdlg, {
                viewModel: vm.editWorkbookDialog()
            }),
            m(frmdlg, {
                viewModel: vm.sheetConfigureDialog()
            }),
            m(dlg, {
                viewModel: vm.confirmDialog()
            }),
            m(dlg, {
                viewModel: vm.sseErrorDialog()
            }),
            m("div", {
                class: "fb-navigator-menu-container"
            }, [
                f.snackbar(),
                m(nav, {
                    viewModel: vm.menu()
                }),
                m("div", [
                    m("div", {
                        id: "toolbar",
                        class: toolbarClass,
                        onkeydown: vm.onkeydown
                    }, [
                        m(btn, {
                            viewModel: vm.buttonEdit()
                        }),
                        m(btn, {
                            viewModel: vm.buttonSave()
                        }),
                        m(btn, {
                            viewModel: vm.buttonNew()
                        }),
                        m(btn, {
                            viewModel: vm.buttonDelete()
                        }),
                        m(btn, {
                            viewModel: vm.buttonUndo()
                        }),
                        m("div", {
                            id: "nav-actions-div",
                            class: (
                                "pure-menu " +
                                "custom-restricted-width " +
                                "fb-menu"
                            ),
                            onclick: vm.onclickactions,
                            onmouseout: vm.onmouseoutactions
                        }, [
                            m("span", {
                                id: "nav-actions-button",
                                class: (
                                    "pure-button " +
                                    "material-icons-outlined " +
                                    menuButtonClass
                                )
                            }, "menuarrow_drop_down"),
                            m("ul", {
                                id: "nav-actions-list",
                                class: (
                                    "pure-menu-list fb-menu-list " + (
                                        vm.showActions()
                                        ? " fb-menu-list-show"
                                        : ""
                                    )
                                )
                            }, vm.actions())
                        ]),
                        m("div", {
                            class: "fb-toolbar-spacer"
                        }),
                        m(srch, {
                            viewModel: vm.searchInput()
                        }),
                        m(btn, {
                            viewModel: vm.buttonClear()
                        }),
                        m(spbtn, {
                            viewModel: vm
                        }),
                        m(btn, {
                            viewModel: vm.buttonSort()
                        }),
                        m(btn, {
                            viewModel: vm.buttonFilter()
                        }),
                        m(btn, {
                            viewModel: vm.buttonAggregate()
                        }),
                        m(btn, {
                            viewModel: vm.buttonHelp()
                        }),
                        m("div", {
                            id: "nav-menu-div",
                            class: (
                                "pure-menu " +
                                "custom-restricted-width " +
                                "fb-menu fb-menu-setup "
                            ),
                            onclick: vm.onclickmenu,
                            onmouseout: vm.onmouseoutmenu
                        }, [
                            m("span", {
                                id: "nav-menu-button",
                                title: "Manage workbook",
                                class: (
                                    "pure-button " +
                                    "material-icons-outlined " +
                                    menuButtonClass +
                                    " fb-menu-button-middle-side"
                                ),
                                style: setstyle
                            }, "settingsarrow_drop_down"),
                            m("ul", {
                                id: "nav-menu-list",
                                class: (
                                    "pure-menu-list fb-menu-list " +
                                    "fb-menu-list-setup" + (
                                        vm.showMenu()
                                        ? " fb-menu-list-show"
                                        : ""
                                    )
                                )
                            }, [
                                m("li", {
                                    id: "nav-menu-configure-worksheet",
                                    class: menuAuthLinkClass,
                                    title: "Configure current worksheet",
                                    onclick: vm.configureSheet
                                }, [m("i", {
                                    id: "nav-menu-configure-worksheet-icon",
                                    class: (
                                        "material-icons-outlined " +
                                        "fb-menu-list-icon"
                                    )
                                }, "table_chart")], "Sheet"),
                                m("li", {
                                    id: "nav-menu-configure-workbook",
                                    class: menuAuthLinkClass,
                                    title: "Configure current workbook",
                                    onclick: (
                                        vm.workbook().canUpdate()
                                        ? vm.editWorkbookDialog().show
                                        : undefined
                                    )
                                }, [m("i", {
                                    id: "nav-menu-configure-workbook-icon",
                                    class: (
                                        "material-icons-outlined " +
                                        "fb-menu-list-icon"
                                    )
                                }, "edit_note")], "Workbook"),
                                m("li", {
                                    id: "nav-menu-share",
                                    class: menuAuthLinkClass,
                                    title: "Share workbook configuration",
                                    onclick: vm.share
                                }, [m("i", {
                                    id: "nav-menu-share-icon",
                                    class: (
                                        "material-icons " +
                                        "fb-menu-list-icon"
                                    )
                                }, "share")], "Share"),
                                m("li", {
                                    id: "nav-menu-revert",
                                    class: "pure-menu-link",
                                    title: (
                                        "Revert workbook configuration " +
                                        "to default state"
                                    ),
                                    onclick: vm.revert
                                }, [m("i", {
                                    id: "nav-menu-revert-icon",
                                    class: "material-icons fb-menu-list-icon"
                                }, "undo")], "Revert"),
                                m("li", {
                                    id: "nav-menu-settings",
                                    class: (
                                        "pure-menu-link " +
                                        "fb-menu-list-separator" + (
                                            vm.hasSettings()
                                            ? ""
                                            : " pure-menu-disabled"
                                        )
                                    ),
                                    title: "Change module settings",
                                    onclick: vm.goSettings
                                }, [m("i", {
                                    id: "nav-menu-settings-icon",
                                    class: "material-icons fb-menu-list-icon"
                                }, "build")], "Settings")
                            ])
                        ]),
                        m(menu)
                    ]),
                    m(tw, {
                        viewModel: vm.tableWidget()
                    }),
                    m("div", {
                        id: vm.footerId()
                    }, [
                        drawerForm,
                        tabs,
                        m("i", {
                            class: (
                                "fa fa-search-plus " +
                                "fb-zoom-icon fb-zoom-right-icon"
                            )
                        }),
                        m("input", {
                            class: "fb-zoom-control",
                            title: "Zoom " + vm.zoom() + "%",
                            type: "range",
                            step: "5",
                            min: "50",
                            max: "150",
                            value: vm.zoom(),
                            oninput: (e) => vm.zoom(e.target.value)
                        }),
                        m("i", {
                            class: (
                                "fa fa-search-minus " +
                                "fb-zoom-icon fb-zoom-left-icon"
                            )
                        })
                    ])
                ])
            ])
        ]);
    }
};

f.catalog().register("components", "workbookPage", workbookPage.component);
