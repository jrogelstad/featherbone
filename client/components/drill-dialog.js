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

    Double-clicking a row opens that record the ordinary way: its own
    page, with the back button and the whole window to draw in, exactly
    as opening a record from a worksheet does. A form squeezed into the
    dialog had neither, and relations already worked well this way
    (John, Oct 2026). Past the first step this is the app's own
    navigation rather than a second one living inside a dialog.

    Sort and Filter are its own dialogs but are NOT rendered inside it:
    a modal dialog opened inside another modal dialog paints in front but
    cannot be clicked -- John got as far as the filter and could not get
    out of it. Whoever shows this one shows those two beside it, the way
    a workbook page does (see dashboard.js).

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
    /*
        A drill-down's title is a sentence naming the figure that was
        clicked, data and all: shown as written, not tidied into a name.
    */
    options.isTitleLiteral = true;

    vm = f.createViewModel("Dialog", options);

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
        Empties the search box, the same clear a worksheet puts inside
        its own search field.

        @method buttonClear
        @return {ViewModels.Button}
    */
    vm.buttonClear = f.prop();

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
        Opens the record a row stands for, as its own page.

        The dialog closes on the way out -- it is modal, and the board
        is leaving with it -- but says so first (options.onLeave), so
        whoever opened it can put it back when the back button returns
        to the board.

        @method openSelection
    */
    vm.openSelection = function () {
        let model = vm.tableWidget().selection();

        if (!model || model.data.isDeleted()) {
            return;
        }
        if (options.onLeave) {
            options.onLeave();
        }
        vm.cancel();
        m.route.set("/edit/:feather/:key", {
            feather: model.data.objectType(),
            key: model.id()
        });
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

    // ..........................................................
    // PRIVATE
    //

    searchInput = f.createViewModel("SearchInput", {
        refresh: function () {
            vm.tableWidget().refresh();
        }
    });
    vm.searchInput(searchInput);

    vm.buttonClear(f.createViewModel("Button", {
        class: "fb-toolbar-button fb-toolbar-button-clear",
        icon: "clear",
        onclick: searchInput.clear,
        title: "Clear search"
    }));
    vm.buttonClear().disable();
    searchInput.state().resolve("/Search/On").enter(function () {
        vm.buttonClear().enable();
    });
    searchInput.state().resolve("/Search/Off").enter(function () {
        vm.buttonClear().disable();
    });

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

    vm.buttons([vm.buttonClose]);

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

    vm.content = function () {
        let searchComponent = f.getComponent("SearchInput");
        let tableComponent = f.getComponent("TableWidget");
        let canFilter = vm.tableWidget().models().canFilter();

        return m("div", {class: "fb-drill-body"}, [
            m("div", {class: "fb-drill-toolbar"}, [
                m("div", {class: "fb-search-group"}, [
                    m(searchComponent, {viewModel: vm.searchInput()}),
                    m(f.getComponent("Button"), {
                        viewModel: vm.buttonClear()
                    })
                ]),
                /*
                    Which feather the rows came from. A drill-down is a
                    list nobody configured and cannot be traced back to
                    a worksheet, so without this there is no way to tell
                    where the data is from (John, Oct 2026).
                */
                m("div", {
                    class: "fb-drill-feather",
                    title: "These records are " + options.feather + "s"
                }, options.feather),
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
