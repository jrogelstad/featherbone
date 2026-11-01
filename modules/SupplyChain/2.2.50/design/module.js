/*jslint devel browser this unordered for*/
/*global printJS*/
/*global console, atob, Blob*/
const catalog = f.catalog();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const printPdf = catalog.register("functions").printPdf;

// Mixins for common functionality
function mixinBom(model, inputProp) {
    let d = model.data;

    function renumber(attr) {
        let nr = 0;

        d[attr]().forEach(function (item) {
            nr += 1;
            item.data.sequence.state().send("silence");
            item.data.sequence(nr);
            item.data.sequence.state().send("report");
        });
    }

    if (d[inputProp]) {
        model.onChanged(inputProp, renumber.bind(null, inputProp));
        model.onChanged(inputProp + ".sequence", renumber.bind(
            null,
            inputProp
        ));
    }
}

catalog.register("mixins", "mixinBillOfMaterial", mixinBom);

function mixinItemConversion(model) {
    let d = model.data;
    let codes;
    let itemConversions = f.createList("ItemConversion", {fetch: false});

    function conversionUnits(item) {
        let units;
        let glbCnv = catalog.store().data().itemUnitConversions().slice();
        let itemUnit = item.data.unit();

        function hasStockUnit(gc) {
            return (
                gc.data.fromUnit().id() === itemUnit.id() ||
                gc.data.toUnit().id() === itemUnit.id()
            );
        }

        function nonStockUnit(conv) {
            let unit;
            if (conv.data.fromUnit().id() === itemUnit.id()) {
                unit = conv.data.toUnit();
            } else {
                unit = conv.data.fromUnit();
            }
            return unit;
        }

        units = glbCnv.filter(hasStockUnit).map(nonStockUnit);
        units = units.concat(itemConversions.map(nonStockUnit));
        units.push(item.data.unit());

        return units;
    }

    function conversions(item) {
        let convs;
        let glbCnv = catalog.store().data().itemUnitConversions().slice();
        let itemUnit = item.data.unit();

        function hasStockUnit(gc) {
            return (
                gc.data.fromUnit().id() === itemUnit.id() ||
                gc.data.toUnit().id() === itemUnit.id()
            );
        }

        convs = glbCnv.filter(hasStockUnit);
        convs = convs.concat(itemConversions);

        return convs;
    }

    function handleUnitOptions() {
        let item = d.item();

        function callback(resp) {
            if (!resp) {
                itemConversions.reset();
                return;
            }
            resp.forEach(function (data) {
                let mdl = f.createModel("ItemConversion", data);
                itemConversions.add(mdl);
            });
            codes = conversionUnits(item).map((u) => u.data.code());
            codes.push(item.data.unit().data.code());
            model.data.unit.filter().criteria = [{
                property: "code",
                operator: "IN",
                value: codes
            }];
        }

        if (item) {
            f.datasource().request({
                method: "POST",
                path: "/design/get-item-conversions",
                body: {id: d.item().id()}
            }).then(callback).catch(function (err) {
                console.error(err);
            });
        } else {
            itemConversions.reset();
            model.data.unit.filter().criteria.length = 0;
        }
    }

    model.data.unit.filter().sort.push({property: "code"});
    model.data.item.filter().sort.push({property: "number"});

    model.onChanged("item", function () {
        if (d.item()) {
            d.unit(d.item().data.unit.toJSON());
        }
    });
    model.onChanged("item", handleUnitOptions);
    model.onChanged("unit", function () {
        // find matching unit ratio
        let conv;
        let one = 1;
        let unit = d.unit();
        let item = d.item();

        if (!item || !unit) {
            return;
        }

        if (item.data.unit().id() === unit.id()) {
            d.ratio(1);
        } else {
            conv = conversions(item).find(
                (cu) => (
                    cu.data.fromUnit().id() === unit.id() ||
                    cu.data.toUnit().id() === unit.id()
                )
            );
            if (conv) {
                if (conv.data.fromUnit().id() === unit.id()) {
                    d.ratio(one.div(conv.data.ratio.toJSON()));
                } else {
                    d.ratio(conv.data.ratio.toJSON());
                }
            } else {
                d.ratio(0);
            }
        }
    });
    model.onLoad(handleUnitOptions);
    model.onValidate(function () {
        if (!d.ratio.toJSON()) {
            throw "No conversion for selected unit of measure";
        }
    });
}

