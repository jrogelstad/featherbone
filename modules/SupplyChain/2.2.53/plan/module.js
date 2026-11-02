/*jslint browser devel this unordered*/

const console = window.console;
const catalog = f.catalog();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const demand = catalog.store().models().demand;
const supply = catalog.store().models().supply;
const salesOrderLine = catalog.store().models().salesOrderLine;
const inventory = catalog.store().models().inventory;
const buildSolGantt = catalog.register("functions").buildSalesOrderLineGantt;

// Helper function for demand and supply child records
function findForm(p) {
    if (!p()) {
        return;
    }
    let forms = catalog.store().data().forms();
    let form = forms.find(function (frm) {
        // If the default form is not a child form, use that
        // Otherwise find another active form
        return (
            frm.feather === p().data.objectType() &&
            (
                (
                    frm.isActive &&
                    frm.isDefault &&
                    frm.name.toLowerCase().indexOf("child") ===
                    -1
                ) ||
                (
                    frm.isActive &&
                    !frm.isDefault &&
                    frm.name.toLowerCase().indexOf("child") ===
                    -1
                )
            )
        );
    });

    return form || {};
}

/**
    Allocation
*/
function allc(data, feather) {
    feather = feather || catalog.getFeather("Allocation");
    let model = f.createModel(data, feather);
    let d = model.data;
    let dmdFlt = {
        sort: [{property: "number"}],
        criteria: [{
            property: "status",
            operator: "!=",
            value: "C"
        }, {
            property: "quantityDue",
            operator: ">",
            value: "0"
        }]
    };
    let supFlt = {
        sort: [{property: "number"}],
        criteria: [{
            property: "status",
            operator: "!=",
            value: "C"
        }, {
            property: "quantity",
            operator: ">",
            value: "0"
        }, {
            property: "objectType",
            operator: "!~*",
            value: "Purchase"
        }]
    };

    model.onChanged("demand", function () {
        let flt = f.copy(supFlt);
        let dmd = d.demand();
        if (dmd && dmd.data.item()) {
            flt.criteria.push({
                property: "item.id",
                value: dmd.data.item().id()
            });
        }
        d.supply.filter(flt);
    });

    d.demand.filter(dmdFlt);
    d.supply.filter(supFlt);

    model.onLoad(function () {
        d.demand.isReadOnly(true);
        d.supply.isReadOnly(true);
    });
    d.demand.form = findForm.bind(null, d.demand);
    d.supply.form = findForm.bind(null, d.supply);

    return model;
}

catalog.registerModel("Allocation", allc);

allc.static().clearAllocations = function (viewModel) {
    f.datasource().request({
        method: "POST",
        path: "/plan/clear-allocations"
    }).then(viewModel.refresh).catch(
        error
    );
};

allc.static().createAllocations = function (viewModel) {
    let dlg = viewModel.confirmDialog();
    let chkbox = f.getComponent("Checkbox");
    let clear = f.prop(false);
    let payload = {
        method: "POST",
        path: "/plan/create-allocations",
        body: {
            subscription: {
                id: f.createId(),
                eventKey: catalog.eventKey()
            }
        }
    };

    function onOk() {
        payload.body = {
            clear: clear(),
            subscription: {
                id: f.createId(),
                eventKey: catalog.eventKey()
            }
        };
        f.datasource().request(payload).then(
            viewModel.refresh
        ).catch(
            error
        );
    }
    dlg.content = function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", "Clear existing:"),
                m(chkbox, {
                    onclick: function (value) {
                        clear(value);
                    },
                    value: clear()
                })
            ])
        ]);
    };

    dlg.title("Create allocations");
    dlg.icon("queue");
    dlg.onOk(onOk);
    dlg.show();
};

demand.static().planSupply = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let requests = viewModel.selections().filter(
        (sel) => sel.data.quantityDue.toJSON() > sel.data.allocated.toJSON()
    ).map(function (sel) {
        return f.datasource().request({
            method: "POST",
            path: "/plan/plan-supply/",
            body: {demandId: sel.id()}
        });
    });

    Promise.all(requests).then(function (resp) {
        viewModel.refresh();
        success(dialog, resp);
    }).catch(
        error.bind(null, dialog)
    );
};

demand.static().checkPlanSupply = function (selections) {
    return selections.some(
        (sel) => sel.data.quantityDue.toJSON() > sel.data.allocated.toJSON()
    );
};

