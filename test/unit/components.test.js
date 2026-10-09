/*
    client/components/*.js render and view-model tests.

    Each component's oninit + view is run in Node (lib/render.js expands
    nested components into a plain vnode tree; no DOM). Every component
    file has at least one test. Pins key structure (buttons, labels,
    disabled/hidden flags, which editor each property format gets) and
    the view-model statecharts of Button, Dialog, SearchInput,
    TableDialog, TableWidget and NavigatorMenu. A few important trees are
    kept as golden files (test/golden/unit-component-*.json) with
    functions and generated ids masked.
*/
/*jslint node*/
"use strict";

process.env.TZ = "America/Chicago";

const {describe, it, before, beforeEach, after} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {pathToFileURL} = require("url");
const env = require("./lib/browser-env");
const testFeathers = require("./lib/test-feathers");
const {createServer} = require("./lib/fake-server");
const R = require("./lib/render");
const {matchGolden} = require("../harness/golden");

let f;
let catalog;
let comps;
let vms;
let server;
let unhandled = [];

function onUnhandled(e) {
    unhandled.push(e);
}

function golden(name, tree) {
    matchGolden("unit-component-" + name, R.toJSON(tree));
}

// Icon Park icons render as <img src=".../name.svg">, so they add no text;
// returns the icon file names (without extension) found under a node.
function iconNames(node) {
    return R.findAll(node, R.byTag("img")).map(
        (i) => String(i.attrs.src).replace(/^.*\//, "").replace(/\.svg$/, "")
    );
}

function buttons(tree) {
    return R.findAll(tree, R.byTag("button")).map(function (b) {
        return {
            icons: iconNames(b),
            text: R.text(b),
            title: b.attrs.title,
            disabled: Boolean(b.attrs.disabled),
            hidden: R.classOf(b).includes("pure-button-hidden")
        };
    });
}

// Form field labels (excludes checkbox glyph labels)
function labels(tree) {
    return R.findAll(tree, R.byTag("label")).filter(
        (l) => !R.classOf(l).includes("fb-checkbox-label")
    ).map((l) => R.text(l)).filter(Boolean);
}

function current(sc) {
    return sc.current();
}

function formWidget(model, feather) {
    return vms.formWidget({
        model,
        config: f.getForm({feather}),
        id: "fw-" + feather
    });
}

describe("client components", function () {
    before(async function () {
        let loaded = await env.loadClient({components: true, stableIds: true});
        f = loaded.f;
        catalog = loaded.catalog;
        comps = catalog.store().components();
        vms = catalog.store().viewModels();
        testFeathers.registerSystem(env);
        testFeathers.registerAll(env);
        env.registerFeather(testFeathers.WIDGETS);
        testFeathers.registerCurrencies(f);
        server = createServer();
        env.respond(server.handle);
        process.on("unhandledRejection", onUnhandled);
    });

    after(function () {
        process.removeListener("unhandledRejection", onUnhandled);
    });

    beforeEach(function () {
        env.clearRequests();
    });

    it("registers every component and view model", function () {
        assert.deepEqual(Object.keys(comps).sort(), [
            "accountMenu", "addressRelation", "aggregateDialog",
            "autonumber", "button", "changePasswordPage", "checkEmailPage",
            "checkbox", "childFormPage", "childTable", "confirmCodePage",
            "contactRelation", "dataList", "dataType", "dialog",
            "envBanner", "filterDialog", "formDialog", "formPage", "formWidget", "gantt",
            "helpLinkRelation", "moneyRelation", "navigatorMenu",
            "relationWidget", "resendCodePage", "resourceLinkRelation",
            "ribbon", "searchInput", "searchPage", "sendMailPage", "settingsPage",
            "signInPage", "sortDialog", "tableDialog", "tableWidget",
            "toolbar", "urlWidget", "workbookPage"
        ]);
        assert.deepEqual(Object.keys(vms).sort(), [
            "accountMenu", "aggregateDialog", "button", "childFormPage",
            "childTable", "contactRelation", "dialog", "filterDialog",
            "formDialog", "formWidget", "gantt", "helpLinkRelation",
            "navigatorMenu", "relationWidget", "resourceLinkRelation", "ribbon",
            "searchInput", "searchPage", "sortDialog", "tableDialog",
            "tableWidget", "toolbar"
        ]);
    });

    describe("button.js", function () {
        it("renders label with hot key, icon and title", function () {
            let vm = vms.button({
                label: "&Save",
                icon: "cloud_upload",
                title: "Save record"
            });
            let out = R.render(comps.button, {viewModel: vm});
            let b = R.find(out.tree, R.byTag("button"));
            assert.equal(vm.hotKey(), "S".charCodeAt(0));
            assert.equal(R.text(b), "S ave");
            assert.deepEqual(iconNames(b), ["upload-one"]);
            assert.equal(b.attrs.title, "Save record (Alt + S)");
            assert.equal(b.attrs.type, "button");
            assert.equal(b.attrs.disabled, false);
            golden("button", out.tree);
        });

        it("runs a concurrent Mode / Primary / Display statechart",
                function () {
            let clicks = 0;
            let vm = vms.button({label: "Go", onclick: () => (clicks += 1)});
            assert.deepEqual(current(vm.state()), [
                "/Mode/Normal", "/Primary/Off", "/Display/On"
            ]);
            vm.disable();
            vm.isPrimary(true);
            vm.hide();
            assert.deepEqual(current(vm.state()), [
                "/Mode/Disabled", "/Primary/On", "/Display/Off"
            ]);
            assert.equal(vm.isDisabled(), true);
            let b = R.find(R.render(comps.button, {viewModel: vm}).tree,
                    R.byTag("button"));
            assert.equal(b.attrs.disabled, true);
            assert.ok(R.classOf(b).includes("pure-button-primary"));
            assert.ok(R.classOf(b).includes("pure-button-hidden"));
            assert.ok(R.classOf(b).includes("fb-button-disabled"));
            vm.activate();
            assert.equal(vm.state().current()[0], "/Mode/Active");
            assert.equal(vm.class().includes("pure-button-active"), true);
            vm.deactivate();
            vm.show();
            vm.isPrimary(false);
            assert.deepEqual(current(vm.state()), [
                "/Mode/Normal", "/Primary/Off", "/Display/On"
            ]);
            vm.onclick()();
            assert.equal(clicks, 1);
        });
    });

    describe("button.js label", function () {
        it("builds fresh vnodes on every call", function () {
            // The toolbar renders a measuring copy of each button beside
            // the real one; sharing vnodes between the two corrupts the DOM
            // ("New" rendered as "Newew").
            let vm = vms.button({label: "Save and &New"});
            let first = vm.label();
            let second = vm.label();
            assert.notStrictEqual(first, second);
            first.forEach((v, i) => assert.notStrictEqual(v, second[i]));
        });

        it("never puts the same vnode in a toolbar twice", function () {
            // Regression: the toolbar's hidden measuring row and the real
            // button both drew the button's label, and when they shared
            // vnodes Mithril threw "removeChild ... not a child of this
            // node" on redraw (the form's Add and New buttons went dead).
            let vm = vms.button({label: "Save and &New", icon: "add"});
            let out = R.render(comps.toolbar, {
                id: "tb-unique",
                primaryButtons: [vm],
                overflowButtons: [vms.button({label: "&Other"})]
            });
            let seen = new Set();
            let dupes = [];

            (function walk(node) {
                if (Array.isArray(node)) {
                    node.forEach(walk);
                    return;
                }
                if (!node || typeof node !== "object") {
                    return;
                }
                if (node.tag !== undefined) {
                    if (seen.has(node)) {
                        dupes.push(node.tag);
                    }
                    seen.add(node);
                }
                walk(node.children);
            }(out.tree));

            assert.ok(seen.size > 5, "toolbar rendered");
            assert.deepEqual(dupes, [], "vnodes used more than once");
        });

        it("follows a label change between hotkey positions", function () {
            let vm = vms.button({label: "Save and &New"});
            assert.deepEqual(vm.label().map((v) => R.text(v)),
                    ["Save and", "N", "ew"]);
            assert.equal(vm.hotKey(), "N".charCodeAt(0));
            vm.label("&New");
            assert.deepEqual(vm.label().map((v) => R.text(v)), ["N", "ew"]);
            assert.equal(vm.hotKey(), "N".charCodeAt(0));
            vm.label("Plain");
            assert.equal(vm.label(), "Plain");
        });
    });

    describe("button.js isPrimary", function () {
        it("isPrimary(true) reports true",
                function () {
            let vm = vms.button({label: "x"});
            assert.equal(vm.isPrimary(true), true);
        });

        it("isPrimary() without an argument does not change the state",
                function () {
            let vm = vms.button({label: "x"});
            vm.isPrimary(true);
            vm.isPrimary();
            assert.equal(vm.primaryClass(), "pure-button-primary");
        });
    });

    describe("dialog.js", function () {
        it("renders title, message and Ok/Cancel buttons", function () {
            let vm = vms.dialog({
                title: "Confirm",
                message: "Are you sure?",
                icon: "help_outline"
            });
            let out = R.render(comps.dialog, {viewModel: vm});
            assert.equal(R.find(out.tree, R.byTag("dialog")).attrs.style.width,
                    "500px");
            let h3 = R.find(out.tree, R.byTag("h3"));
            assert.equal(R.text(h3), "Confirm");
            assert.deepEqual(iconNames(h3), ["help"]);
            assert.ok(R.text(out.tree).includes("Are you sure?"));
            assert.deepEqual(buttons(out.tree).map((b) => b.text),
                    ["O k", "C ancel"]);
            golden("dialog", out.tree);
        });

        it("show / ok / cancel drive the Display statechart", function () {
            let log = [];
            let vm = vms.dialog({
                onOk: () => log.push("ok"),
                onCancel: () => log.push("cancel")
            });
            assert.deepEqual(current(vm.state()), ["/Display/Closed"]);
            vm.show();
            assert.deepEqual(current(vm.state()), ["/Display/Showing"]);
            vm.ok();
            assert.deepEqual(current(vm.state()), ["/Display/Closed"]);
            vm.show();
            vm.cancel();
            assert.deepEqual(current(vm.state()), ["/Display/Closed"]);
            assert.deepEqual(log, ["ok", "cancel"]);
            assert.equal(vm.buttonOk().primaryClass(), "pure-button-primary");
        });
    });

    describe("form-widget.js and the property editors", function () {
        it("renders a TestItem form: inputs, checkbox, relation, child table",
                function () {
            let model = f.createModel("TestItem");
            let out = R.render(comps.formWidget, {
                viewModel: formWidget(model, "TestItem")
            });
            assert.deepEqual(labels(out.tree).slice(0, 8), [
                "Name:", "Description:", "Qty:", "Price:", "Count:",
                "Is Active:", "Category:", "Lines:"
            ]);
            let name = R.find(out.tree, R.byId("name"));
            assert.equal(name.attrs.required, true);
            assert.equal(name.attrs.type, "text");
            assert.equal(R.find(out.tree, R.byId("count")).attrs.type,
                    "number");
            assert.equal(R.find(out.tree, R.byId("isActive")).attrs.type,
                    "checkbox");
            assert.ok(R.find(out.tree, R.byTag("datalist")),
                    "relation widget datalist for category");
            let table = buttons(out.tree).map((b) => b.title);
            assert.ok(table.includes("Insert (Alt + I)"));
            assert.ok(table.includes("Delete (Alt + D)"));
            golden("form-widget-test-item", out.tree);
        });

        it("chooses an editor per format and relation", function () {
            let model = f.createModel("TestWidgets", {
                name: "Sink",
                when: "2026-01-02",
                at: "2026-01-02T03:04:00.000Z",
                amount: {
                    amount: 12.5,
                    currency: "USD",
                    effective: null,
                    baseAmount: null
                }
            });
            let out = R.render(comps.formWidget, {
                viewModel: formWidget(model, "TestWidgets")
            });
            let summary = R.findAll(out.tree, R.byClass("pure-control-group"))
                .map(function (g) {
                    let tags = new Set();
                    R.findAll(g, () => true).forEach((n) => tags.add(n.tag));
                    return {
                        label: R.text(R.find(g, R.byTag("label"))),
                        inputs: R.findAll(g, R.byTag("input")).map(
                            (i) => (i.attrs.type || "") + "#" +
                                    (i.attrs.id || "")
                        ),
                        tags: Array.from(tags).sort()
                    };
                });
            let byLabel = {};
            summary.forEach((s) => (byLabel[s.label] = s));
            // Pin key editor choices
            assert.deepEqual(byLabel["Site:"].inputs, ["url#site"]);
            assert.ok(byLabel["Amount:"].tags.includes("select"),
                    "money has a currency selector");
            assert.ok(byLabel["Address:"].tags.includes("textarea"));
            let planGroup = R.findAll(
                out.tree,
                R.byClass("pure-control-group")
            ).find((g) => R.text(R.find(g, R.byTag("label"))) === "Plan:");
            assert.ok(R.find(planGroup, R.byClass("fb-gantt")), "gantt");
            assert.deepEqual(byLabel["When:"].inputs, ["date#when"]);
            assert.deepEqual(byLabel["At:"].inputs, ["datetime-local#at"]);
            assert.deepEqual(byLabel["Email:"].inputs, ["text#email"],
                    "email has no special editor");
            assert.deepEqual(byLabel["Secret:"].inputs, ["password#secret"]);
            assert.ok(byLabel["Status:"].tags.includes("select"), "enum");
            assert.deepEqual(byLabel["Flag:"].inputs, ["checkbox#flag"]);
            matchGolden("unit-component-form-widget-editors", summary);
        });

        it("marks invalid required fields and read only properties",
                function () {
            let model = f.createModel("TestItem");
            model.data.description.isReadOnly(true);
            let out = R.render(comps.formWidget, {
                viewModel: formWidget(model, "TestItem")
            });
            assert.equal(R.find(out.tree, R.byId("description")).attrs.readonly,
                    true);
            let nameLabel = R.findAll(out.tree, R.byTag("label")).find(
                (l) => l.attrs.for === "name"
            );
            assert.deepEqual(nameLabel.attrs.style, {color: "Red"});
            model.data.name("ok");
            out = R.render(comps.formWidget, {
                viewModel: formWidget(model, "TestItem")
            });
            nameLabel = R.findAll(out.tree, R.byTag("label")).find(
                (l) => l.attrs.for === "name"
            );
            assert.deepEqual(nameLabel.attrs.style, {});
        });
    });

    describe("individual editors", function () {
        let model;
        let fw;

        before(function () {
            model = f.createModel("TestWidgets", {name: "E"});
            fw = formWidget(model, "TestWidgets");
        });

        function editor(component, prop, extra) {
            return R.render(comps[component], Object.assign({
                parentViewModel: fw,
                parentProperty: prop,
                id: prop
            }, extra)).tree;
        }

        it("checkbox.js reflects value and read only", function () {
            let clicked = [];
            let tree = R.render(comps.checkbox, {
                id: "cb",
                value: true,
                readonly: true,
                onclick: (v) => clicked.push(v)
            }).tree;
            let input = R.find(tree, R.byTag("input"));
            assert.equal(input.attrs.type, "checkbox");
            assert.equal(input.attrs.checked, true);
            assert.equal(input.attrs.disabled, true);
            assert.equal(R.find(tree, R.byTag("label")), undefined);

            tree = R.render(comps.checkbox, {
                id: "cb2",
                value: false,
                label: "Active",
                onclick: (v) => clicked.push(v)
            }).tree;
            assert.equal(R.find(tree, R.byTag("label")).attrs.for, "cb2");
            assert.equal(R.text(R.find(tree, R.byTag("label"))), "Active");
        });

        it("money-relation.js shows amount and currency", function () {
            let tree = editor("moneyRelation", "amount");
            assert.ok(R.find(tree, R.byTag("select")));
            assert.ok(R.text(tree).includes("USD"));
        });

        it("url-widget.js has an input and a launch button", function () {
            model.data.site("https://example.com");
            let tree = editor("urlWidget", "site", {prop: model.data.site});
            assert.equal(R.find(tree, R.byTag("input")).attrs.value,
                    "https://example.com");
            assert.ok(R.text(tree).includes("launch"));
        });

        it("data-type.js renders the type selector and relation dialog",
                function () {
            let tree = editor("dataType", "type");
            assert.ok(R.find(tree, R.byTag("select")));
            assert.ok(R.text(tree).includes("Data type"));
        });

        it("data-list.js renders the list editor for arrays", function () {
            model.data.options([{value: "a", label: "Alpha"}]);
            let tree = editor("dataList", "options");
            assert.ok(R.find(tree, R.byTag("input")));
            assert.ok(R.find(tree, R.byTag("dialog")));
        });

        it("autonumber.js renders an input with an edit dialog", function () {
            let tree = editor("autonumber", "autonum");
            assert.ok(R.find(tree, R.byTag("input")));
            assert.ok(R.find(tree, R.byTag("dialog")));
        });

        it("address-relation.js renders a text area and edit dialog",
                function () {
            let tree = editor("addressRelation", "address", {
                isReadOnly: model.data.address.isReadOnly
            });
            assert.ok(R.find(tree, R.byTag("textarea")));
            assert.ok(R.find(tree, R.byTag("dialog")));
        });

        it("contact-relation.js is a relation widget with a datalist",
                function () {
            let tree = editor("contactRelation", "contact");
            assert.ok(R.find(tree, R.byTag("datalist")));
            assert.equal(R.find(tree, R.byTag("input")).attrs.id, "contact");
        });

        it("resource-link-relation.js serves resource and help links",
                function () {
            assert.equal(comps.helpLinkRelation, comps.resourceLinkRelation);
            let tree = editor("resourceLinkRelation", "link");
            assert.ok(R.find(tree, R.byTag("datalist")));
            tree = editor("helpLinkRelation", "help");
            assert.ok(R.find(tree, R.byTag("datalist")));
        });

        it("relation-widget.js searches the related feather", function () {
            let item = f.createModel("TestItem");
            // Generic relation widget built from the feather definition
            let widget = f.createRelationWidget(
                item.data.category.type,
                "TestItem"
            );
            assert.equal(comps["TestItem$TestCategoryRelation"], widget,
                    "memoized in the catalog");
            let tree = R.render(widget, {
                parentViewModel: formWidget(item, "TestItem"),
                parentProperty: "category",
                isReadOnly: item.data.category.isReadOnly,
                id: "category"
            }).tree;
            assert.equal(R.find(tree, R.byTag("input")).attrs.id, "category");
            assert.ok(R.find(tree, R.byTag("datalist")));
        });

        it("gantt.js renders its toolbar and chart container", function () {
            let tree = editor("gantt", "plan");
            assert.ok(R.find(tree, R.byClass("fb-gantt")), "SVG chart host");
            assert.ok(R.text(tree).includes("View mode"));
            assert.ok(R.text(tree).includes("Show links"));
        });
    });

    describe("table-widget.js, child-table.js and dialogs", function () {
        let list;

        before(async function () {
            ["t1", "t2", "t3"].forEach(function (id, i) {
                server.put({
                    id,
                    objectType: "testItem",
                    name: "Row " + (i + 1),
                    description: "",
                    qty: i,
                    price: 1,
                    count: 0,
                    isActive: true,
                    category: null,
                    lines: [],
                    etag: "e",
                    lock: null,
                    isDeleted: false
                });
            });
            server.list("test-items", () => Object.values(
                server.records
            ).filter((r) => r.objectType === "testItem"));
            list = f.createList("TestItem", {fetch: false});
            await list.fetch();
        });

        function tableVm() {
            return vms.tableWidget({
                feather: "TestItem",
                config: {columns: [{attr: "name"}, {attr: "qty"}]},
                models: list,
                height: "200px"
            });
        }

        it("renders headers and one row per model", function () {
            let vm = tableVm();
            let out = R.render(comps.tableWidget, {viewModel: vm});
            let headers = R.findAll(out.tree, R.byTag("th")).map(
                (th) => R.text(th)
            ).filter(Boolean);
            assert.ok(headers.includes("Name"));
            assert.ok(headers.includes("Qty"));
            let rows = R.findAll(R.find(out.tree, R.byTag("tbody")),
                    R.byTag("tr"));
            assert.equal(rows.length, 3);
            assert.ok(R.text(out.tree).includes("Row 2"));
        });

        it("runs Mode and Selection statecharts", function () {
            let vm = tableVm();
            assert.deepEqual(vm.state().current().slice(0, 2),
                    ["/Mode/View", "/Selection/Off"]);
            vm.select([list[0]]);
            assert.equal(vm.state().current()[1], "/Selection/On/Clean");
            assert.equal(vm.selection(), list[0]);
            assert.equal(vm.isSelected(list[0]), true);
            vm.toggleMode();
            assert.ok(vm.state().current().includes("/Mode/Edit"));
            let out = R.render(comps.tableWidget, {viewModel: vm});
            assert.ok(R.find(out.tree, R.byTag("input")),
                    "edit mode renders editors");
            vm.toggleMode();
            assert.ok(vm.state().current().includes("/Mode/View"));
            vm.unselect();
            assert.equal(vm.state().current()[1], "/Selection/Off");
            vm.isEditModeEnabled(false);
            vm.toggleMode();
            assert.ok(vm.state().current().includes("/Mode/View"),
                    "edit disabled");
        });

        it("child-table.js renders the child toolbar", function () {
            let parent = f.createModel("TestItem");
            parent.data.lines().add({product: "A"});
            let out = R.render(comps.childTable, {
                parentViewModel: formWidget(parent, "TestItem"),
                parentProperty: "lines",
                height: "150px"
            });
            let titles = buttons(out.tree).map((b) => b.title);
            assert.deepEqual(titles.slice(0, 6), [
                "Insert (Alt + I)", "Delete (Alt + D)", "Undo (Alt + U)",
                "Open (Alt + O)", "Move up", "Move down"
            ]);
            assert.ok(R.text(out.tree).includes("Product"));
        });

        function dialogVm(name, extra) {
            return vms[name](Object.assign({
                list,
                feather: catalog.getFeather("TestItem")
            }, extra));
        }

        it("sort-dialog.js lists sort rows", function () {
            let vm = dialogVm("sortDialog", {
                filter: f.prop({sort: [{property: "name", order: "DESC"}]})
            });
            vm.show();
            let out = R.render(comps.sortDialog, {viewModel: vm});
            assert.ok(R.text(out.tree).includes("Sort"));
            assert.ok(R.text(out.tree).includes("Column"));
            assert.ok(R.text(out.tree).includes("Order"));
        });

        it("filter-dialog.js lists criteria rows", function () {
            let vm = dialogVm("filterDialog", {
                filter: f.prop({criteria: [{property: "name", value: "x"}]})
            });
            vm.show();
            let out = R.render(comps.filterDialog, {viewModel: vm});
            assert.ok(R.text(out.tree).includes("Filter"));
            assert.ok(R.text(out.tree).includes("Operator"));
            golden("filter-dialog", out.tree);
        });

        it("aggregate-dialog.js lists aggregate rows", function () {
            let vm = dialogVm("aggregateDialog", {
                aggregates: f.prop([{property: "qty", method: "SUM"}])
            });
            vm.show();
            let out = R.render(comps.aggregateDialog, {viewModel: vm});
            assert.ok(R.text(out.tree).includes("Aggregate"));
        });

        it("table-dialog.js has a Selection statechart", function () {
            let vm = dialogVm("tableDialog", {
                title: "Table",
                propertyName: "sort",
                filter: f.prop({sort: []})
            });
            let out = R.render(comps.tableDialog, {viewModel: vm});
            assert.deepEqual(buttons(out.tree).slice(0, 3).map(
                (b) => [b.text, b.icons]
            ), [
                ["Add", ["add-one"]],
                ["Remove", ["reduce-one"]],
                ["", ["close"]]
            ]);
            assert.equal(vm.isSelected(), false);
        });

        it("form-dialog.js wraps a form widget", function () {
            let vm = vms.formDialog({
                model: f.createModel("TestPlain"),
                title: "Edit note",
                config: f.getForm({feather: "TestPlain"})
            });
            vm.show();
            let out = R.render(comps.formDialog, {viewModel: vm});
            assert.ok(R.text(out.tree).includes("Edit note"));
            assert.deepEqual(labels(out.tree), ["Note:"]);
        });
    });

    describe("search-input.js", function () {
        it("toggles Search/Off and Search/On, refreshing on exit",
                function () {
            let refreshed = 0;
            let vm = vms.searchInput({refresh: () => (refreshed += 1)});
            let out = R.render(comps.searchInput, {viewModel: vm});
            assert.equal(R.find(out.tree, R.byTag("input")).attrs.value,
                    "Search", "placeholder text while Off");
            assert.deepEqual(current(vm.state()), ["/Search/Off"]);
            assert.equal(vm.text(), "Search");
            vm.start();
            assert.deepEqual(current(vm.state()), ["/Search/On"]);
            assert.equal(vm.text(), "");
            vm.text("abc");
            vm.end();
            assert.deepEqual(current(vm.state()), ["/Search/On"],
                    "canExit blocks while text is entered");
            vm.clear();
            assert.equal(refreshed >= 1, true);
        });
    });

    describe("pages", function () {
        before(function () {
            // Pieces main.js registers that the ribbon pages mount. Inert
            // here: pages render one at a time, without the app shell.
            let inert = {view: () => null};
            catalog.register("components", "homeDialogs", inert);
            catalog.register("components", "connectionBanner", inert);
            catalog.register("global", "homeRibbonGroups", () => []);
        });

        it("search-page.js builds toolbar, search and table", function () {
            catalog.register("config", "unitSearch", {
                columns: [{attr: "name"}, {attr: "qty"}]
            });
            let out = R.render(comps.searchPage, {
                feather: "TestItem",
                config: "unitSearch"
            });
            let texts = buttons(out.tree).map((b) => b.text);
            assert.ok(texts.includes("B ack"));
            assert.ok(texts.includes("S elect"));
            assert.ok(R.find(out.tree, R.byTag("table")));
        });

        it("form-page.js for a new record routes to itself and renders",
                function () {
            env.routes().length = 0;
            let out = R.render(comps.formPage, {
                feather: "test-item",
                key: "unit-new",
                create: true,
                isNew: true
            });
            assert.deepEqual(env.routes().map((r) => r.options.state), [{
                feather: "test-item",
                key: "unit-new",
                create: true,
                isNew: false
            }]);
            let texts = buttons(out.tree).map((b) => b.text);
            assert.ok(texts.includes("B ack"));
            assert.ok(texts.includes("S ave"));
            let save = buttons(out.tree).find((b) => b.text === "S ave");
            assert.deepEqual(save.icons, ["upload-one"]);
            assert.equal(save.disabled, true, "invalid new record");
            assert.equal(save.title, "\"Name\" is required");
            assert.ok(labels(out.tree).includes("Name:"));
        });

        it("child-form-page.js edits a child row", function () {
            let parent = f.createModel("TestItem");
            let line = parent.data.lines().add({product: "P"});
            catalog.register("instances", "unit-line", line);
            let error = console.error;
            console.error = () => undefined;
            let out;
            try {
                out = R.render(comps.childFormPage, {
                    key: "unit-line",
                    feather: "TestItemLine",
                    parentProperty: "lines",
                    index: 1
                });
            } finally {
                console.error = error;
            }
            let texts = buttons(out.tree).map((b) => b.text);
            assert.ok(texts.includes("D one"));
            assert.ok(texts.includes("P revious"));
            assert.ok(labels(out.tree).includes("Product:"));
        });

        it("child-form-page.js goes home for an unknown instance",
                function () {
            env.routes().length = 0;
            let out = R.render(comps.childFormPage, {
                key: "missing",
                feather: "TestItemLine",
                parentProperty: "lines"
            });
            assert.deepEqual(env.routes().map((r) => r.route), ["/home"]);
            assert.equal(R.toJSON(out.tree), undefined);
        });

        it("settings-page.js builds a form from the definition",
                async function () {
            let settings = (await import(pathToFileURL(
                path.join(env.ROOT, "client", "models", "settings.js")
            ).href)).default;
            let def = {
                name: "unitPageSettings",
                description: "Unit settings",
                properties: {
                    host: {type: "string"},
                    port: {type: "integer"}
                }
            };
            let models = catalog.store().models();
            models.unitPageSettings = () => settings(def);
            models.unitPageSettings.definition = () => def;
            let out = R.render(comps.settingsPage, {
                settings: "unitPageSettings"
            });
            assert.deepEqual(labels(out.tree),
                    ["Unit Page Settings", "Host:", "Port:"]);
            assert.deepEqual(env.requests().map((r) => r.path), [
                "/settings/unitPageSettings",
                // Who may change them: a tenant super user, or a role the
                // settings grant canUpdate
                "/settings/is-authorized/unitPageSettings"
            ]);

            // Nothing answers the check here, so the page treats the user
            // as unauthorized and the fields go read-only
            await env.flush();
            assert.equal(out.state.viewModel.isAuthorized(), false);
            assert.equal(
                out.state.viewModel.model().data.host.isReadOnly(),
                true
            );
        });

        it("send-mail-page.js renders message fields", function () {
            let out = R.render(comps.sendMailPage, {});
            assert.deepEqual(labels(out.tree),
                    ["Send Mail", "To:", "Subject:", "Text:"]);
            assert.ok(buttons(out.tree).some((b) => b.text === "S end"));
        });

        it("workbook-page.js renders a worksheet", function () {
            let wb = f.createModel("Workbook", {
                name: "UnitBook",
                label: "Unit Book",
                icon: "store",
                defaultConfig: [{
                    name: "Orders",
                    feather: "TestItem",
                    list: {columns: [{attr: "name"}, {attr: "qty"}]}
                }],
                localConfig: []
            });
            wb.state().goto("/Ready/Fetched");
            catalog.register("workbooks", "unitBook", wb);
            let out = R.render(comps.workbookPage, {
                workbook: "unit-book",
                page: "orders"
            });
            assert.ok(R.find(out.tree, R.byTag("table")));
            assert.ok(R.text(out.tree).includes("Orders"));
        });

        it("workbook-page.js goes home for an unknown workbook", function () {
            env.routes().length = 0;
            let out = R.render(comps.workbookPage, {
                workbook: "nope",
                page: "x"
            });
            assert.deepEqual(env.routes().map((r) => r.route), ["/home"]);
            assert.equal(R.toJSON(out.tree), undefined);
        });

        it("navigator-menu.js lists workbooks and toggles collapse",
                function () {
            let vm = vms.navigatorMenu();
            let out = R.render(comps.navigatorMenu, {viewModel: vm});
            let text = R.text(out.tree);
            assert.ok(text.includes("Home"));
            assert.ok(text.includes("Unit Book"));
            assert.ok(iconNames(out.tree).includes("left"));
            assert.deepEqual(vm.state().current(), ["/Expanded"]);
            vm.toggle();
            assert.deepEqual(vm.state().current(), ["/Collapsed"]);
            out = R.render(comps.navigatorMenu, {viewModel: vm});
            assert.ok(iconNames(out.tree).includes("down"));
            assert.ok(!R.text(out.tree).includes("Unit Book"),
                    "labels hidden when collapsed");
            vm.toggle();
            assert.deepEqual(vm.state().current(), ["/Expanded"]);
        });

        it("account-menu.js mounts the account dialogs", function () {
            let out = R.render(comps.accountMenu, {});
            let text = R.text(out.tree);
            ["Change Password", "Edit my contact information"].forEach(
                (t) => assert.ok(text.includes(t), t)
            );
            assert.equal(R.findAll(out.tree, R.byTag("dialog")).length, 3);
        });

        it("account-menu.js offers its actions as ribbon buttons",
                function () {
            let vm = vms.accountMenu();
            assert.deepEqual(vm.actionButtons().map(
                (b) => [b.label, b.icon, b.title]
            ), [
                ["Info", "edit", "Edit my contact information"],
                ["Password", "key", "Change password"],
                ["Sign Out", "logout", "Sign out of application"]
            ]);
        });

        it("sign-in-page.js renders the sign in pages", function () {
            let out = R.render(comps.signInPage, {});
            assert.ok(R.find(out.tree, R.byId("username")));
            assert.ok(R.find(out.tree, R.byId("password")));
            golden("sign-in-page", out.tree);
            const inputs = {
                checkEmailPage: [],
                confirmCodePage: ["confirm-code"],
                resendCodePage: ["phone", "email"],
                changePasswordPage: ["username", "password1", "password2"]
            };
            Object.keys(inputs).forEach(function (name) {
                let page = R.render(comps[name], {});
                assert.deepEqual(
                    R.findAll(page.tree, R.byTag("input")).map(
                        (i) => i.attrs.id
                    ),
                    inputs[name],
                    name
                );
            });
        });
    });

    describe("webauthn.js", function () {
        it("register fetches options, creates a credential and posts it",
                async function () {
            let created;
            let log = console.log;
            let nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
            Object.defineProperty(globalThis, "navigator", {
                configurable: true,
                value: {credentials: {
                    create: async function (opts) {
                        created = opts;
                        return {
                            id: "cred1",
                            rawId: new Uint8Array([1, 2, 3]).buffer,
                            type: "public-key",
                            response: {
                                clientDataJSON: new Uint8Array([4]).buffer,
                                attestationObject: new Uint8Array([5]).buffer
                            }
                        };
                    }
                }}
            });
            env.respond(function (req) {
                if (req.method === "GET") {
                    return {
                        user: {id: Buffer.from("user").toString("base64")},
                        challenge: "YWJj" // "abc"
                    };
                }
                return {ok: true};
            });
            console.log = () => undefined;
            try {
                assert.deepEqual(await f.webauthn().register(), {ok: true});
            } finally {
                console.log = log;
                env.respond(server.handle);
                if (nav) {
                    Object.defineProperty(globalThis, "navigator", nav);
                }
            }
            assert.deepEqual(Array.from(created.publicKey.challenge),
                    [97, 98, 99]);
            assert.deepEqual(env.requests().map((r) => [r.method, r.url]), [
                ["GET", "/demo/webauthn/reg"],
                ["POST", "/demo/webauthn/reg"]
            ]);
            assert.deepEqual(env.requests()[1].body, {
                id: "cred1",
                rawId: "AQID",
                response: {clientDataJSON: "BA==", attestationObject: "BQ=="},
                type: "public-key"
            });
        });
    });
});