catalog.register("mixins", "mixinItemConversion", mixinItemConversion);

/**
    Bill of material item
*/
function bomItem(data, feather) {
    feather = feather || catalog.getFeather("BillOfMaterialItem");
    let model = f.createModel(data, feather);
    let d = model.data;

    mixinItemConversion(model);

    d.item.filter().criteria.push({
        property: "status",
        operator: "!=",
        value: "I"
    });

    d.item.filter().sort.push({
        property: "number"
    });

    function unitCost() {
        let item = d.item();
        if (item) {
            return {
                amount: item.data.cost.toJSON().amount.times(
                    d.ratio.toJSON()
                ),
                currency: item.data.cost().currency
            };
        }
        return {
            amount: 0,
            currency: "USD"
        };
    }
    model.addCalculated({
        format: "money",
        name: "unitCost",
        function: unitCost,
        type: "object"
    });
    model.data.unitCost.toJSON = unitCost;

    return model;
}

bomItem.calculated = f.prop({
    unitCost: {
        type: "object",
        description: "Unit cost based on bill of material unit of measure",
        format: "money"
    }
});

catalog.registerModel("BillOfMaterialItem", bomItem);

/* Create internal feather for rendering bom */
const bomFeather = Object.freeze({
    name: "ItemIndentedBom",
    plural: "ItemIndentedBoms",
    description: "Indented Bill of materials",
    isSystem: true,
    properties: {
        created: {
            description: "Create time",
            type: "string",
            format: "dateTime"
        },
        createdBy: {
            description: "Created by user",
            type: "string"
        },
        drawingLink: {
            description: "Drawing",
            type: {
                "properties": [
                    "icon",
                    "displayValue",
                    "label",
                    "resource"
                ],
                relation: "ResourceLink"
            }
        },
        id: {
            description: "Unique identifier",
            type: "string"
        },
        product: {
            description: "Product",
            type: {
                relation: "Item",
                properties: [
                    "description",
                    "id",
                    "number",
                    "objectType",
                    "status"
                ]
            },
            isRequired: true
        },
        fixedQuantity: {
            alias: "Fixed Qty.",
            description: "Fixed quantity",
            type: "number"
        },
        isDeleted: {
            description: "Is deleted",
            type: "boolean"
        },
        laborCost: {
            description: "Labor cost",
            type: "object",
            format: "money"
        },
        lock: {
            description: "Lock",
            type: "object",
            default: null
        },
        level: {
            description: "Indentation level",
            type: "integer"
        },
        materialCost: {
            description: "Material cost",
            type: "object",
            format: "money"
        },
        overheadCost: {
            description: "Overhead cost",
            type: "object",
            format: "money"
        },
        quantityPer: {
            alias: "Qty. Per",
            description: "Quantity per",
            type: "number"
        },
        ratio: {
            description: "Unit of measure conversion ratio",
            type: "number"
        },
        revision: {
            description: "Revision",
            type: "string"
        },
        serviceCost: {
            description: "Service cost",
            type: "object",
            format: "money"
        },
        totalCost: {
            description: "Total cost",
            type: "object",
            format: "money"
        },
        unit: {
            description: "Unit of measure",
            type: {
                relation: "ItemUnit",
                properties: [
                    "code",
                    "description"
                ]
            }
        },
        updated: {
            description: "Updated time",
            type: "string",
            formate: "dateTime"
        },
        updatedBy: {
            description: "Updated by user",
            type: "string"
        }
    }
});

catalog.register("feathers", "ItemIndentedBom", bomFeather);

/**
    Indented bill of material item
*/
function iBomItem(data, feather) {
    feather = feather || catalog.getFeather("ItemIndentedBom");

    return f.createModel(data, feather);
}

catalog.registerModel("ItemIndentedBom", iBomItem);