demand.static().checkViewPlan = function (selections) {
    return (
        selections.length === 1 &&
        selections[0].data.item &&
        selections[0].data.item() &&
        selections[0].data.item().data.type() === "I"
    );
};

demand.static().viewPlan = function (viewModel) {
    let sup = (
        viewModel.tableWidget
        ? viewModel.tableWidget().selection()
        : viewModel.selection()
    );
    let payload = {
        method: "POST",
        path: "/data/inventories",
        body: {
            filter: {
                criteria: [{
                    property: "item.id",
                    value: sup.data.item().id()
                }, {
                    property: "site.id",
                    value: sup.data.site().id()
                }]
            },
            properties: ["id"]
        }
    };

    f.datasource().request(payload).then(function (resp) {
        if (!resp.length) {
            error("Inventory record not found");
            return;
        }
        m.route.set("/edit/:feather/:key", {
            feather: "Inventory",
            key: resp[0].id
        }, {state: {}});
    }).catch(
        error
    );
};

supply.static().checkViewPlan = demand.static().checkViewPlan;
supply.static().viewPlan = demand.static().viewPlan;

// This is like what table widget normally does except it opens
// a specific form that is not the default "child" form if a child
// form exists
let tdata = function (obj) {
    let rel;
    let keys;
    let type = "";
    let theProp = obj.prop;
    let theValue = obj.value;
    let theVm = obj.viewModel;
    let url;
    let theForm = (
        theProp.form
        ? theProp.form().id
        : {}
    );

    // If relation, use feather natural key to
    // find value to display
    rel = f.catalog().getFeather("Demand");
    keys = Object.keys(rel.properties);
    rel = (
        keys.find((key) => rel.properties[key].isNaturalKey) ||
        keys.find((key) => rel.properties[key].isLabelKey)
    );

    if (rel) {
        theValue = theProp().data[rel]();
        type = theProp().data.objectType().toSnakeCase();

        url = (
            window.location.protocol + "//" +
            window.location.hostname + ":" +
            window.location.port +
            window.location.pathname +
            "#!/edit/" +
            type +
            "/" + theProp().id()
        );

        return m("a", {
            href: url,
            onclick: function (e) {
                theVm.canToggle(false);
                e.preventDefault();
                m.route.set("/edit/:feather/:key", {
                    feather: type,
                    key: theProp().id()
                }, {
                    state: {form: theForm}
                });
            }
        }, theValue);
    }
};

f.types.demand = {tableData: tdata};
f.types.supply = {tableData: tdata};

/* Start of inventory */
const invPlanFeather = {
    description: "Inventory order plan",
    isSystem: true,
    plural: "InventoryPlans",
    properties: {
        id: {
            description: "Unique id",
            type: "string",
            default: "createId()"
        },
        demand: {
            description: "Demand order",
            type: {
                relation: "Demand",
                properties: ["id", "number", "objectType"]
            }
        },
        supply: {
            description: "Supply order or inventory",
            type: {
                relation: "Supply",
                properties: ["id", "number", "objectType"]
            }
        },
        quantity: {
            description: "Order quantity",
            type: "number"
        },
        available: {
            description: "running availability",
            type: "number",
            alias: "Running Total"
        },
        dueDate: {
            description: "Order due date",
            type: "string",
            format: "date"
        }
    }
};

catalog.store().feathers().InventoryPlan = invPlanFeather;

catalog.registerModel("InventoryPlan", function (data, feather) {
    feather = feather || catalog.getFeather("InventoryPlan");
    let model = f.createModel(data, feather);
    let d = model.data;

    d.demand.form = findForm.bind(null, d.demand);
    d.supply.form = findForm.bind(null, d.supply);

    return model;
});

