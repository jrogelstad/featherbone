/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
    The records behind a number.

    A dashboard tile says one figure; this says which records add up to
    it. The caller hands over a list configuration shaped exactly like a
    worksheet's -- columns, aggregates, filter -- and gets a modal list
    with the same manners as a worksheet: search, sort, filter, export,
    print, and a totals footer that adds up to the figure that was
    clicked.

    It is a copy of a worksheet, not a reference to one. A drill-down
    that pointed at a worksheet would break the first time somebody
    reconfigured or deleted it, and the dashboard would have no way of
    knowing. What travels here is a plain configuration object, so
    whatever happens to the worksheet that inspired it, the drill-down
    keeps working (John, Oct 2026).

    What it deliberately does not do, because this is a view onto
    figures rather than a place to work:

      * no edit mode -- isEditModeEnabled is off, and the records it
        lists are often read-only anyway
      * no import
      * none of the worksheet's own actions (Release, Post, and so on):
        an action belongs where somebody is doing the work, not where
        they are reading a number

    Navigation stays inside the dialog. Double-clicking a row opens that
    record's form here, with Back to return; a relation on that form
    opens its own record the same way, as deep as somebody cares to go.
    Nothing routes, so the board behind is still there, still arranged,
    when the dialog closes -- which is the point of drilling in rather
    than navigating away.

    @module DrillDialog
*/

const drillDialog = {};