const wuFeather = {
    name: "IndentedWhereUsed",
    plural: "IndentedWhereUseds",
    description: "Indented list of where parent is used",
    isSystem: true
};
wuFeather.properties = f.copy(bomFeather.properties);
delete wuFeather.properties.laborCost;
delete wuFeather.properties.materialCost;
delete wuFeather.properties.overheadCost;
delete wuFeather.properties.serviceCost;
delete wuFeather.properties.totalCost;

catalog.register("feathers", "IndentedWhereUsed", wuFeather);

/**
    Indented where used
*/
function wuBomItem(data, feather) {
    feather = feather || catalog.getFeather("IndentedWhereUsed");

    return f.createModel(data, feather);
}

catalog.registerModel("IndentedWhereUsed", wuBomItem);

const fwuFeather = {
    name: "FinalWhereUsed",
    plural: "FinalWhereUseds",
    description: "List of final products where parent is used",
    isSystem: true
};
fwuFeather.properties = f.copy(wuFeather.properties);
delete fwuFeather.properties.level;
delete fwuFeather.properties.fixedQuantity;
delete fwuFeather.properties.quantityPer;

catalog.register("feathers", "FinalWhereUsed", fwuFeather);

/**
    Final where used
*/
function fwuItem(data, feather) {
    feather = feather || catalog.getFeather("FinalWhereUsed");

    return f.createModel(data, feather);
}

catalog.registerModel("FinalWhereUsed", fwuItem);