/**
    Inventory Model
*/
function inv(data, feather) {
    let model = inventory(data, feather);
    let d = model.data;
    let loadingAllocs = false;
    let allocInit = false;
    let allocs = f.createList("Allocation", {fetch: false});
    let allocation = f.catalog().store().models().allocation;
    let loadingPlan = false;
    let planInit = false;
    let plans = f.createList("InventoryPlan", {fetch: false});
    let inventoryPlan = f.catalog().store().models().inventoryPlan;

    async function loadPlan() {
        if (loadingPlan) {
            return;
        }

        let resp = await f.datasource().request({
            method: "POST",
            path: "/plan/get-inventory-plan",
            body: {id: model.id()}
        });


        plans.reset();
        resp.forEach(function (i) {
            let item = inventoryPlan(i);
            item.state().goto("/Ready/Fetched/Clean");
            plans.add(item);
        });

        loadingPlan = false;
    }

    // Handler to load allocations
    async function loadAllocations() {
        if (loadingAllocs) {
            return;
        }

        let payload = {
            method: "POST",
            path: "/data/allocations",
            body: {
                properties: [
                    "id",
                    "demand",
                    "supply",
                    "quantity",
                    "salesOrder"
                ],
                filter: {criteria: [{
                    property: "supply.item.id",
                    value: d.item().id()
                }, {
                    property: "supply.site.id",
                    value: d.site().id()
                }]}
            }
        };

        loadingAllocs = true;

        let resp = await f.datasource().request(payload);

        allocs.reset();
        resp.forEach(function (i) {
            let item = allocation(i);
            item.state().goto("/Ready/Fetched/Clean");
            allocs.add(item);
        });
        allocs.sort(function (a, b) {
            let asupdat = a.data.supply().data;
            let bsupdat = b.data.supply().data;
            let admddat = a.data.demand().data;
            let bdmddat = b.data.demand().data;

            if (!asupdat.dueDate() && bsupdat.dueDate()) {
                return -1;
            }
            if (asupdat.dueDate() && !bsupdat.dueDate()) {
                return 1;
            }
            if (asupdat.dueDate() > bsupdat.dueDate()) {
                return 1;
            }
            if (asupdat.dueDate() < bsupdat.dueDate()) {
                return -1;
            }
            if (asupdat.number > bsupdat.number) {
                return 1;
            }
            if (asupdat.number < bsupdat.number) {
                return -1;
            }
            if (admddat.dueDate() > bdmddat.dueDate()) {
                return 1;
            }
            if (admddat.dueDate() < bdmddat.dueDate()) {
                return -1;
            }
            if (admddat.number() > bdmddat.number()) {
                return 1;
            }
            if (admddat.number() < bdmddat.number()) {
                return -1;
            }
            return -1;
        });
        loadingAllocs = false;
    }

    // Public plan property
    model.addCalculated({
        format: "inventoryPlan",
        name: "plan",
        function: function () {
            if (
                !planInit &&
                d.item && d.item() &&
                d.site && d.site()
            ) {
                planInit = true;
                loadPlan();
            }

            return plans;
        },
        type: "object"
    });
    model.data.plan.refresh = loadPlan;

    // Public allocations property
    model.addCalculated({
        format: "inventoryAllocations",
        name: "allocations",
        function: function () {
            if (
                !allocInit &&
                d.item && d.item() &&
                d.site && d.site()
            ) {
                allocInit = true;
                loadAllocations();
            }

            return allocs;
        },
        type: "object"
    });
    model.data.allocations.refresh = function () {
        loadAllocations();
        loadPlan();
    };

    function handleStyles() {
        if (d.quantity.toJSON() < 0) {
            model.style("HIGH");
        } else if (d.projected.toJSON() < 0) {
            model.style("WARNING");
        } else {
            model.style("");
        }
    }

    model.onLoad(handleStyles);

    return model;
}

inv.calculated = f.prop({
    plan: {
        type: "object",
        description: "Running availability",
        format: "inventoryPlan"
    },
    allocations: {
        type: "object",
        description: "Allocations on inventory item site",
        format: "inventoryAllocations"
    }
});

catalog.registerModel("Inventory", inv);

/*  Inventory plan widget */
const invPlanForm = {
    columns: [{
        attr: "supply",
        width: 250
    }, {
        attr: "demand"
    }, {
        attr: "dueDate"
    }, {
        attr: "quantity"
    }, {
        attr: "available"
    }]
};

const invPlan = {};
/**
    @class InventoryPlan
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Array} options.models List of child models
*/
invPlan.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id);
    vm.buttonRefresh = f.prop();
    vm.tableWidget = f.prop();
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: invPlanForm,
        models: options.prop(),
        feather: "InventoryPlan",
        height: "250px"
    }));
    vm.tableWidget().isQuery(false);

    return vm;
};

invPlan.component = {
    oninit: function (vnode) {
        this.viewModel = invPlan.viewModel(vnode.attrs);
    },

    view: function () {
        let vm = this.viewModel;
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m(tw, {viewModel: vm.tableWidget()})
        ]);
    }
};