/**
    @class DrillDialog
    @constructor
    @extends ViewModels.Dialog
    @namespace ViewModels
    @param {Object} options
    @param {String} options.title What the figure was
    @param {String} options.feather Feather to list
    @param {Object} options.config List configuration: columns,
    aggregates and filter, shaped as a worksheet's `list`
    @param {String} [options.icon] Dialog icon
*/
drillDialog.viewModel = function (options) {
    let vm;
    let tableWidget;
    let searchInput;

    options = options || {};
    options.icon = options.icon || "search";
    options.title = options.title || "Details";

    vm = f.createViewModel("Dialog", options);

    /**
        What is on screen: the list, or a record opened from it. A stack
        rather than a flag, because a relation on a form opens another
        form, and Back has to come back one step rather than all the way.

        @method stack
        @return {Array}
    */
    vm.stack = f.prop([]);

    /**
        The list itself.

        @method tableWidget
        @return {ViewModels.TableWidget}
    */
    vm.tableWidget = f.prop();

    /**
        @method searchInput
        @return {ViewModels.SearchInput}
    */
    vm.searchInput = f.prop();

    /**
        @method sortDialog
        @return {ViewModels.SortDialog}
    */
    vm.sortDialog = f.prop();

    /**
        @method filterDialog
        @return {ViewModels.FilterDialog}
    */
    vm.filterDialog = f.prop();

    /**
        The form showing, if any -- the top of the stack.

        @method formWidget
        @return {ViewModels.FormWidget}
    */
    vm.formWidget = function () {
        let stack = vm.stack();

        if (!stack.length) {
            return undefined;
        }
        return stack[stack.length - 1].form;
    };

    /**
        Opens a record's form inside the dialog.

        The model is fetched rather than taken from the list, so this
        works the same whether it came from a row that is already loaded
        or from a relation on a form that was never in the list at all.

        @method openRecord
        @param {String} feather
        @param {String} id
        @param {String} [name] What to call it in the heading
    */
    vm.openRecord = function (feather, id, name) {
        let model = f.createModel(feather);
        let widget;

        model.id(id);
        widget = f.createViewModel("FormWidget", {
            config: f.getForm({feather}),
            id: f.createId(),
            model,
            outsideElementIds: []
        });
        vm.stack().push({
            feather,
            form: widget,
            name: name || feather.toName()
        });
        model.fetch();
        m.redraw();
    };

    /**
        Opens the record a row stands for.

        @method openSelection
    */
    vm.openSelection = function () {
        let model = vm.tableWidget().selection();

        if (!model) {
            return;
        }
        vm.openRecord(
            model.data.objectType(),
            model.id(),
            recordName(model)
        );
    };

    /**
        Back one step: out of a form to whatever it was opened from. Does
        nothing on the list, which is the bottom.

        @method back
    */
    vm.back = function () {
        vm.stack().pop();
        m.redraw();
    };

    /**
        What the heading says: the figure, then wherever drilling has
        reached since.

        @method heading
        @return {String}
    */
    vm.heading = function () {
        let said = [options.title];

        vm.stack().forEach(function (step) {
            said.push(step.name);
        });
        return said.join(" › ");
    };

    /**
        One of the list's own actions, by id -- Print List and Export are
        the two this offers. Import is not among them: see the module
        comment.

        @method action
        @param {String} id
        @return {Object}
    */
    vm.action = function (id) {
        return vm.tableWidget().actionItems().find(function (item) {
            return item.id === id;
        });
    };

    /**
        @method isListShowing
        @return {Boolean}
    */
    vm.isListShowing = function () {
        return !vm.stack().length;
    };

    // ..........................................................
    // PRIVATE
    //

    searchInput = f.createViewModel("SearchInput", {
        refresh: function () {
            vm.tableWidget().refresh();
        }
    });
    vm.searchInput(searchInput);

    tableWidget = f.createViewModel("TableWidget", {
        actions: [],
        config: f.copy(options.config),
        feather: options.feather,
        /*
            Sized against the dialog, not the window. Left to itself the
            list measures the room below its own top edge and takes all
            of it, which inside a dialog means running past the bottom
            and taking Close with it.
        */
        height: "60vh",
        isEditModeEnabled: false,
        isImportEnabled: false,
        ondblclick: vm.openSelection,
        printTitle: options.title,
        search: searchInput.value,
        subscribe: false
    });
    vm.tableWidget(tableWidget);

    vm.sortDialog(f.createViewModel("SortDialog", {
        filter: tableWidget.filter,
        list: tableWidget.models(),
        feather: f.catalog().getFeather(options.feather)
    }));

    vm.filterDialog(f.createViewModel("FilterDialog", {
        filter: tableWidget.filter,
        list: tableWidget.models(),
        feather: f.catalog().getFeather(options.feather)
    }));

    /*
        A relation on a form opened here drills in place instead of
        routing, so the dialog -- and the board behind it -- survive.
        Registered while this dialog is showing and taken away when it
        closes, so a relation widget anywhere else keeps routing as it
        always did (see relation-widget.js).
    */
    vm.state().resolve("/Display/Showing").enter(function () {
        f.catalog().register("global", "openRecordInPlace", function (spec) {
            vm.openRecord(spec.feather, spec.id, spec.name);
        });
    });
    vm.state().resolve("/Display/Closed").enter(function () {
        f.catalog().register("global", "openRecordInPlace", undefined);
        vm.stack([]);
    });

    /**
        Back out of a form. Hidden on the list, which has nothing behind
        it but the board the dialog came from -- Close is how you get
        back there.

        @method buttonBack
        @return {ViewModels.Button}
    */
    vm.buttonBack = f.prop(f.createViewModel("Button", {
        class: "fb-dialog-button",
        label: "&Back",
        onclick: vm.back
    }));
    vm.buttonBack().icon("arrow_back");
    vm.buttonBack().title("Back to the list");

    /**
        @method buttonClose
        @return {ViewModels.Button}
    */
    vm.buttonClose = f.prop(f.createViewModel("Button", {
        class: "fb-dialog-button",
        label: "&Close",
        onclick: vm.cancel
    }));
    vm.buttonClose().isPrimary(true);

    vm.buttons([vm.buttonBack, vm.buttonClose]);

    /*
        The list fills the dialog; the dialog is sized against the
        viewport rather than the list, so one with three rows and one
        with three hundred are the same shape on screen.
    */
    /*
        Wide enough for a worksheet's own columns: cells are content-box,
        so each column's padding is added outside its configured width
        and a set of columns adding up to 1000 needs nearer 1200. Capped
        against the viewport so a narrow window gets a dialog it can
        actually show, with the list scrolling sideways inside it.
    */
    vm.style({
        maxWidth: "95vw",
        width: "1320px"
    });
    vm.class("fb-drill-dialog");

    vm.title = vm.heading;

    vm.content = function () {
        let searchComponent = f.getComponent("SearchInput");
        let tableComponent = f.getComponent("TableWidget");
        let formComponent = f.getComponent("FormWidget");
        let sortComponent = f.getComponent("SortDialog");
        let filterComponent = f.getComponent("FilterDialog");
        let form = vm.formWidget();
        let canFilter = vm.tableWidget().models().canFilter();

        if (form) {
            vm.buttonBack().show();
            return m("div", {
                class: "fb-drill-body fb-drill-body-form"
            }, [
                m(formComponent, {viewModel: form})
            ]);
        }

        vm.buttonBack().hide();
        return m("div", {class: "fb-drill-body"}, [
            m(sortComponent, {viewModel: vm.sortDialog()}),
            m(filterComponent, {viewModel: vm.filterDialog()}),
            m("div", {class: "fb-drill-toolbar"}, [
                m(searchComponent, {viewModel: vm.searchInput()}),
                m("div", {class: "fb-toolbar-fill"}),
                toolButton("Sort", "sort_by_alpha", canFilter, function () {
                    vm.sortDialog().show();
                }),
                toolButton("Filter", "filter_list", canFilter, function () {
                    vm.filterDialog().show();
                }),
                toolButton("Print List", "print", true, function () {
                    vm.action("print-list").onclick();
                }),
                toolButton("Export", "file_download", true, function () {
                    vm.action("export").onclick();
                })
            ]),
            m("div", {class: "fb-drill-table"}, [
                m(tableComponent, {viewModel: vm.tableWidget()})
            ])
        ]);
    };

    return vm;
};

/*
    What to call a record in the heading: its natural key where it has
    one (an invoice number says more than "Invoice"), else the name of
    what it is.
*/
function recordName(model) {
    let said = (
        typeof model.naturalKey === "function"
        ? model.naturalKey()
        : ""
    );

    return said || String(model.data.objectType()).toName();
}

/*
    One of the small buttons along the top of the list. Plain vnodes
    rather than Button view models: these carry no state of their own,
    and the ribbon's own small buttons are built the same way.
*/
function toolButton(label, icon, enabled, onclick) {
    return m("button", {
        class: (
            enabled
            ? "fb-drill-tool"
            : "fb-drill-tool fb-drill-tool-disabled"
        ),
        disabled: !enabled,
        onclick: (
            enabled
            ? onclick
            : undefined
        ),
        title: label,
        type: "button"
    }, [f.icon(icon, "fb-drill-tool-icon"), label]);
}

f.catalog().register("viewModels", "drillDialog", drillDialog.viewModel);

/*
    No component of its own: the dialog component renders this view
    model, the same way the confirm and form dialogs are rendered from
    whatever page owns them.

        m(f.getComponent("Dialog"), {viewModel: vm.drillDialog()})
*/