/**
    Product
*/
let defWhs;
function defaultWhs() {
    if (defWhs === undefined) {
        let ds = catalog.store().models().designSettings();
        if (ds && ds.data.defaultSite()) {
            defWhs = ds.data.defaultSite();
        } else {
            defWhs = null;
        }
    }
    return defWhs;
}
function product(data, feather) {
    feather = feather || catalog.getFeather("Product");
    if (feather.properties.site) {
        feather.properties.site.default = defaultWhs();
    }
    let model = f.createModel(data, feather);
    let d = model.data;
    let loadingBom = false;
    let loadingWU = false;
    let loadingFwu = false;
    let iBoms = f.createList("ItemIndentedBom", {
        fetch: false,
        indentOn: "level"
    });
    let iBomsInit = false;
    let wuBoms = f.createList("IndentedWhereUsed", {
        fetch: false,
        indentOn: "level"
    });
    let wuBomsInit = false;
    let fwuList = f.createList("FinalWhereUsed", {fetch: false});
    let fwuListInit = false;
    let iBomMdl = f.catalog().store().models().itemIndentedBom;
    let wuBomMdl = f.catalog().store().models().indentedWhereUsed;
    let fwuMdl = f.catalog().store().models().finalWhereUsed;

    mixinBom(model, "billOfMaterialItems");

    function handleReadOnly() {
        d.isSold.isReadOnly(false);
        d.price.isReadOnly(false);
        d.trace.isReadOnly(d.type() === "K");
        if (d.operations) {
            d.operations().canAdd(d.type() === "I");
        }
    }

    // Handler to load indented BOM
    function loadIndentedBom(pUseEoq) {
        if (loadingBom) {
            return;
        }

        let payload = {
            method: "POST",
            path: "/design/print-indented-bom",
            body: {
                itemId: model.id(),
                useEoq: Boolean(pUseEoq)
            }
        };

        function callback(resp) {
            iBoms.reset();
            resp.forEach(function (i) {
                let item = iBomMdl(i);
                item.state().goto("/Ready/Fetched/Clean");
                iBoms.add(item);
            });
            loadingBom = false;
        }

        loadingBom = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }

    // Handler to load indented where used
    function loadWhereUsed() {
        if (loadingWU) {
            return;
        }

        let payload = {
            method: "POST",
            path: "/design/print-indented-where-used",
            body: {itemId: model.id()}
        };

        function callback(resp) {
            wuBoms.reset();
            resp.forEach(function (i) {
                let item = wuBomMdl(i);
                item.state().goto("/Ready/Fetched/Clean");
                wuBoms.add(item);
            });
            loadingWU = false;
        }

        loadingWU = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }

    // Handler to load final product where used
    function loadFinalWhereUsed() {
        if (loadingFwu) {
            return;
        }

        let payload = {
            method: "POST",
            path: "/design/print-indented-where-used",
            body: {itemId: model.id(), flatten: true}
        };

        function callback(resp) {
            fwuList.reset();
            resp.forEach(function (i) {
                let item = fwuMdl(i);
                item.state().goto("/Ready/Fetched/Clean");
                fwuList.add(item);
            });
            loadingFwu = false;
        }

        loadingFwu = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }

    // Public indented BOM property
    model.addCalculated({
        format: "indentedBom",
        name: "indentedBom",
        function: function () {
            if (
                !iBomsInit &&
                model.state().current()[0].indexOf("/Ready/Fetched") !== -1
            ) {
                iBomsInit = true;
                loadIndentedBom();
            }

            return iBoms;
        },
        type: "object"
    });
    model.data.indentedBom.refresh = loadIndentedBom;

    // Public indented where used property
    model.addCalculated({
        format: "indentedWhereUsed",
        name: "indentedWhereUsed",
        function: function () {
            if (
                !wuBomsInit &&
                model.state().current()[0].indexOf("/Ready/Fetched") !== -1
            ) {
                wuBomsInit = true;
                loadWhereUsed();
            }

            return wuBoms;
        },
        type: "object"
    });
    model.data.indentedWhereUsed.refresh = loadWhereUsed;

    // Public final where used property
    model.addCalculated({
        format: "finalWhereUsed",
        name: "finalWhereUsed",
        function: function () {
            if (
                !fwuListInit &&
                model.state().current()[0].indexOf("/Ready/Fetched") !== -1
            ) {
                fwuListInit = true;
                loadFinalWhereUsed();
            }

            return fwuList;
        },
        type: "object"
    });
    model.data.indentedWhereUsed.refresh = loadFinalWhereUsed;

    model.onChanged("type", handleReadOnly);
    model.onChanged("type", function (p) {
        if (p() === "K") {
            d.trace("N");
        }
    });

    function getDefPlanPolicy() {
        let designSettings = catalog.store().models().designSettings();
        let src = d.source();

        if (src === "P") {
            return (
                designSettings.data.defaultPurchasePlanningPolicy()
                ? designSettings.data.defaultPurchasePlanningPolicy()
                : "P"
            );
        }
        return (
            designSettings.data.defaultManufacturePlanningPolicy()
            ? designSettings.data.defaultManufacturePlanningPolicy()
            : "M"
        );
    }

    model.onChanged("source", function () {
        let defplnpol = getDefPlanPolicy();

        d.sites().forEach(function (s) {
            s.data.planningPolicy(defplnpol);
        });
    });

    model.onChanged("sites", function () {
        d.sites().forEach(function (s) {
            if (!s.data.planningPolicy()) {
                s.data.planningPolicy(getDefPlanPolicy());
            }
        });
    });

    function renumber() {
        let nr = 0;

        d.billOfMaterialItems().forEach(function (item) {
            let seq = item.data.operation.toJSON();
            if (seq) {
                item.tmpOp = d.operations().find(function (op) {
                    return op.data.sequence() === seq;
                });
            }
        });
        d.operations().forEach(function (op) {
            nr += 1;
            op.data.sequence.state().send("silence");
            op.data.sequence(nr);
            op.data.sequence.state().send("report");
        });
        d.billOfMaterialItems().forEach(function (item) {
            if (item.tmpOp) {
                item.data.operation(item.tmpOp.data.sequence.toJSON());
                delete item.tmpOp;
            }
        });
    }

    if (d.operations) {
        model.onChanged("operations", renumber);
        model.onChanged("operations.sequence");
    }

    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let found;

        if (d.type() === "K" && d.billOfMaterialItems) {
            found = d.billOfMaterialItems().find(
                (i) => i.data.item().data.trace() !== "N"
            );
            if (found) {
                throw (
                    "Error on item " + found.data.item().data.number() +
                    ". Trace enabled items are not supported on kits"
                );
            }
        }
        if (d.operations && d.type() !== "I" && d.operations().filter(
            (o) => o.state().current()[0] !== "/Delete"
        ).length) {
            throw ("Expense and kit items do not support operations");
        }
    });

    return model;
}