catalog.register(
    "components",
    "inventoryPlan",
    invPlan.component
);

f.formats().inventoryPlan = {
    editor: function (obj) {
        return m(invPlan.component, {
            id: obj.id,
            key: obj.key,
            prop: obj.prop,
            model: obj.model
        });
    }
};

/*  Inventory allocations widget */
const invAllocationsForm = {
    columns: [{
        attr: "supply",
        width: 250
    }, {
        attr: "supply.dueDate"
    }, {
        attr: "demand"
    }, {
        attr: "demand.dueDate"
    }, {
        attr: "quantity"
    }, {
        attr: "salesOrder"
    }]
};

const invAllocations = {};
/**
    @class InventoryAllocations
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Array} options.models List of child models
*/
invAllocations.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id);
    vm.buttonRefresh = f.prop();
    vm.tableWidget = f.prop();
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: invAllocationsForm,
        models: options.prop(),
        feather: "Allocation",
        height: "250px"
    }));
    vm.tableWidget().isQuery(false);
    vm.buttonRefresh(f.createViewModel("Button", {
        onclick: options.prop.refresh,
        icon: "sync",
        title: "Refresh",
        class: "fb-icon-button",
        style: {backgroundColor: "white"}
    }));

    return vm;
};

invAllocations.component = {
    oninit: function (vnode) {
        this.viewModel = invAllocations.viewModel(vnode.attrs);
    },

    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m("div", [
                m("label", "Allocations:"),
                m(btn, {viewModel: vm.buttonRefresh()})
            ]),
            m(tw, {viewModel: vm.tableWidget()})
        ]);
    }
};

catalog.register(
    "components",
    "inventoryAllocations",
    invAllocations.component
);

f.formats().inventoryAllocations = {
    editor: function (obj) {
        return m(invAllocations.component, {
            id: obj.id,
            key: obj.key,
            prop: obj.prop,
            model: obj.model
        });
    }
};

inv.static().checkCreateWorkOrder = (s) => s.length === 1;

function calcQty(proj, is) {
    let qty = proj.minus(is.reorderPoint).times(-1);

    if (is.orderIncrement) {
        qty = Math.ceil(qty.div(is.orderIncrement)).times(is.orderIncrement);
    }
    if (is.maximumOrderQuantity) {
        qty = Math.min(qty, is.maximumOrderQuantity);
    }
    return qty;
}


inv.static().createWorkOrder = function (viewModel) {
    let wo = catalog.store().models().workOrder();
    let iv = viewModel.selection();
    let instances = catalog.register("instances");
    let is = iv.data.itemSite().toJSON();
    let ord = calcQty(iv.data.projected.toJSON(), is);

    wo.data.item(iv.data.item.toJSON());
    wo.data.site(iv.data.site.toJSON());
    wo.data.ordered(ord);

    let end = f.parseDate(wo.data.startDate());
    end.setDate(end.getDate().plus(is.leadTime));
    end = end.toLocalDate();
    wo.data.dueDate(end);

    instances[wo.id()] = wo;
    // Launch work order page
    m.route.set("/edit/:feather/:key", {
        feather: "WorkOrder",
        key: wo.id()
    }, {state: {create: false}});
};

inv.static().checkCreatePlannedOrder = (s) => s.length === 1;
inv.static().createPlannedOrder = function (viewModel) {
    let iv = viewModel.selection();
    let typ = (
        iv.data.item().data.source() === "M"
        ? "PlannedWorkOrder"
        : "PlannedPurchase"
    );
    let po = catalog.store().models()[typ.toCamelCase()]();
    let instances = catalog.register("instances");
    let is = iv.data.itemSite().toJSON();
    let qty = calcQty(iv.data.projected.toJSON(), is);

    po.data.item(iv.data.item.toJSON());
    po.data.site(iv.data.site.toJSON());
    po.data.quantity(qty);

    let end = f.parseDate(po.data.startDate());
    end.setDate(end.getDate().plus(is.leadTime));
    end = end.toLocalDate();
    po.data.dueDate(qty);

    instances[po.id()] = po;
    // Launch planned order page
    m.route.set("/edit/:feather/:key", {
        feather: typ,
        key: po.id()
    }, {state: {create: false}});
};