product.calculated = f.prop({
    indentedBom: {
        type: "object",
        description: "Indented bill of material",
        format: "indentedBom"
    },
    indentedWhereUsed: {
        type: "object",
        description: "Indented where used list",
        format: "indentedWhereUsed"
    },
    finalWhereUsed: {
        type: "object",
        description: "Final product where used list",
        format: "finalWhereUsed"
    }
});

product.static = f.prop({
    checkPrintProductLabel: (sels) => sels.length === 1,
    printProductLabel: function (viewModel) {
        let dlg = viewModel.confirmDialog();
        let nrCopies = f.prop(1);
        let dlgCopiesId = f.createId();

        function onOk() {
            return f.datasource().request({
                method: "POST",
                path: "/design/print-product-label",
                body: {
                    id: viewModel.selection().id(),
                    copies: nrCopies()
                }
            }).then(
                printPdf
            ).catch(error);
        }

        dlg.content = function () {
            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: dlgCopiesId
                    }, "Copies:"),
                    m("input", {
                        id: dlgCopiesId,
                        onchange: (e) => nrCopies(e.target.value),
                        value: nrCopies(),
                        type: "number"
                    })
                ])
            ]);
        };

        dlg.title("Print Product Labels");
        dlg.icon("label");
        dlg.onOk(onOk);
        dlg.show();
    }
});


catalog.registerModel("Product", product);

const bomForm = {
    columns: [{
        attr: "product",
        width: 250
    }, {
        attr: "product.description",
        width: 250
    }, {
        attr: "quantityPer",
        width: 80
    }, {
        attr: "unit",
        width: 80
    }, {
        attr: "totalCost",
        label: "Cost",
        width: 100
    }, {
        attr: "materialCost",
        label: "Material",
        width: 100
    }, {
        attr: "laborCost",
        label: "Labor",
        width: 100
    }, {
        attr: "overheadCost",
        label: "Overhead",
        width: 100
    }, {
        attr: "serviceCost",
        label: "Service",
        width: 100
    }]
};

const indentedBom = {};
/**
    @class IndentedBom
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Array} options.models List of child models
*/
indentedBom.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id);
    vm.buttonRefresh = f.prop();
    vm.buttonCollapseAll = f.prop();
    vm.buttonExpandAll = f.prop();
    vm.buttonPrint = f.prop();
    vm.tableWidget = f.prop();
    async function print() {
        let models = vm.tableWidget().models().slice();
        let thebom = models.filter((mdl) => !mdl.hide());
        let thedata = {
            product: options.model.toJSON(),
            bom: thebom
        };
        let file = await f.datasource().request({
            body: {data: thedata},
            method: "POST",
            path: options.printForm || "/design/print-indented-bom-form"
        });

        printPdf(file);
    }
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: bomForm,
        models: options.prop(),
        feather: bomFeather
    }));
    vm.tableWidget().isQuery(false);
    vm.buttonRefresh(f.createViewModel("Button", {
        onclick: options.prop.refresh,
        icon: "sync",
        title: "Refresh",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));
    vm.buttonCollapseAll(f.createViewModel("Button", {
        onclick: vm.tableWidget().models().collapseAll,
        icon: "keyboard_double_arrow_up",
        title: "Collapse all",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));
    vm.buttonExpandAll(f.createViewModel("Button", {
        onclick: vm.tableWidget().models().expandAll,
        icon: "keyboard_double_arrow_down",
        title: "Expand all",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));
    vm.buttonPrint(f.createViewModel("Button", {
        onclick: print,
        icon: "print",
        title: "Print",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));

    return vm;
};

indentedBom.component = {
    oninit: function (vnode) {
        this.viewModel = indentedBom.viewModel(vnode.attrs);
    },

    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m(btn, {viewModel: vm.buttonRefresh()}),
            m(btn, {viewModel: vm.buttonCollapseAll()}),
            m(btn, {viewModel: vm.buttonExpandAll()}),
            m(btn, {viewModel: vm.buttonPrint()}),
            m(tw, {viewModel: vm.tableWidget()})
        ]);
    }
};

catalog.register(
    "components",
    "indentedBom",
    indentedBom.component
);

f.formats().indentedBom = {
    editor: function (obj) {
        return m(indentedBom.component, {
            id: obj.id,
            key: obj.key,
            prop: obj.prop,
            model: obj.model
        });
    }
};

const wuForm = {
    columns: [{
        attr: "product",
        width: 250
    }, {
        attr: "product.description",
        width: 250
    }, {
        attr: "quantityPer",
        width: 80
    }, {
        attr: "unit",
        width: 80
    }, {
        attr: "drawingLink",
        label: "Drawing",
        width: 200
    }]
};

const indentedWhereUsed = {};

/**
    @class IndentedWhereUsed
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Array} options.models List of child models
*/
indentedWhereUsed.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id);
    vm.buttonRefresh = f.prop();
    vm.buttonCollapseAll = f.prop();
    vm.buttonExpandAll = f.prop();
    vm.buttonPrint = f.prop();
    vm.tableWidget = f.prop();
    async function print() {
        let models = vm.tableWidget().models().slice();
        let thebom = models.filter((mdl) => !mdl.hide());
        let thedata = {
            product: options.model.toJSON(),
            bom: thebom
        };
        let file = await f.datasource().request({
            body: {data: thedata, title: "Indented Where Used"},
            method: "POST",
            path: options.printForm || "/design/print-indented-bom-form"
        });

        printPdf(file);
    }
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: wuForm,
        models: options.prop(),
        feather: wuFeather
    }));
    vm.tableWidget().isQuery(false);
    vm.buttonRefresh(f.createViewModel("Button", {
        onclick: options.prop.refresh,
        icon: "sync",
        title: "Refresh",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));
    vm.buttonCollapseAll(f.createViewModel("Button", {
        onclick: vm.tableWidget().models().collapseAll,
        icon: "keyboard_double_arrow_up",
        title: "Collapse all",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));
    vm.buttonExpandAll(f.createViewModel("Button", {
        onclick: vm.tableWidget().models().expandAll,
        icon: "keyboard_double_arrow_down",
        title: "Expand all",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));
    vm.buttonPrint(f.createViewModel("Button", {
        onclick: print,
        icon: "print",
        title: "Print",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));

    return vm;
};

indentedWhereUsed.component = {
    oninit: function (vnode) {
        this.viewModel = indentedWhereUsed.viewModel(vnode.attrs);
    },

    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m(btn, {viewModel: vm.buttonRefresh()}),
            m(btn, {viewModel: vm.buttonCollapseAll()}),
            m(btn, {viewModel: vm.buttonExpandAll()}),
            m(btn, {viewModel: vm.buttonPrint()}),
            m(tw, {viewModel: vm.tableWidget()})
        ]);
    }
};

catalog.register(
    "components",
    "indentedWhereUsed",
    indentedWhereUsed.component
);

f.formats().indentedWhereUsed = {
    editor: function (obj) {
        return m(indentedWhereUsed.component, {
            id: obj.id,
            key: obj.key,
            prop: obj.prop,
            model: obj.model
        });
    }
};

const fwuForm = {
    columns: [{
        attr: "product",
        width: 250
    }, {
        attr: "product.description",
        width: 250
    }, {
        attr: "unit",
        width: 80
    }, {
        attr: "drawingLink",
        label: "Drawing",
        width: 200
    }]
};

const finalWhereUsed = {};