/**
    Planned order
*/
function plannedOrd(data, feather) {
    feather = feather || catalog.getFeather("PlannedOrder");
    let model = f.createModel(data, feather);
    let d = model.data;

    d.quantity.isReadOnly(false);
    d.dueDate.isReadOnly(false);
    model.onLoad(function () {
        d.item.isReadOnly(true);
        d.site.isReadOnly(true);
    });
    return model;
}

catalog.registerModel("PlannedOrder", plannedOrd);

// Suppliment sales order line
salesOrderLine.static().checkCalculateDueDate = function (selections) {
    return (
        selections.length === 1 &&
        selections[0].data.status() !== "C" &&
        selections[0].data.ordered.toJSON() > 0 &&
        selections[0].data.item &&
        selections[0].data.item() &&
        (
            selections[0].data.item().data.type() === "I" ||
            selections[0].data.item().data.type() === "K"
        ) &&
        selections[0].data.site()
    );
};

salesOrderLine.static().calculateDueDate = function (viewModel) {
    let dlg = viewModel.parentViewModel().parentViewModel().confirmDialog();
    let wd = viewModel.parentViewModel().parentViewModel().waitDialog();
    let gantt = f.getComponent("Gantt");
    let vm = catalog.register("viewModels").gantt();
    let theChart = f.prop({data: []});
    let theDate = f.prop();
    let dmd = viewModel.tableWidget().selection();
    let payloads = [];
    let qtyDue;

    if (dmd.data.item().data.type() === "I") {
        qtyDue = (
            dmd.data.ordered.toJSON().minus(
                dmd.data.shipped.toJSON()
            )
        );
        payloads.push(f.datasource().request({
            method: "POST",
            path: "/plan/calculate-due-date",
            body: {
                allocateParent: true,
                demandId: dmd.id(),
                itemId: dmd.data.item().id(),
                requestedDate: dmd.parent().data.requestedDate(),
                siteId: dmd.data.site().id(),
                quantity: qtyDue
            }
        }));
    } else {
        dmd.data.materials().forEach(function (mtl) {
            qtyDue = (
                mtl.data.required.toJSON().minus(
                    mtl.data.issued.toJSON()
                )
            );
            payloads.push(f.datasource().request({
                method: "POST",
                path: "/plan/calculate-due-date",
                body: {
                    allocateParent: true,
                    demandId: mtl.id(),
                    itemId: mtl.data.item().id(),
                    requestedDate: dmd.parent().data.requestedDate(),
                    siteId: mtl.data.site().id(),
                    quantity: qtyDue
                }
            }));
        });
    }
    let did = f.createId();

    function onOk() {
        dmd.data.promiseDate(theDate());
    }

    dlg.content = function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [

            m("div", {
                id: "date" + did,
                class: "pure-control-group"
            }, [
                m("label", {
                    for: did
                }, "Due Date"),
                m("input", {
                    id: did,
                    type: "Date",
                    value: theDate(),
                    onchange: (e) => theDate(e.target.value)
                }),
                m("div", {
                    id: "gantt" + did,
                    class: "pure-control-group",
                    style: {
                        overflow: "scroll",
                        maxHeight: "385px",
                        minHeight: "385px",
                        paddingTop: "18px"
                    }
                }, [
                    m(gantt, {
                        parentProperty: "chart",
                        parentViewModel: {
                            model: function () {
                                return {data: {chart: theChart}};
                            }
                        },
                        viewModel: vm
                    })
                ])
            ])
        ]);
    };

    dlg.title("Calculate Due Date");
    dlg.style({
        width: "1000px",
        height: "575px"
    });
    dlg.icon("event");
    dlg.onOk(onOk);
    dlg.buttonOk().label("Use as Promise Date");
    wd.show();

    Promise.all(payloads).then(function (resp) {
        let ret = {dueDate: f.startOfTime(), plan: []};
        resp.forEach(function (item) {
            if (item.dueDate > ret.dueDate) {
                ret.dueDate = item.dueDate;
            }
            ret.plan = ret.plan.concat(item.plan);
        });

        theDate(ret.dueDate);
        let plan = f.createList("GanttTimeline", {
            fetch: false,
            indentOn: "level"
        });
        ret.plan.forEach(function (i) {
            let item = f.createModel("GanttTimeline", i);
            item.state().goto("/Ready/Fetched/Clean");
            plan.add(item);
        });

        theChart(buildSolGantt(plan, false));

        dlg.show();
        //console.log(JSON.stringify(resp, null, 2));
    }).catch(error).finally(wd.cancel);
};