/**
    @class IndentedWhereUsed
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Array} options.models List of child models
*/
finalWhereUsed.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id);
    vm.buttonRefresh = f.prop();
    vm.buttonPrint = f.prop();
    vm.tableWidget = f.prop();
    async function print() {
        let models = vm.tableWidget().models().slice();
        let thedata = {
            product: options.model.toJSON(),
            bom: models
        };
        let file = await f.datasource().request({
            body: {
                data: thedata,
                title: "Final Where Used",
                noQty: true
            },
            method: "POST",
            path: options.printForm || "/design/print-indented-bom-form"
        });

        printPdf(file);
    }
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: fwuForm,
        models: options.prop(),
        feather: fwuFeather
    }));
    vm.tableWidget().isQuery(false);
    vm.buttonRefresh(f.createViewModel("Button", {
        onclick: options.prop.refresh,
        icon: "sync",
        title: "Refresh",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));
    vm.buttonPrint(f.createViewModel("Button", {
        onclick: print,
        icon: "print",
        title: "Print",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));

    return vm;
};

finalWhereUsed.component = {
    oninit: function (vnode) {
        this.viewModel = finalWhereUsed.viewModel(vnode.attrs);
    },

    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m(btn, {viewModel: vm.buttonRefresh()}),
            m(btn, {viewModel: vm.buttonPrint()}),
            m(tw, {viewModel: vm.tableWidget()})
        ]);
    }
};

catalog.register("components", "finalWhereUsed", finalWhereUsed.component);

f.formats().finalWhereUsed = {
    editor: function (obj) {
        return m(finalWhereUsed.component, {
            id: obj.id,
            key: obj.key,
            prop: obj.prop,
            model: obj.model
        });
    }
};

function rollUpCosts(viewModel, id) {
    let dialog = viewModel.confirmDialog();
    let updateOpt = f.prop(false);
    let chkbox = f.getComponent("Checkbox");

    function onOk() {
        let payload = {
            method: "POST",
            path: "/design/roll-up-costs",
            body: {
                autoUpdate: updateOpt(),
                itemId: id,
                subscription: {
                    id: f.createId(),
                    eventKey: catalog.eventKey()
                }
            }
        };

        return f.datasource().request(
            payload
        ).then(viewModel.refresh).catch(error);
    }

    dialog.content = function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                }, "Preview first:"),
                m(chkbox, {
                    onclick: function (value) {
                        updateOpt(!value);
                    },
                    value: !updateOpt(),
                    title: "Preview proposed costs before updating"
                })
            ]),
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                }, "Update immediately:"),
                m(chkbox, {
                    onclick: function (value) {
                        updateOpt(value);
                    },
                    value: updateOpt(),
                    title: "Update items with new costs immediately"
                })
            ])
        ]);
    };

    dialog.title("Roll up costs");
    dialog.icon("summarize");
    dialog.onOk(onOk);
    dialog.show();
}

product.static().rollUpCosts = function (viewModel) {
    rollUpCosts(
        viewModel,
        viewModel.selections()[0].id()
    );
};

product.static().checkRollUpCosts = function (selections) {
    return (
        selections.length === 1 &&
        selections.some((s) => s.data.status() !== "I") &&
        (
            selections.some((s) => s.data.source() === "M") ||
            selections.some((s) => s.data.type() === "K")
        )
    );
};

/**
    Propose cost
*/
function propCost(data, feather) {
    feather = feather || catalog.getFeather("ProposedCost");
    let model = f.createModel(data, feather);
    let d = model.data;
    let icon;
    let deltas = ["material", "labor", "service", "overhead"];

    function calcStatus() {
        let style = "HIGH";
        let title = "Waiting for approval";
        let sts = d.status();

        if (sts === "U") {
            icon = "check_circle";
            title = "Item cost updated";
            style = "";
        } else if (sts === "A") {
            icon = "check_circle_outline";
            title = "Proposed cost approved";
        } else {
            icon = "radio_button_unchecked";
        }

        d.statusIcon.title(title);
        d.statusIcon.style(style);
    }

    function calcChange(attr1, attr2) {
        let cst = d[attr1 + "Cost"].toJSON();
        let chg = f.copy(cst);
        let itm = d.item();
        let pName = (
            typeof attr2 === "string"
            ? attr2
            : attr1 + "Cost"
        );

        if (itm) {
            chg.amount = cst.amount.minus(
                d.item().data[pName].toJSON().amount
            );
        } else {
            chg.amount = 0;
        }

        d[attr1 + "Change"].state().send("enable");
        d[attr1 + "Change"](chg);
    }

    model.addCalculated({
        isReadOnly: true,
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: () => icon
    });

    deltas.forEach(function (attr) {
        let theName = attr + "Change";
        model.addCalculated({
            isReadOnly: true,
            name: theName,
            type: "object",
            format: "money",
            function: f.prop(undefined, f.formats().money)
        });
        d[theName].alias(theName.toName());
    });

    model.addCalculated({
        isReadOnly: true,
        name: "totalChange",
        type: "object",
        format: "money",
        function: f.prop(undefined, f.formats().money)
    });
    d.totalChange.alias("Total Change");

    model.onChanged("status", calcStatus);
    model.onChanged("materialCost", calcChange.bind(null, "material"));
    model.onChanged("laborCost", calcChange.bind(null, "labor"));
    model.onChanged("serviceCost", calcChange.bind(null, "service"));
    model.onChanged("overheadCost", calcChange.bind(null, "overhead"));
    model.onChanged("totalCost", calcChange.bind(null, "total", "cost"));

    model.onLoad(function () {
        if (d.status() === "U") {
            model.isReadOnly(true);
            model.state().send("freeze");
        }
        calcStatus();
        deltas.forEach((a) => calcChange(a));
        calcChange("total", "cost");
    });

    return model;
}

propCost.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Proposed cost status indicator",
        format: "icon"
    },
    materialChange: {
        type: "object",
        format: "money",
        description: "Material cost change"
    },
    laborChange: {
        type: "object",
        format: "money",
        description: "Labor cost change"
    },
    serviceChange: {
        type: "object",
        format: "money",
        description: "Service cost change"
    },
    overheadChange: {
        type: "object",
        format: "money",
        description: "Overhead cost change"
    },
    totalChange: {
        type: "object",
        format: "money",
        description: "Total cost change"
    }
});

catalog.registerModel("ProposedCost", propCost);

function doRequest(viewModel, pPath, pIds) {
    f.datasource().request({
        method: "POST",
        path: pPath,
        body: {
            ids: pIds,
            subscription: {
                id: f.createId(),
                eventKey: catalog.eventKey()
            }
        }
    }).then(function (msg) {
        viewModel.refresh();
        success(viewModel.confirmDialog(), msg);
    }).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
}

propCost.static().rollUpAllCosts = (vm) => rollUpCosts(vm);

propCost.static().approve = function (viewModel) {
    doRequest(
        viewModel,
        "/design/approve-proposed-costs",
        viewModel.selections().map((s) => s.id())
    );
};

propCost.static().approveAll = function (viewModel) {
    doRequest(
        viewModel,
        "/design/approve-proposed-costs"
    );
};

propCost.static().checkApprove = function (selections) {
    return (
        selections.length &&
        selections.some((s) => s.data.status() === "P")
    );
};

propCost.static().update = function (viewModel) {
    doRequest(
        viewModel,
        "/design/update-proposed-costs",
        viewModel.selections().map((s) => s.id())
    );
};

propCost.static().updateAll = function (viewModel) {
    doRequest(
        viewModel,
        "/design/update-proposed-costs"
    );
};

propCost.static().checkUpdate = function (selections) {
    return (
        selections.length &&
        selections.some((s) => s.data.status() === "A")
    );
};

/**
    Service
*/
function svc(data, feather) {
    feather = feather || catalog.getFeather("Service");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleSites() {
        d.sites().forEach(function (s) {
            if (!s.data.planningPolicy()) {
                s.data.planningPolicy("L");
            }
            s.data.planningPolicy.isReadOnly(true);
            s.data.safetyStock.isReadOnly(true);
            s.data.abcClass.isReadOnly(true);
            s.data.reorderPoint.isReadOnly(true);
        });
    }

    if (d.sites) {
        model.onChanged("sites", handleSites);
        model.onLoad(handleSites);
    }

    model.onValidate(function () {
        if (d.type() !== "E") {
            throw (
                "Service items must be type 'Expense'"
            );
        }
        if (d.source() !== "P") {
            throw (
                "Service items must be source 'Purchase'"
            );
        }
    });

    return model;
}

catalog.registerModel("Service", svc);