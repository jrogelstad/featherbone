/*jslint devel browser this unordered*/
/*global*/
const catalog = f.catalog();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const mixinItemConversion = catalog.register("mixins").mixinItemConversion;
const salesOrderLine = catalog.store().models().salesOrderLine;
const buildGantt = catalog.register("functions").buildWorkOrderGantt;
const printPdf = catalog.register("functions").printPdf;
// Job Shop is optional; without it, the standard edition.
const jsSettings = catalog.store().models().jobShopSettings;
const edition = (jsSettings && jsSettings().data.edition()) || "Standard";

function checkCreateWorkOrder(sels) {
    return (
        sels.length === 1 &&
        sels[0].data.quantityDue.toJSON() > sels[0].data.allocated.toJSON() &&
        !sels[0].data.salesOrder().data.onHold()
    );
}

function createWorkOrder(type, viewModel) {
    let wo = catalog.store().models().workOrder();
    let sol = viewModel.selection();
    let instances = catalog.register("instances");
    let ord = sol.data.quantityDue.toJSON().minus(sol.data.allocated.toJSON());
    let alloc = catalog.store().models().allocation();
    let so = (
        type === "SalesOrderLine"
        ? sol.data.salesOrder.toJSON()
        : sol.data.salesOrderLine().data.salesOrder.toJSON()
    );

    wo.data.salesOrder(so);
    wo.data.item(sol.data.item.toJSON());
    wo.data.site(sol.data.site.toJSON());
    wo.data.ordered(ord);

    let end = f.parseDate(sol.data.dueDate());
    wo.data.dueDate(end);
    wo.state().resolve("/Busy/Saving/Posting").exit(function () {
        alloc.data.demand({id: sol.id()});
        alloc.data.supply({id: wo.id()});
        alloc.data.quantity(Math.min(ord, wo.data.ordered()));
        alloc.save();
    });

    instances[wo.id()] = wo;
    // Launch work order page
    m.route.set("/edit/:feather/:key", {
        feather: "WorkOrder",
        key: wo.id()
    }, {state: {create: false}});
}

salesOrderLine.static().checkCreateWorkOrder = checkCreateWorkOrder;
salesOrderLine.static().createWorkOrder = createWorkOrder.bind(
    null,
    "SalesOrderLine"
);

/**
    Operation completion model
*/
function opCompl(data, feather) {
    feather = feather || catalog.getFeather("OperationCompletion");
    let model = f.createModel(data, feather);
    let d = model.data;

    // Default buyer to current user if applicable
    let emp = catalog.store().data().employees().find(
        (b) => b.data.userAccount() === f.currentUser().name
    );
    if (emp) {
        model.data.employee(emp);
    }

    function handleStatus() {
        if (d.isPosted()) {
            d.statusIcon.title("Posted");
            d.statusIcon.style("ALT-EMPHASIS");
        } else if (
            d.error() ||
            (
                d.operation() &&
                d.operation().data.onHold()
            )
        ) {
            d.statusIcon.title(d.error() || "Order is on hold");
            d.statusIcon.style("HIGH");
        } else {
            d.statusIcon.title("Not posted");
            d.statusIcon.style("ALT-EMPHASIS");
        }
    }
    model.onChanged("error", handleStatus);
    model.onChanged("isPosted", handleStatus);
    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (d.error()) {
                return "error";
            }
            if (d.isPosted()) {
                return "check_circle";
            }
            return "radio_button_unchecked";
        }
    });
    model.onLoad(handleStatus);
    model.onLoad(function () {
        if (d.isPosted()) {
            model.isReadOnly(true);
            model.state().send("freeze");
        }
    });

    model.onValidate(function () {
        if (d.quantity() <= 0) {
            throw "Quantity must be greater than zero";
        }
        if (
            !d.isPosted() &&
            d.operation() &&
            d.operation().data.onHold()
        ) {
            throw "Work order is on hold";
        }
    });

    d.employee.filter().criteria.push({
        property: "isActive",
        value: true
    });
    d.operation.filter().criteria.push({
        property: "status",
        operator: "IN",
        value: ["A", "I"]
    });

    return model;
}

opCompl.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("OperationCompletion", opCompl);

opCompl.static().post = function (viewModel) {
    let ocId = viewModel.selections()[0].id();
    let payload = {
        method: "POST",
        path: "/make/post-operation-completion",
        body: {id: ocId}
    };

    f.datasource().request(payload).catch(error);
};

opCompl.static().checkPost = function (selections) {
    return (
        selections.length === 1 &&
        !selections[0].data.isPosted()
    );
};

/**
    Planned work order
*/
function plannedWo(data, feather) {
    feather = feather || catalog.getFeather("PlannedWorkOrder");
    let model = f.createModel(data, feather);
    let d = model.data;
    let itemSites = f.createList("ItemSite", {fetch: false});
    d.quantity.isReadOnly(false);

    function getItemSite() {
        if (d.item() && d.site()) {
            return itemSites.find(function (s) {
                return s.data.site().id() === d.site().id();
            });
        }
    }

    function defaultQty() {
        let is = getItemSite(model);
        let end;

        if (is) {
            d.quantity(
                Math.max(
                    d.quantity.toJSON(),
                    is.data.minimumOrderQuantity.toJSON()
                )
            );
            // Add leadtime to planned orders
            end = f.parseDate(d.startDate());
            end.setDate(end.getDate().plus(is.data.leadTime.toJSON()));
            end = end.toLocalDate();
            d.dueDate(end);
        }
    }

    function loadSites(upd) {
        if (!d.item()) {
            itemSites.reset();
            return;
        }

        function callback(resp) {
            if (!resp) {
                itemSites.reset();
                return;
            }
            resp.forEach(function (data) {
                let mdl = f.createModel("ItemSite", data);
                itemSites.add(mdl);
                if (upd !== false && data.isPrimary) {
                    d.site(data.site);
                }
            });
            if (upd !== false) {
                defaultQty();
            }
        }

        f.datasource().request({
            method: "POST",
            path: "/design/get-item-sites",
            body: {id: d.item().id()}
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.onChanged("item", loadSites);
    model.onChanged("site", defaultQty);
    model.onValidate(function () {
        let is = getItemSite(model);
        let ord = d.quantity.toJSON();
        let min;
        let max;
        let inc;

        if (is && d.status() === "P") {
            min = is.data.minimumOrderQuantity.toJSON();
            max = is.data.maximumOrderQuantity.toJSON();
            inc = is.data.orderIncrement.toJSON();
            if (ord < min) {
                throw ("Minimum order quantity is " + min);
            }
            if (max && ord > max) {
                throw ("Maximum order quantity is " + max);
            }
            if (inc && ord.div(inc) !== Math.ceil(ord.div(inc))) {
                throw ("Order must be multiple of " + inc);
            }
        }
    });
    model.onLoad(loadSites.bind(null, false));

    return model;
}

catalog.registerModel("PlannedWorkOrder", plannedWo);

plannedWo.static({
    checkConvert: function (selections) {
        return selections.length;
    },
    convert: function (viewModel) {
        let dialog = viewModel.confirmDialog();
        let payload = {
            method: "POST",
            path: "/make/convert-planned-work-orders",
            body: {ids: viewModel.selections().map((s) => s.id())}
        };

        f.datasource().request(payload).then(function (resp) {
            viewModel.refresh();
            success(dialog, resp);
        }).catch(
            error.bind(null, dialog)
        );
    }
});

/* Create internal feather for rendering bom */
const iwoFeather = Object.freeze({
    name: "IndentedWorkOrder",
    plural: "IndentedWorkOrders",
    description: "Indented work order",
    isSystem: true,
    properties: {
        actualLaborCost: {
            description: "Actual labor cost",
            type: "object",
            format: "money"
        },
        actualMaterialCost: {
            description: "Actual material cost",
            type: "object",
            format: "money"
        },
        actualOverheadCost: {
            description: "Actual overhead cost",
            type: "object",
            format: "money"
        },
        actualServiceCost: {
            description: "Actual service cost",
            type: "object",
            format: "money"
        },
        actualTotalCost: {
            description: "Actual total cost",
            type: "object",
            format: "money"
        },
        allocated: {
            description: "Quantity allocated",
            type: "number"
        },
        created: {
            description: "Create time",
            type: "string",
            formate: "dateTime"
        },
        createdBy: {
            description: "Created by user",
            type: "string"
        },
        description: {
            description: "description",
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
        dueDate: {
            description: "Due date of work order or material",
            type: "string",
            format: "date"
        },
        estimatedLaborCost: {
            description: "Estimated labor cost",
            type: "object",
            format: "money"
        },
        estimatedMaterialCost: {
            description: "Estimated material cost",
            type: "object",
            format: "money"
        },
        estimatedOverheadCost: {
            description: "Estimated overhead cost",
            type: "object",
            format: "money"
        },
        estimatedServiceCost: {
            description: "Estimated service cost",
            type: "object",
            format: "money"
        },
        estimatedTotalCost: {
            description: "Estimated total cost",
            type: "object",
            format: "money"
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
                    "status",
                    "unit"
                ]
            }
        },
        quantity: {
            description: "Quantity ordered or required",
            type: "number"
        },
        isDeleted: {
            description: "Is deleted",
            type: "boolean"
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
        number: {
            description: "Work order number",
            type: {
                "properties": [
                    "id",
                    "number"
                ],
                relation: "WorkOrder"
            }
        },
        objectType: {
            description: "Object type",
            type: "string"
        },
        remaining: {
            description: "Quantity remaining to be received or issued",
            type: "number"
        },
        sequence: {
            alias: "Seq. #",
            description: "Sequence",
            type: "integer"
        },
        site: {
            description: "Production site",
            type: {
                "properties": [
                    "code",
                    "description"
                ],
                relation: "Site"
            }
        },
        status: {
            description: "Status",
            type: "string",
            dataList: [{
                label: "P",
                value: "Pending"
            }, {
                label: "A",
                value: "Active"
            }, {
                label: "I",
                value: "In process"
            }, {
                label: "C",
                value: "Closed"
            }]
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

catalog.register("feathers", "IndentedWorkOrder", iwoFeather);

/**
    Indented work order  model
*/
function iwoModel(data, feather) {
    feather = feather || catalog.getFeather("IndentedWorkOrder");
    let model = f.createModel(data, feather);
    let icon = "factory";

    model.onLoad(function () {
        switch (model.data.objectType()) {
        case "WorkOrderOperation":
            model.style("EMPHASIS");
            icon = "build";
            model.data.typeIcon.title("Operation");
            break;
        case "WorkOrderRequirement":
            model.style("ALT-EMPHASIS");
            icon = "inventory_2";
            model.data.typeIcon.title("Material Requirement");
            break;
        default:
            model.style("BOLD");
        }
    });

    model.addCalculated({
        name: "typeIcon",
        type: "string",
        format: "icon",
        function: () => icon,
        title: "Work Order"
    });

    return model;
}

catalog.registerModel("IndentedWorkOrder", iwoModel);

/**
    Work order model
*/
const one = 1;
const MS_HR = one.times(60).times(60).times(1000);

function workOrder(data, feather) {
    feather = feather || catalog.getFeather("WorkOrder");
    let model = f.createModel(data, feather);
    let d = model.data;
    let loadingWo = false;
    let iWo = false;
    let loadingPlan = false;
    let plan = false;
    let itemSites = f.createList("ItemSite", {fetch: false});
    let showOps = f.prop(false);
    let showStock = f.prop(false);
    let ordChanged = false;
    let explodeOnSave = false;

    function renumber(attr1, attr2) {
        let nr = 0;

        d[attr1]().forEach(function (i) {
            nr += 1;
            i.data[attr2].state().send("silence");
            i.data[attr2](nr);
            i.data[attr2].state().send("report");
        });
    }

    function renumberMatls() {
        renumber("materials", "sequence");
    }

    function renumberOps() {
        d.materials().forEach(function (item) {
            let seq = item.data.operation.toJSON();
            if (seq) {
                item.tmpOp = d.operations().find(function (op) {
                    return op.data.sequence() === seq;
                });
            }
        });
        renumber("operations", "sequence");
        d.materials().forEach(function (item) {
            if (item.tmpOp) {
                item.data.operation(item.tmpOp.data.sequence.toJSON());
                delete item.tmpOp;
            }
        });
        d.operations().forEach(function (op) {
            if (!op.data.number()) {
                op.data.number(d.number() + "#" + op.data.sequence());
            }
        });
    }

    function getItemSite() {
        if (d.item() && d.site()) {
            return itemSites.find(function (s) {
                return s.data.site().id() === d.site().id();
            });
        }
    }
    function defaultQty() {
        let is = getItemSite();

        if (is) {
            d.ordered(Math.max(
                d.ordered.toJSON(),
                is.data.minimumOrderQuantity.toJSON()
            ));
        }
    }

    function handleMovable() {
        if (d.materials) {
            d.materials().canMove(
                d.materials().every((l) => (
                    l &&
                    !l.data.allocated.toJSON() &&
                    !l.data.issued.toJSON()
                ))
            );
        }
        if (d.operations) {
            d.operations().canMove(
                d.operations().every((op) => (
                    op &&
                    !op.data.started.toJSON() &&
                    !op.data.completed.toJSON()
                ))
            );
        }
    }

    function handleReadOnly() {
        let sch = d.scheduleMethod();
        let status = d.status();
        let ops = (
            d.operations
            ? d.operations()
            : []
        );

        d.startDate.isReadOnly(sch === "B");
        d.dueDate.isReadOnly(sch === "F");
        d.ordered.isReadOnly(
            status !== "P" &&
            status !== "A" &&
            status !== "U"
        );
        ops.forEach(function (op) {
            op.data.service.isReadOnly(
                op.data.started.toJSON() ||
                op.data.completed.toJSON()
            );
        });
    }

    function findPlanItem(id) {
        if (plan) {
            return plan.find((i) => i.id() === id);
        }
        return false;
    }

    function leadTime() {
        let is;

        if (d.item() && d.site()) {
            is = getItemSite();
            if (is) {
                return is.data.leadTime();
            }
        }

        return 0;
    }

    function calcTimeline(ops) {
        // Schedule operations forward
        let sd = f.parseDate(d.startDate());
        let opdata;
        let opdur;
        let opprvst;
        let opprvet;
        let opprvdur = 0;
        let opprv;
        let prvtfrdur;
        let tfrdur;
        let curst = new Date(sd);
        let n = 0;
        let lt = 0;
        let ret = {};
        let curr;

        while (n < ops.length) {
            opdata = ops[n].data;
            curr = {};
            ret[opdata.id()] = curr;

            if (ops[n].state().current()[0] !== "/Delete") {
                opdur = opdata.leadTime.toJSON().times(MS_HR);
                curr.opoldst = new Date(opdata.plannedStartTime());
                curr.opoldet = new Date(opdata.plannedEndTime());
                tfrdur = 0;
                prvtfrdur = 0;

                // Default situation
                curr.opnewst = new Date(curst);
                curr.opnewet = new Date(curr.opnewst.getTime().plus(opdur));

                // Handle transfer offset for next op
                if (opprv) {
                    if (
                        (
                            opprv.transferBatchPolicy() === "Q" &&
                            opprv.planned.toJSON() >
                            opprv.transferBatchValue.toJSON()
                        ) ||
                        opprv.transferBatchPolicy() === "P"
                    ) {
                        // Setup time
                        prvtfrdur = opprv.queueTime.toJSON().plus(
                            opprv.setupTime.toJSON()
                        ).plus(
                            opprv.waitTime.toJSON()
                        ).plus(
                            opprv.moveTime.toJSON()
                        ).times(MS_HR);

                        if (opprv.transferBatchPolicy() === "Q") {
                            // Prev. run time for partial qty
                            prvtfrdur = prvtfrdur.plus(
                                opprv.runTime.toJSON().times(MS_HR).div(
                                    opprv.planned.toJSON()
                                ).times(
                                    opprv.transferBatchValue.toJSON()
                                )
                            );
                            // Current run time for partial qty
                            tfrdur = opdata.runTime.toJSON().times(MS_HR).div(
                                opdata.planned.toJSON()
                            ).times(
                                opprv.transferBatchValue.toJSON()
                            );
                        } else if (opprv.transferBatchPolicy() === "P") {
                            // Run time for partial qty
                            prvtfrdur = prvtfrdur.plus(
                                opprv.runTime.toJSON().times(MS_HR).times(
                                    opprv.transferBatchValue.toJSON().times(
                                        0.01
                                    )
                                )
                            );
                            // Current run time for partial qty
                            tfrdur = opdata.runTime.toJSON().times(MS_HR).times(
                                opprv.transferBatchValue.toJSON().times(0.01)
                            );
                        }
                        curr.opnewst = new Date(
                            opprvst.getTime().plus(prvtfrdur)
                        );
                        if (opprvdur > opdur) {
                            curr.opnewet = new Date(
                                opprvet.getTime().plus(
                                    tfrdur
                                ).plus(
                                    opdata.queueTime.toJSON().plus(
                                        opdata.waitTime.toJSON()
                                    ).plus(
                                        opdata.moveTime.toJSON()
                                    ).times(MS_HR)
                                )
                            );
                        } else {
                            curr.opnewet = new Date(
                                curr.opnewst.getTime().plus(opdur)
                            );
                        }
                    }
                    if (tfrdur) {
                        tfrdur = tfrdur.div(MS_HR);
                    }
                    lt = lt.plus(
                        curr.opnewet.getTime().minus(
                            opprvet.getTime()
                        ).div(MS_HR).div(24)
                    );
                } else {
                    lt = lt.plus(opdata.leadTime.toJSON().div(24));
                }
                curst = new Date(curr.opnewet);
                opprvst = curr.opnewst;
                opprvet = curr.opnewet;
                opprvdur = opdur;
                opprv = opdata;
            }
            n += 1;
        }
        ret.leadTime = lt;
        return ret;
    }

    function calcSched() {
        let sd = f.parseDate(d.startDate());
        let found;
        let ops = d.operations();
        let osps = [];
        let timeline = calcTimeline(ops);
        let dd;
        let delta = 0;

        if (d.scheduleMethod() === "B") {
            dd = f.parseDate(d.dueDate());
            let oldsd = sd;
            sd = new Date(dd);
            sd.setDate(sd.getDate().minus(
                Math.max(
                    Math.ceil(timeline.leadTime),
                    leadTime()
                ).minus(one)
            ));
            delta = sd.valueOf().minus(oldsd.valueOf());
        } else {
            dd = new Date(sd);
            dd.setDate(dd.getDate().plus(
                Math.max(timeline.leadTime, leadTime())
            ));
        }
        d.startDate(sd);
        d.dueDate(dd);

        if (
            d.scheduleMethod() === "B"
        ) {
            // Shift everything to ALAP
            if (timeline.leadTime < leadTime()) {
                delta = leadTime().minus(
                    timeline.leadTime
                ).minus(one).times(24).times(MS_HR).plus(delta);
            }

            Object.keys(timeline).forEach(function (id) {
                if (typeof timeline[id] === "object") {
                    timeline[id].opnewst.setMilliseconds(
                        timeline[id].opnewst.getMilliseconds().plus(delta)
                    );

                    timeline[id].opnewet.setMilliseconds(
                        timeline[id].opnewet.getMilliseconds().plus(delta)
                    );
                }
            });
        }

        ops.forEach(function (op) {
            let curr = timeline[op.id()];
            let del = true;

            if (op.state().current()[0] !== "/Delete") {
                // Compare dates because date time format problems
                // too dicey to address now
                del = false;
                if (curr.opoldst.valueOf() !== curr.opnewst.valueOf()) {
                    op.data.plannedStartTime(
                        curr.opnewst.toLocalDateTime()
                    );
                }
                if (curr.opoldet.valueOf() !== curr.opnewet.valueOf()) {
                    op.data.plannedEndTime(curr.opnewet.toLocalDateTime());
                }
            }
            found = findPlanItem(op.id());
            if (found) {
                if (del) {
                    osps = plan.slice().filter(function (i) {
                        let lnks = i.data.links();
                        return lnks.some(function (lnk) {
                            return (
                                lnk.target === found.id() &&
                                lnk.type === "FF"
                            );
                        });
                    });
                    plan.splice(plan.indexOf(found), 1);
                    osps.forEach(function (osp) {
                        plan.splice(plan.indexOf(osp), 1);
                    });
                } else {
                    found.set({
                        dueDate: curr.opnewet.toLocalDate(),
                        startDate: curr.opnewst.toLocalDate()
                    }, true);
                }
            }
        });

        // Update gantt
        found = findPlanItem(model.id());
        if (found) {
            found.data.startDate(d.startDate());
            found.data.dueDate(d.dueDate());
        }
    }

    function addCost(prv, nxt) {
        if (nxt.state().current()[0] !== "/Delete") {
            return prv.plus(nxt.data[this].toJSON().amount);
        }
        return 0;
    }

    function calcEstCost() {
        let curr = d.estimatedTotalCost().currency;
        let estmtl = {
            amount: d.materials().reduce(
                addCost.bind("estimatedCost"),
                0
            ),
            currency: curr
        };
        let estlbr = {
            amount: d.operations().reduce(
                addCost.bind("estimatedLaborCost"),
                0
            ),
            currency: curr
        };
        let estovh = {
            amount: d.operations().reduce(
                addCost.bind("estimatedOverheadCost"),
                0
            ),
            currency: curr
        };
        let estsvc = {
            amount: d.operations().reduce(
                addCost.bind("estimatedServiceCost"),
                0
            ),
            currency: curr
        };

        d.estimatedMaterialCost(estmtl);
        d.estimatedLaborCost(estlbr);
        d.estimatedOverheadCost(estovh);
        d.estimatedServiceCost(estsvc);
        d.estimatedTotalCost({
            amount: estmtl.amount.plus(
                estlbr.amount
            ).plus(
                estovh.amount
            ).plus(
                estsvc.amount
            ),
            currency: curr
        });
    }

    model.onChanged("operations", calcEstCost);
    model.onChanged("operations.estimatedServiceCost", calcEstCost);
    model.onChanged("operations.leadTime", calcSched);
    model.onChanged("operations.transferBatchValue", calcSched);
    model.onChanged("operations.transferBatchPolicy", calcSched);

    function calcPlannedQty() {
        if (
            !d.operations ||
            !d.item() ||
            !d.item().data.isFractional
        ) {
            return;
        }
        let ops = d.operations().filter(
            (o) => o.state().current()[0] !== "/Delete"
        );
        let n = ops.length - 1;
        let op;
        let qty = d.quantity.toJSON();
        const isFrct = d.item().data.isFractional();

        while (n >= 0) {
            op = ops[n];
            op.data.planned(qty);
            qty = qty.div(op.data.yield.toJSON().times(0.01));
            if (!isFrct) {
                qty = Math.ceil(qty);
            }
            n -= 1;
        }
        calcSched();
    }
    model.onChanged("quantity", calcPlannedQty);
    model.onChanged("operations", calcPlannedQty);
    model.onChanged("operations.yield", calcPlannedQty);

    function loadProduct() {
        if (!d.item()) {
            return;
        }

        function callback(resp) {
            if (!resp) {
                return;
            }

            if (resp) {
                d.drawingLink(resp.drawingLink);
                d.documents(resp.documents);
            }
        }

        f.datasource().request({
            method: "POST",
            path: "/make/get-product-documents",
            body: {id: d.item().id()}
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    function loadSites(upd) {
        if (!d.item()) {
            itemSites.reset();
            return;
        }

        function callback(resp) {
            if (!resp) {
                itemSites.reset();
                return;
            }
            resp.forEach(function (data) {
                let mdl = f.createModel("ItemSite", data);
                itemSites.add(mdl);
                if (upd !== false && data.isPrimary) {
                    d.site(data.site);
                }
            });
            if (upd !== false) {
                defaultQty();
            }
        }

        f.datasource().request({
            method: "POST",
            path: "/design/get-item-sites",
            body: {id: d.item().id()}
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    // Handler to load indented BOM
    function loadIndentedWo() {
        if (loadingWo || model.state().current()[0] === "/Ready/New") {
            return;
        }

        let payload = {
            method: "POST",
            path: "/make/print-indented-work-order",
            body: {
                id: model.id(),
                showOperations: showOps(),
                showStockItems: showStock()
            }
        };

        function callback(resp) {
            iWo.reset();
            resp.forEach(function (i) {
                let item = f.createModel("IndentedWorkOrder", i);
                item.state().goto("/Ready/Fetched/Clean");
                iWo.add(item);
            });
            loadingWo = false;
        }

        loadingWo = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }
    // Public indented WO property
    model.addCalculated({
        format: "indentedWorkOrder",
        name: "indentedWorkOrder",
        function: function () {
            if (!iWo) {
                iWo = f.createList("IndentedWorkOrder", {
                    fetch: false,
                    indentOn: "level"
                });
                loadIndentedWo();
            }

            return iWo;
        },
        type: "object"
    });

    // Handler to load gantt chart plan
    function loadPlan() {
        if (loadingPlan || model.state().current()[0] === "/Ready/New") {
            return;
        }

        let payload = {
            method: "POST",
            path: "/make/get-work-order-plan",
            body: {
                id: model.id(),
                showOperations: edition !== "Basic",
                showStockItems: false
            }
        };

        function callback(resp) {
            plan.reset();
            resp.forEach(function (i) {
                let item = f.createModel("GanttTimeline", i);
                item.state().goto("/Ready/Fetched/Clean");
                plan.add(item);
            });
            loadingPlan = false;
        }

        loadingPlan = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }
    model.addCalculated({
        name: "timeline",
        type: "object",
        format: "gantt",
        function: function () {
            if (!plan) {
                plan = f.createList("GanttTimeline", {
                    fetch: false,
                    indentOn: "level"
                });
                loadPlan();
            }

            return buildGantt(plan);
        }
    });
    model.data.timeline.refresh = loadPlan;

    model.data.indentedWorkOrder.refresh = loadIndentedWo;
    model.data.indentedWorkOrder.showOperations = showOps;
    model.data.indentedWorkOrder.showStockItems = showStock;

    showOps.state().resolve("/Changing").exit(loadIndentedWo);
    showStock.state().resolve("/Changing").exit(loadIndentedWo);

    if (d.materials) {
        model.onChanged("materials", renumberMatls);
        model.onChanged("materials.sequence", renumberMatls);
        d.materials().canAdd(false);
        model.onValidate(function () {
            let ops;

            function hasValidOp(matl) {
                if (
                    matl.state().current()[0] !== "/Delete" &&
                    matl.data.operation() > 0
                ) {
                    return ops.some(
                        (o) => o.data.sequence() === matl.data.operation()
                    );
                }

                return true;
            }

            ops = d.operations();
            if (!d.materials().every(hasValidOp)) {
                throw "Material references operation not on router";
            }

            if (d.ordered() <= 0) {
                throw "Quantity must be greater than zero";
            }
        });
    }

    model.onChanged("operations", renumberOps);
    model.onChanged("operations.sequence", renumberOps);
    if (d.operations) {
        d.operations().canAdd(false); // Only after first save
    }

    model.onChanged("item", function () {
        let item = d.item();

        if (!item) {
            return;
        }

        loadProduct();
        loadSites();
    });
    model.onChanged("item", defaultQty);
    model.onChanged("item", calcSched);
    model.onChanged("site", defaultQty);
    model.onChanged("site", calcSched);
    model.onChanged("scheduleMethod", handleReadOnly);
    model.onChanged("scheduleMethod", calcSched);
    model.onChanged("startDate", calcSched);
    model.onChanged("dueDate", calcSched);

    model.onLoad(function () {
        ordChanged = false;

        if (d.materials) {
            d.materials().canAdd(true);
        }

        if (d.operations) {
            d.operations().canAdd(true);
        }

        d.item.isReadOnly(true);
        d.site.isReadOnly(true);
        if (d.drawingLink) {
            d.drawingLink.isReadOnly(false);
        }
        d.instructions.isReadOnly(false);
        handleReadOnly();
        handleMovable();
        if (d.status() === "C") {
            model.state().send("freeze");
        } else {
            handleStatus();
            loadSites(false);
        }
        if (plan) {
            loadPlan(); // reload
        }
    });

    model.onCopy(function () {
        d.status("P");
        d.isPrinted(false);
        d.printTime(null);
        d.printedBy("");
        d.actualMaterialCost(f.money(0));
        d.actualLaborCost(f.money(0));
        d.actualServiceCost(f.money(0));
        d.actualOverheadCost(f.money(0));
        d.actualTotalCost(f.money(0));
        d.closeDate(null);
        d.materials().forEach(function (mt) {
            mt.data.status("P");
            mt.data.issued(0);
            mt.data.quantityDue(mt.data.required());
        });
        d.operations().forEach(function (op) {
            op.data.status("P");
            op.data.completed(0);
            op.data.remaining(op.data.planned());
            op.data.actualLaborCost(f.money(0));
            op.data.actualServiceCost(f.money(0));
            op.data.actualOverheadCost(f.money(0));
        });
        d.comments().clear();
    });

    model.onChanged("ordered", function () {
        if (
            (
                model.data.status() === "P" ||
                model.data.status() === "U"
            ) &&
            (
                model.state().current()[0] === "/Ready/Fetched/Dirty" ||
                model.state().current()[0] === "/Ready/Fetched/Locking"
            )
        ) {
            ordChanged = true;
        }
    });

    model.onSave(function (vm) {
        if (!vm) {
            return Promise.resolve();
        }

        return new Promise(function (resolve) {
            let dlg = vm.confirmDialog();

            if (ordChanged) {
                ordChanged = false;
                dlg.message(
                    "Order quantity on work order " + d.number() +
                    " has changed." +
                    "Do you want to re-explode this work order after saving?"
                );
                dlg.title("Quantity changed");
                dlg.onOk(function () {
                    explodeOnSave = true;
                    resolve();
                });
                dlg.onCancel(resolve);
                dlg.icon("help");
                dlg.buttonOk().label("Yes, please");
                dlg.buttonCancel().label("No thanks");
                dlg.show();
                return;
            }
            resolve();
        });
    });

    model.onSaved(function () {
        if (explodeOnSave) {
            explodeOnSave = false;

            f.datasource().request({
                method: "POST",
                path: "/make/explode-work-order",
                body: {ids: [model.id()]}
            }).then(function () {
                if (iWo) {
                    loadIndentedWo();
                }
            }).catch(error);
        }
        return Promise.resolve();
    });

    handleReadOnly();

    d.item.filter().criteria.push({
        property: "status",
        value: "A"
    }, {
        property: "objectType",
        value: "Product"
    }, {
        property: "source",
        value: "M"
    });

    model.onCanDelete(function () {
        return (
            d.status() === "P" ||
            d.status() === "U"
        );
    });

    function getTitle() {
        switch (d.status()) {
        case "U":
            return "Unexploded";
        case "P":
            return "Pending";
        case "A":
            return "Active";
        case "I":
            return "In Process";
        case "C":
            return "Closed";
        }
    }
    function handleStatus() {
        if (d.error() || d.onHold()) {
            d.statusIcon.title(d.error() || "Work order is on hold");
            d.statusIcon.style("HIGH");
        } else {
            d.statusIcon.title(getTitle());
            d.statusIcon.style("");
        }
    }
    model.onChanged("error", handleStatus);
    model.onChanged("status", handleStatus);

    model.addCalculated({
        name: "planStatusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.planStatus()) {
            case "U":
                return "rule";
            case "P":
            case "O":
                return "checklist_rtl";
            default:
                return "inventory_2";
            }
        }
    });

    d.planStatusIcon.style = function () {
        switch (d.planStatus()) {
        case "U":
            return "HIGH";
        case "P":
            return "WARNING";
        case "O":
            return "EMPHASIS";
        case "I":
            return "ALT-EMPHASIS";
        case "C":
            return "DISABLED";
        }
    };

    d.planStatusIcon.title = function () {
        let dl = d.planStatus.dataList;
        let found = dl.find((i) => i.value === d.planStatus());
        return found.label;
    };

    model.addCalculated({
        name: "scheduleStatusIcon",
        type: "string",
        format: "icon",
        function: function () {
            let dd = d.dueDate.toJSON();
            let oed = (
                d.operationEndDate()
                ? d.operationEndDate.toJSON()
                : dd
            );
            let today = f.today();

            if (
                dd < today ||
                dd < oed
            ) {
                return "today";
            }
            return "event_available";
        }
    });

    d.scheduleStatusIcon.style = function () {
        let dd = d.dueDate.toJSON();
        let oed = (
            d.operationEndDate()
            ? d.operationEndDate.toJSON()
            : dd
        );
        let today = f.today();

        if (dd < today) {
            return "HIGH";
        }

        if (dd === today || dd < oed) {
            return "WARNING";
        }

        return "ALT-EMPHASIS";
    };

    d.scheduleStatusIcon.title = function () {
        let dd = d.dueDate.toJSON();
        let oed = (
            d.operationEndDate()
            ? d.operationEndDate.toJSON()
            : dd
        );
        let today = f.today();

        if (dd < today) {
            return "Work order is late";
        }

        if (dd < oed) {
            return "Last scheduled operation is later than work order due date";
        }

        if (dd === today) {
            return "Work order is due today";
        }

        return "Schedule is okay";
    };

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (d.error()) {
                return "error";
            }

            if (d.onHold()) {
                return "front_hand";
            }

            switch (d.status()) {
            case "U":
                return "radio_button_unchecked";
            case "P":
                return "pending";
            case "A":
                return "start";
            case "I":
                return "double_arrow";
            case "C":
                return "done";
            }
        }
    });

    model.addCalculated({
        name: "shipToName",
        type: "string",
        function: function () {
            if (
                d.salesOrder() &&
                d.salesOrder().data.shipTo()
            ) {
                return d.salesOrder().data.shipTo().data.name();
            }
            return "";
        },
        isReadOnly: true
    });

    model.onValidate(function () {
        let is = getItemSite();
        let ord = d.ordered.toJSON();
        let min;
        let max;
        let inc;

        if (is && (d.status() === "P" || d.status() === "U")) {
            min = is.data.minimumOrderQuantity.toJSON();
            max = is.data.maximumOrderQuantity.toJSON();
            inc = is.data.orderIncrement.toJSON();
            if (ord < min) {
                throw ("Minimum order quantity is " + min);
            }
            if (max && ord > max) {
                throw ("Maximum order quantity is " + max);
            }
            if (inc && ord.div(inc) !== Math.ceil(ord.div(inc))) {
                throw ("Order must be multiple of " + inc);
            }
        }
    });

    return model;
}

workOrder.calculated = f.prop({
    indentedWorkOrder: {
        type: "object",
        description: "Indented work order",
        format: "indentedWorkOrder"
    },
    planStatusIcon: {
        type: "string",
        description: "Planning state of material requirements"
    },
    scheduleStatusIcon: {
        type: "string",
        description: "Work order due date information"
    },
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    },
    timeline: {
        type: "object",
        description: "Supply chain timeline in gantt chart",
        format: "gantt"
    },
    shipToName: {
        type: "string",
        description: "Sales order ship to name"
    }
});

catalog.registerModel("WorkOrder", workOrder);

const iwoForm = {
    columns: [{
        attr: "number",
        width: 300
    }, {
        attr: "typeIcon",
        label: "...",
        width: 30
    }, {
        attr: "product",
        width: 200
    }, {
        attr: "description",
        width: 250
    }, {
        attr: "quantity",
        width: 80
    }, {
        attr: "product.unit",
        width: 50
    }, {
        attr: "remaining",
        label: "Remain",
        width: 80
    }, {
        attr: "allocated",
        width: 80
    }, {
        attr: "dueDate",
        width: 80
    }, {
        attr: "drawingLink",
        label: "Drawing"
    }, {
        attr: "status"
    }]
};

const indentedWo = {};

/**
    @class IndentedWorkOrder
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Array} options.models List of child models
*/
indentedWo.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id);
    vm.buttonRefresh = f.prop();
    vm.buttonCollapseAll = f.prop();
    vm.buttonExpandAll = f.prop();
    vm.tableWidget = f.prop();
    vm.showOperations = options.prop.showOperations;
    vm.showStockItems = options.prop.showStockItems;
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: iwoForm,
        models: options.prop(),
        feather: iwoFeather
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

    return vm;
};

indentedWo.component = {
    oninit: function (vnode) {
        this.viewModel = indentedWo.viewModel(vnode.attrs);
    },

    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");
        let cb = f.getComponent("Checkbox");

        return m("div", [
            m(btn, {viewModel: vm.buttonRefresh()}),
            m(btn, {viewModel: vm.buttonCollapseAll()}),
            m(btn, {viewModel: vm.buttonExpandAll()}),
            m("label", "Show operations:"),
            m(cb, {
                onclick: function () {
                    vm.showOperations(!vm.showOperations());
                },
                title: "Show operations",
                value: vm.showOperations()
            }),
            m("label", "Show stock items:"),
            m(cb, {
                onclick: function () {
                    vm.showStockItems(!vm.showStockItems());
                },
                title: "Show stock Items",
                value: vm.showStockItems()
            }),
            m(tw, {viewModel: vm.tableWidget()})
        ]);
    }
};

f.formats().indentedWorkOrder = {
    editor: function (obj) {
        return m(indentedWo.component, {
            id: obj.id,
            key: obj.key,
            prop: obj.prop
        });
    }
};

workOrder.static({
    checkActive: function (selections) {
        return selections.some(
            (model) => (
                model.data.status() === "A" ||
                model.data.status() === "I"
            ) && !model.data.lock() &&
            !model.canSave() &&
            !model.data.onHold()
        );
    },
    checkNotClosed: function (selections) {
        return selections.some(
            (model) => model.data.status() !== "C" &&
            !model.canSave() &&
            !model.data.lock() &&
            !model.data.onHold()
        );
    },
    checkPending: function (selections) {
        return selections.some(
            (model) => (
                model.data.status() === "P" &&
                !model.canSave() &&
                !model.data.lock() &&
                !model.data.onHold()
            )
        );
    },
    checkCanComplete: function (selections) {
        return (
            selections.length &&
            selections.every(function (sel) {
                return (
                    sel.data.status() !== "C" &&
                    sel.data.status() !== "P" &&
                    !sel.canSave() &&
                    !sel.data.lock() &&
                    !sel.data.onHold() &&
                    sel.data.ordered.toJSON() < sel.data.received.toJSON()
                );
            })
        );
    },
    checkCanExplode: function (selections) {
        return selections.some(
            (model) => (
                (model.data.status() === "P" || model.data.status() === "U") &&
                !model.canSave() &&
                !model.data.lock() &&
                !model.data.onHold()
            )
        );
    },
    checkCanUnrelease: function (selections) {
        return selections.some(
            (model) => (model.data.status() === "A") &&
            !model.data.lock() &&
            !model.canSave() &&
            !model.data.onHold()
        );
    },
    checkPlanSupply: function (selections) {
        return (
            selections.length &&
            selections.every(function (sel) {
                return (
                    sel.data.status !== "C" &&
                    sel.data.status !== "P" &&
                    !sel.canSave() &&
                    !sel.data.lock() &&
                    !sel.data.onHold()
                );
            })
        );
    },
    close: function (viewModel) {
        let dialog = viewModel.confirmDialog();
        let ary = viewModel.selections().filter(
            (s) => (s.data.status() !== "C")
        ).map((s) => s.id());
        let wo = (
            ary.length > 1
            ? "Work Orders"
            : "Work Order"
        );
        let msg = "Are you sure you want to close the selected " + wo + "? ";
        let emph = (
            "NO quantities will be received into inventory and this action " +
            "cannot be undone."
        );

        dialog.onOk(function () {
            f.datasource().request({
                method: "POST",
                path: "/make/close-work-order",
                body: {ids: ary}
            }).then(success).catch(error);
        });
        dialog.title("Close " + wo);
        dialog.icon("help");
        dialog.content = function () {
            return m("div", [
                m("a", msg),
                m("br"),
                m("br"),
                m("b", {style: {color: "red"}}, emph)
            ]);
        };
        dialog.show();
    },
    complete: function (viewModel) {
        let dialog = viewModel.confirmDialog();
        let ary = viewModel.selections().filter(
            (s) => (
                (s.data.status() === "A" || s.data.status() === "I") &&
                !s.data.lock() &&
                !s.data.onHold()
            )
        ).map((s) => s.id());
        let wo = (
            ary.length > 1
            ? "Work Orders"
            : "Work Order"
        );
        let msg = "Are you sure you want to complete the selected " + wo + "? ";
        let emph = (
            "ALL remaining quantities will be received into inventory " +
            "and the " + wo + " will be closed."
        );
        let wor = (
            ary.length > 1
            ? "Receipts have "
            : "Receipt has "
        );
        let wor2 = (
            ary.length > 1
            ? "are"
            : "is"
        );
        let conf = (
            "Work order " + wor +
            " been created and " + wor2 + " posting."
        );

        dialog.onOk(function () {
            f.datasource().request({
                method: "POST",
                path: "/make/complete-work-order",
                body: {ids: ary}
            }).then(success.bind(null, conf)).catch(error);
        });
        dialog.title("Complete " + wo);
        dialog.icon("help");
        dialog.content = function () {
            return m("div", [
                m("a", msg),
                m("br"),
                m("br"),
                m("b", {style: {color: "red"}}, emph)
            ]);
        };
        dialog.show();
    },
    unrelease: function (viewModel) {
        viewModel.selections().forEach(
            function (model) {
                if (
                    model.data.status() === "A" &&
                    !model.data.lock() &&
                    !model.data.onHold()
                ) {
                    model.data.status("P");
                    model.save();
                }
            }
        );
    },
    explode: function (viewModel) {
        let dialog = viewModel.confirmDialog();
        let ary = viewModel.selections().filter(
            (s) => (
                (s.data.status() === "P" || s.data.status() === "U") &&
                !s.data.lock() &&
                !s.data.onHold()
            )
        ).map((s) => s.id());
        let payload = {
            method: "POST",
            path: "/make/explode-work-order",
            body: {ids: ary}
        };

        f.datasource().request(payload).then(function (resp) {
            success(dialog, resp);
        }).catch(
            error.bind(null, dialog)
        );
    },
    planSupply: async function (viewModel) {
        let dialog = viewModel.confirmDialog();
        let payload;
        let i = 0;
        let sel;
        try {
            while (i < viewModel.selections().length) {
                sel = viewModel.selections()[i];
                payload = {
                    method: "POST",
                    path: "/make/plan-work-order-supply",
                    body: {id: sel.id()}
                };
                await f.datasource().request(payload);
                i += 1;
            }
            success(dialog, "Work order(s) planned");
        } catch (e) {
            error(dialog, e);
        }
    },
    checkReceive: function (selections) {
        return (
            selections.length === 1 &&
            selections.every(
                (s) => (
                    !s.data.lock() &&
                    !s.data.onHold() &&
                    s.isReadyClean() &&
                    (
                        s.data.status() === "A" ||
                        s.data.status() === "I"
                    )
                )
            )
        );
    },
    receive: function (viewModel) {
        let instances = catalog.register("instances");
        let recv = catalog.store().models().workOrderReceipt();
        let wo = viewModel.selection();

        recv.data.workOrder({
            id: wo.id(),
            number: wo.data.number(),
            status: wo.data.status(),
            site: wo.data.site(),
            item: wo.data.item()
        });

        // Register so next page knows about it
        instances[recv.id()] = recv;
        // Launch shipment page
        m.route.set("/edit/:feather/:key", {
            feather: "WorkOrderReceipt",
            key: recv.id()
        }, {
            state: {create: false}
        });
    }
});

function doPrint(models, dialog) {
    return new Promise(function (resolve, reject) {
        let makeSettings = catalog.store().models().makeSettings();
        let form = makeSettings.data.traveler();
        let payload;

        if (!form) {
            error(dialog, {message: (
                "Form name for traveler " +
                "must be defined in settings."
            )});
            return;
        }

        payload = {
            method: "POST",
            path: "/make/print-traveller",
            body: {
                ids: models.map((i) => i.id()),
                form: form.data.name()
            }
        };

        function updatePrintStatus() {
            let requests = [];
            models.forEach(function (model) {
                model.data.isPrinted(true);
                model.data.printTime(new Date());
                model.data.printedBy(f.currentUser().name);
                requests.push(model.save());
            });
            Promise.all(requests).then(resolve).catch(reject);
        }

        function confirm() {
            dialog.message("Did the traveler(s) print correctly?");
            dialog.title("Confirm print");
            dialog.icon("help_outline");
            dialog.onOk(updatePrintStatus);
            dialog.onCancel(reject);
            dialog.buttonOk().label("Yes");
            dialog.buttonCancel().label("No");
            dialog.show();
        }

        function doPrintPdf(resp) {
            printPdf({
                file: resp,
                onPrintDialogClose: confirm
            });
        }

        f.datasource().request(payload).then(doPrintPdf).catch(reject);
    });
}

workOrder.static().release = function (viewModel) {
    let models = viewModel.selections().filter(function (model) {
        if (model.data.status() === "P" && !model.data.lock()) {
            return model;
        }
    });

    function print() {
        return new Promise(function (resolve, reject) {
            if (catalog.store().models().makeSettings().data.printOnRelease()) {
                doPrint(
                    models,
                    viewModel.confirmDialog()
                ).then(resolve).catch(function (e) {
                    console.log(e);
                    reject({message: (
                        "Release cancelled due to incomplete print"
                    )});
                });
                return;
            }

            resolve();
        });
    }

    function release() {
        return new Promise(function (resolve, reject) {
            let requests = [];
            models.forEach(function (model) {
                model.data.status("A");
                requests.push(model.save());
            });
            Promise.all(requests).then(resolve).catch(reject);
        });
    }

    print().then(
        release
    ).catch(
        error.bind(null, viewModel.confirmDialog())
    );
};

workOrder.static().print = async function (viewModel) {
    try {
        await doPrint(
            viewModel.selections().filter(
                (i) => i.data.status() !== "C" && !i.data.lock()
            ),
            viewModel.confirmDialog()
        );
    } catch (ignore) {
        // Do nothing
    }
};

workOrder.static().checkPrint = function (selections) {
    return selections.some(function (model) {
        return (
            model.data.status() !== "C" &&
            !model.data.lock() &&
            !model.canSave() &&
            !model.data.onHold()
        );
    });
};

workOrder.static().checkAllow = function (selections) {
    return selections.length === 1 && selections.some(function (model) {
        return (
            !model.canSave() &&
            model.data.onHold() &&
            !model.data.lock()
        );
    });
};

workOrder.static().checkHold = function (selections) {
    return selections.length === 1 && selections.some(function (model) {
        return (
            !model.canSave() &&
            !model.data.onHold() &&
            !model.data.lock()
        );
    });
};

function doHold(isHold, viewModel) {
    let dialog = viewModel.confirmDialog();
    let isRecursive = f.prop(false);
    let chkbox = f.getComponent("Checkbox");
    let title;
    let icon;

    if (isHold) {
        title = "Put order on hold";
        icon = "front_hand";
    } else {
        title = "Take order off hold";
        icon = "waving_hand";
    }

    function onOk() {
        f.datasource().request({
            method: "POST",
            path: "/make/hold",
            body: {
                workOrderId: viewModel.selections()[0].id(),
                hold: isHold,
                recursive: isRecursive()
            }
        }).then(success.bind(null, dialog)).catch(error.bind(null, dialog));
    }

    dialog.content = function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [
            m("form", {
                class: "pure-control-group"
            }, [
                m("label", {
                    style: {minWidth: "200px"}
                }, "Include child work orders:"),
                m(chkbox, {
                    onclick: (val) => isRecursive(val),
                    value: isRecursive(),
                    title: (
                        "Recursively put all allocated work orders " +
                        "upstream on hold also"
                    )
                })
            ])
        ]);
    };
    dialog.title(title);
    dialog.icon(icon);
    dialog.onOk(onOk);
    dialog.show();
}

workOrder.static().hold = doHold.bind(null, true);
workOrder.static().allow = doHold.bind(null, false);

/**
    Work order operation model
*/
function woop(data, feather) {
    feather = feather || catalog.getFeather("WorkOrderOperation");
    if (feather.properties.isManualAdd) {
        feather.properties.isManualAdd.default = true; // Client only behavior
    }
    let model = f.createModel(data, feather);
    let d = model.data;
    let err = false;
    let allowToComplete = false;

    function handleStyle() {
        if (!d.available.toJSON() || d.onHold()) {
            model.style("DISABLED");
            if (d.onHold()) {
                d.statusIcon.style("HIGH");
            }
            return;
        }

        if (
            d.workOrder() && d.workOrder().data.priority() === "1"
        ) {
            model.style("HIGH");
            return;
        }

        d.statusIcon.style("");
        model.style("");
    }

    async function postCompletion() {
        await f.datasource().request({
            method: "POST",
            path: "/data/operation-completion",
            headers: (
                d.token()
                ? {"fb-token": d.token().identityToken}
                : undefined
            ),
            body: {
                isPosted: true,
                operation: {id: model.id()},
                quantity: d.toComplete.toJSON()
            }
        });
        model.set({toComplete: 0}, true);
    }

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (d.onHold()) {
                return "front_hand";
            }

            switch (d.status()) {
            case "P":
                return "pending";
            case "A":
                return "start";
            case "I":
                return "double_arrow";
            case "C":
                return "check_circle";
            }
        }
    });

    model.data.statusIcon.title = function () {
        let ret = "";

        if (d.onHold()) {
            ret = "On Hold";
        }

        switch (d.status()) {
        case "P":
            ret = "Pending";
            break;
        case "A":
            ret = "Active";
            break;
        case "I":
            ret = "In Process";
            break;
        case "C":
            ret = "Closed";
            break;
        }

        if (d.isManualAdd && d.isManualAdd()) {
            ret += " (manually added)";
        }

        return ret;
    };

    model.data.statusIcon.style = function () {
        if (d.onHold()) {
            return "HIGH";
        }

        if (d.isManualAdd && d.isManualAdd()) {
            return "WARNING";
        }
    };

    model.addCalculated({
        name: "token",
        type: "object",
        function: f.prop()
    });

    function handleReadOnly() {
        d.toComplete.isReadOnly(!d.available.toJSON() || d.onHold());
        d.transferBatchPolicy.isReadOnly(Boolean(d.service()));
    }

    function recalcHrs() {
        let hrs;
        let batches;
        let seq = d.sequence.toJSON();
        let startTime = (
            seq > 1
            ? new Date(
                model.parent().data.operations()[
                    seq - 2
                ].data.plannedEndTime.toJSON()
            )
            : f.parseDate(model.parent().data.startDate())
        );
        let endTime;
        let curr = d.estimatedServiceCost().currency;

        switch (d.runUnit()) {
        case "HU":
            hrs = d.planned.toJSON().times(d.runRate.toJSON());
            break;
        case "MU":
            hrs = d.planned.toJSON().times(
                d.runRate.toJSON()
            ).div(60);
            break;
        case "UH":
            hrs = d.planned.toJSON().div(d.runRate.toJSON());
            break;
        case "UM":
            hrs = d.planned.toJSON().times(
                d.runRate.toJSON()
            ).div(3600);
            break;
        case "HB":
            batches = Math.ceil(
                d.planned.toJSON().div(d.batchSize.toJSON())
            );
            hrs = batches.times(d.runRate.toJSON());
            break;
        }
        d.runTime(hrs);

        // Calc Total shop hours and cost
        hrs = hrs.plus(d.setupTime.toJSON());
        d.capacityTime(hrs);
        d.estimatedOverheadCost({
            amount: d.overheadCost.toJSON().amount.times(hrs).times(
                d.machineCapacity.toJSON()
            ),
            currency: curr
        });
        d.estimatedLaborCost({
            amount: d.laborCost.toJSON().amount.times(hrs).times(
                d.laborCapacity.toJSON()
            ),
            currency: curr
        });
        d.estimatedServiceCost({
            amount: d.serviceCost.toJSON().amount.times(hrs).times(
                d.planned.toJSON()
            ),
            currency: curr
        });

        // Calc total plan time
        hrs = hrs.plus(
            d.queueTime.toJSON()
        ).plus(
            d.waitTime.toJSON()
        ).plus(
            d.moveTime.toJSON()
        ).plus(
            d.serviceLeadTime.toJSON().plus(1).times(24)
        );
        d.leadTime(hrs);
        endTime = new Date(startTime);
        endTime.setHours(endTime.getHours().plus(hrs));

        d.plannedStartTime(startTime);
        d.plannedEndTime(endTime);

        return;
    }

    async function loadServiceLeadTime() {
        let lt = 0;

        try {
            if (d.service()) {
                d.transferBatchPolicy("C");
                let resp = await f.datasource().request({
                    method: "POST",
                    path: "/design/get-item-sites",
                    body: {id: d.service().id()}
                });

                if (resp && resp.length) {
                    resp = resp.find(
                        (is) => is.site.id === model.parent().data.site().id()
                    );
                    lt = resp.leadTime;
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            d.serviceLeadTime(lt);
            handleReadOnly();
        }
    }

    model.onChanged("service", loadServiceLeadTime);
    model.onChanged("serviceLeadTime", recalcHrs);
    model.onChanged("setupTime", recalcHrs);
    model.onChanged("runRate", recalcHrs);
    model.onChanged("runUnit", recalcHrs);
    model.onChanged("planned", recalcHrs);
    model.onChanged("batchSize", recalcHrs);
    model.onChanged("transferBatchPolicy", recalcHrs);
    model.onChanged("transferBatchValue", recalcHrs);
    model.onChanged("queueTime", recalcHrs);
    model.onChanged("waitTime", recalcHrs);
    model.onChanged("moveTime", recalcHrs);
    model.onChanged("machineCapacity", recalcHrs);
    model.onChanged("laborCapacity", recalcHrs);
    model.onChanged("laborCost", recalcHrs);
    model.onChanged("overheadCost", recalcHrs);
    model.onChanged("serviceCost", recalcHrs);

    model.onChanged("laborResource", function () {
        if (d.laborResource()) {
            d.laborCost(d.laborResource().data.laborCost.toJSON());
        }
    });
    model.onChanged("machineResource", function () {
        if (d.machineResource()) {
            d.overheadCost(d.machineResource().data.overheadCost.toJSON());
        }
    });
    model.onChange("service", function () {
        if (d.service()) {
            d.serviceCost(
                d.service().data.serviceCost.toJSON()
            );
        }
    });

    model.onChanged("toComplete", function () {
        err = false;
    });
    model.parent(true); // This allows editing of model
    model.onLoad(function () {
        // Allow editing "to complete" directly on orphan operation
        if (typeof model.parent() === "boolean" && !allowToComplete) {
            allowToComplete = true;
            model.onCanDelete(() => false);
            model.parent(true); // This allows editing of model
            // But turn off all attributes directly
            Object.keys(d).forEach(function (key) {
                d[key].isReadOnly(true);
            });

            // Overload patch function with special case
            model.onSave(postCompletion);

            // Don't bother locking
            let clean = model.state().resolve("/Ready/Fetched/Clean");
            clean.event("changed", function () {
                clean.goto("../Dirty");
            });

            model.onValidate(function () {
                if (err) {
                    throw err;
                }
            });
            handleStyle();
        }
        handleReadOnly();
    });

    model.onCanDelete(function () {
        return (
            !d.started.toJSON() &&
            d.status() !== "I" &&
            d.status() !== "C"
        );
    });

    model.onValidate(function () {
        if (d.yield && d.yield.toJSON() <= 0) {
            throw "Yield must be a positive number";
        }
        if (d.batchSize && d.batchSize.toJSON() <= 0) {
            throw "Batch size must be a positive number";
        }
    });

    return model;
}

woop.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "status indicator",
        format: "icon"
    }
});

catalog.registerModel("WorkOrderOperation", woop);

woop.static().completion = function (viewModel) {
    let instances = catalog.register("instances");
    let oc = opCompl();
    let op = viewModel.tableWidget().selection();

    // Create new op completion model
    oc.data.operation({
        id: op.id(),
        number: op.data.number(),
        description: op.data.description(),
        status: op.data.status(),
        onHold: op.data.onHold(),
        machineResource: op.data.machineResource(),
        laborResource: op.data.laborResource()
    });
    oc.data.operation.isReadOnly(true);
    // Register so next page knows about it
    instances[oc.id()] = oc;
    // Launch page
    m.route.set("/edit/:feather/:key", {
        feather: "OperationCompletion",
        key: oc.id()
    }, {
        state: {create: false}
    });
};
woop.static().checkCompletion = function (selections) {
    return (
        selections &&
        selections.length === 1 &&
        (
            selections[0].data.status() === "A" ||
            selections[0].data.status() === "I"
        )
    );
};

/**
    Work order requirement
*/
function woReq(data, feather) {
    feather = feather || catalog.getFeather("WorkOrderRequirement");
    if (feather.properties.isManualAdd) {
        feather.properties.isManualAdd.default = true; // Client only behavior
    }
    let model = f.createModel(data, feather);
    let d = model.data;

    if (d.unit && d.item) {
        mixinItemConversion(model);
    }
    if (d.quantityDue) {
        d.quantityDue.isReadOnly(true);
    }

    function handleAliases() {
        let item = (
            d.item
            ? d.item()
            : null
        );

        if (item) {
            if (d.required) {
                d.required.alias(
                    "Required (" + item.data.unit().data.code() + ")"
                );
            }
            if (d.issued) {
                d.issued.alias(
                    "Issued (" + item.data.unit().data.code() + ")"
                );
            }
        }
    }

    function handleReadOnly() {
        if (model.parent()) {
            d.item.isReadOnly(
                (
                    !d.isManualAdd() &&
                    (
                        !d.substitutions() ||
                        d.substitutions().length < 2
                    )
                ) ||
                d.issued.toJSON() ||
                d.allocated.toJSON()
            );
        } else if (d.item) {
            d.item.isReadOnly(true);
        }
    }

    function calcRequired() {
        let qty = d.quantityPer.toJSON().plus(
            d.fixedQuantity.toJSON()
        ).times(d.ratio.toJSON());

        if (d.item() && !d.item().data.isFractional()) {
            qty = Math.ceil(qty);
        }

        d.required(qty);
    }

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.status()) {
            case "P":
                return "pending";
            case "A":
                return "start";
            case "I":
                return "double_arrow";
            case "C":
                return "check_circle";
            }
        }
    });

    function canSubstitute() {
        return (
            d.substitutions() &&
            d.substitutions().length > 1 &&
            !d.issued.toJSON() &&
            !d.allocated.toJSON()
        );
    }

    model.data.statusIcon.title = function () {
        let ret;

        switch (d.status()) {
        case "P":
            ret = "Pending";
            break;
        case "A":
            ret = "Active";
            break;
        case "C":
            ret = "Closed";
            break;
        }
        if (d.isManualAdd()) {
            ret += " (manually added)";
        } else if (canSubstitute()) {
            ret += " (substitutions available)";
        }
        return ret;
    };

    model.data.statusIcon.style = function () {
        if (d.isManualAdd()) {
            return "WARNING";
        }

        if (canSubstitute()) {
            return "ALT-EMPHASIS";
        }
    };

    model.onChanged("item", function () {
        d.site(model.parent().data.site.toJSON());
        handleAliases();
    });
    model.onChanged("quantityPer", calcRequired);
    model.onChanged("fixedQuantity", calcRequired);
    model.onChanged("ratio", calcRequired);
    model.onLoad(function () {
        let subs = (
            d.substitutions
            ? d.substitutions()
            : []
        );

        if (subs && subs.length > 1) {
            d.item.filter().criteria.push({
                property: "status",
                value: "A"
            }, {
                property: "id",
                operator: "IN",
                value: d.substitutions()
            });
        }
        handleAliases();
        handleReadOnly();
    });

    model.onCanDelete(() => !d.issued.toJSON());

    model.onValidate(function () {
        if (
            d.item && d.item() &&
            model.state().current()[0] !== "/Delete"
        ) {
            if (d.item().data.status() !== "A") {
                throw new Error(
                    "Product " + d.item().data.number() + " is not active"
                );
            }

            if (
                d.item().data.type() === "K" ||
                d.item().data.type() === "P"
            ) {
                throw new Error(
                    "Product " + d.item().data.number() +
                    " must be of type Inventory or Expense"
                );
            }
        }
    });

    if (d.item) {
        d.item.filter().criteria.push({
            property: "status",
            value: "A"
        }, {
            property: "type",
            operator: "IN",
            value: ["I", "E"]
        });
    }

    return model;
}

woReq.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("WorkOrderRequirement", woReq);

/**
   Work Order Comment
*/
function woCmt(data, feather) {
    feather = feather || catalog.getFeather("WorkOrderComment");
    let model = f.createModel(data, feather);

    model.onLoad(function () {
        if (model.data.isSystem()) {
            model.state().send("freeze");
        }
    });

    return model;
}

catalog.registerModel("WorkOrderComment", woCmt);

/**
    Work order receipt model
*/

function workOrderReceipt(data, feather) {
    feather = feather || catalog.getFeather("WorkOrderReceipt");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        d.workOrder.isReadOnly(true);
        if (d.status() === "R") {
            model.state().send("freeze");
        }
    }

    model.onChanged("workOrder", async function () {
        let wo = model.data.workOrder();
        let s;

        if (wo) {
            if (
                wo.data.status() !== "A" &&
                wo.data.status() !== "I"
            ) {
                return;
            }

            s = await f.datasource().request({
                body: {id: d.workOrder().data.site().id()},
                method: "POST",
                path: "/stock/get-site-data"
            });
            d.site(s);
            handleDetailsReadOnly();
        }
    });

    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let status = (
            d.workOrder()
            ? d.workOrder().data.status()
            : false
        );

        if (status === "P") {
            throw (
                "Work order is in status " +
                "\"Pending\" and cannot be received"
            );
        }

        if (model.state().current()[0] === "/Ready/New") {
            if (status === "R") {
                throw (
                    "Work order already has a pending receipt."
                );
            }

            if (status === "C") {
                throw (
                    "Work order is closed."
                );
            }
        }
    });

    d.workOrder.filter().criteria.push({
        property: "status",
        operator: "IN",
        value: ["A", "I"]
    }, {
        property: "onHold",
        value: false
    });

    function handleDefaultRow() {
        let site = d.site();
        let item = d.workOrder().data.item();
        let loc = (
            Boolean(site.data.defaultReceiveLocation())
            ? site.data.defaultReceiveLocation.toJSON()
            : site.data.defaultLocation.toJSON()
        );
        if (
            (
                item.data.trace() !== "N" ||
                site.data.locationControlled()
            ) &&
            !d.details().length &&
            d.quantity.toJSON() > 0
        ) {
            d.details().add({location: loc});
        }
    }

    function handleReceiptQty() {
        if (d.details().length === 1) {
            d.details()[0].data.quantity(d.quantity());
        }
    }

    function handleDetailsQty() {
        let qty = 0;

        d.details().forEach(function (row) {
            if (row.state().current()[0] !== "/Delete") {
                qty = qty.plus(row.data.quantity.toJSON());
            }
        });

        d.quantity(qty);
    }

    function handleDetailsReadOnly() {
        if (!d.details) {
            return;
        }
        let site = d.site();
        let item = (
            d.workOrder()
            ? d.workOrder().data.item()
            : false
        );
        let hasTrace;
        let hasLoc;

        hasTrace = (
            item
            ? item.data.trace() !== "N"
            : false
        );
        hasLoc = (
            site
            ? site.data.locationControlled()
            : false
        );

        d.quantity.isReadOnly(d.details().length > 1);

        d.details().forEach(function (row) {
            row.data.trace.isReadOnly(!hasTrace);
            row.data.trace.isRequired(hasTrace);
            row.data.location.isReadOnly(!hasLoc);
            row.data.location.isRequired(hasLoc);
        });
        if (
            model.data.status() === "P" &&
            (
                hasLoc ||
                hasTrace !== "N"
            )
        ) {
            d.details().canAdd(true);
        } else {
            d.details().canAdd(false);
        }
    }

    model.onChange("quantity", function (p) {
        let wo = d.workOrder();

        if (p.newValue() < 0 || !wo) {
            p.newValue(p.oldValue());
        }

        if (wo && !wo.data.item().data.isFractional()) {
            p.newValue(Math.ceil(p.newValue()));
        }
    });

    model.onChanged("details", handleDetailsReadOnly);
    model.onChanged("details", handleDetailsQty);
    model.onChanged("quantity", handleDefaultRow);
    model.onChanged("quantity", handleReceiptQty);
    model.parent.state().substateMap.Changing.exit(handleDetailsReadOnly);
    model.onLoad(handleDetailsReadOnly);
    model.onChanged("details.quantity", handleDetailsQty);

    if (d.details) {
        d.details().canAdd(false);
        model.onValidate(function () {
            if (
                d.quantity.toJSON() > 0 &&
                !d.details().length &&
                (
                    d.site().data.locationControlled() ||
                    d.workOrder().data.item().data.trace() !== "N"
                )
            ) {
                throw "Receipt must include detail records";
            }

            d.details().forEach(function (row) {
                if (row.data.quantity() <= 0) {
                    throw "Detail records must have positive quantity.";
                }
            });
        });
    }

    return model;
}

catalog.registerModel("WorkOrderReceipt", workOrderReceipt);

workOrderReceipt.static().post = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let ary = viewModel.selections().filter(
        (s) => s.data.status() === "P"
    ).map((s) => s.id());
    let payload = {
        method: "POST",
        path: "/make/post-work-order-receipts",
        body: {ids: ary}
    };

    f.datasource().request(payload).then(function (resp) {
        viewModel.refresh();
        success(dialog, resp);
    }).catch(
        error.bind(null, dialog)
    );
};

workOrderReceipt.static().postCheck = function (selections) {
    return selections.some((sel) => sel.data.status() === "P");
};

/**
    Outside process model
*/
const opfthr = catalog.getFeather("OutsideProcess");
opfthr.properties.number.isAlwaysLoad = true;
function outsideProcess(data, feather) {
    feather = feather || opfthr;
    let model = f.createModel(data, feather);
    let d = model.data;

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.status()) {
            case "U":
                return "radio_button_unchecked";
            case "P":
                return "pending";
            case "A":
                return "start";
            case "I":
                return "double_arrow";
            case "C":
                return "done";
            }
        }
    });
    model.data.statusIcon.title = function () {
        switch (d.status()) {
        case "P":
            return "Pending";
        case "A":
            return "Active";
        case "I":
            return "In Process";
        case "C":
            return "Closed";
        }
    };

    return model;
}

outsideProcess.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("OutsideProcess", outsideProcess);

/**
   Work order issue model
*/
function workOrderIssue(data, feather) {
    feather = feather || catalog.getFeather("WorkOrderIssue");
    let model = f.createModel(data, feather);
    let d = model.data;
    if (d.operation) {
        d.operation.isReadOnly(true);
    }

    let wo = f.prop();

    function handleReadOnly() {
        if (d.status() === "I") {
            model.isReadOnly(true);
            model.state().send("freeze");
        } else if (d.operation) {
            d.operation.isReadOnly(!Boolean(d.workOrder()));
            if (d.materials) {
                loadWorkOrder(false);
            }
        }
    }

    function populateMaterials() {
        let mtls;
        if (d.operation()) {
            mtls = wo().materials.filter(
                (m) => m.operation === d.operation().data.sequence.toJSON()
            );
        } else if (wo() && wo().materials) {
            mtls = wo().materials.filter(
                (m) => m.operation === 0
            );
        }
        if (d.materials) {
            d.materials().clear();
        }

        if (mtls) {
            mtls.forEach(function (mtl) {
                d.materials().add({
                    materialRequirement: mtl
                });
            });
        }
    }

    function loadWorkOrder(populate) {
        if (
            !d.workOrder() ||
            (
                d.operation && d.workOrder &&
                wo() && wo().id !== d.workOrder().id()
            )
        ) {
            d.operation(null);
        }
        d.operation.isReadOnly(true);
        wo(undefined);

        if (!d.workOrder()) {
            return;
        }

        function callback(resp) {
            if (!resp) {
                return;
            }
            d.operation.isReadOnly(false);
            wo(resp);

            if (resp) {
                if (
                    wo().status !== "A" &&
                    wo().status !== "I"
                ) {
                    return;
                }

                d.operation.filter().criteria.length = 0;
                d.operation.filter().criteria.push({
                    property: "id",
                    operator: "IN",
                    value: wo().operations.map((o) => o.id)
                });

                let dwl = () => wo().site.defaultWipLocation;
                dwl.toJSON = () => wo().site.defaultWipLocation;
                d.workOrder().data.site().data.defaultWipLocation = dwl;
                if (populate !== false) {
                    populateMaterials();
                }
            }
        }

        f.datasource().request({
            body: {id: d.workOrder().id()},
            method: "POST",
            path: "/make/get-work-order-issue-data"
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.onChanged("workOrder", loadWorkOrder);
    model.onChanged("operation", populateMaterials);

    model.onLoad(handleReadOnly);

    function handleStatus() {
        if (d.status() === "R") {
            d.statusIcon.title("Received");
            d.statusIcon.style("ALT-EMPHASIS");
        } else if (d.error()) {
            d.statusIcon.title(d.error());
            d.statusIcon.style("HIGH");
        } else {
            d.statusIcon.title("Not posted");
            d.statusIcon.style("ALT-EMPHASIS");
        }
    }
    model.onChanged("error", handleStatus);
    model.onChanged("status", handleStatus);
    model.onLoad(handleStatus);

    if (d.materials) {
        d.materials().canAdd(false);
    }

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (d.status() === "I") {
                return "check_circle";
            }
            if (d.error()) {
                return "error";
            }
            return "radio_button_unchecked";
        }
    });

    model.onCanDelete(function () {
        return d.status() === "P";
    });

    model.onValidate(function () {
        let status = (
            (d.workOrder && d.workOrder())
            ? d.workOrder().data.status()
            : false
        );

        if (
            (
                model.state().current()[0] === "/Ready/New" ||
                model.state().current()[0] === "/Ready/Fetched/Dirty"
            ) &&
            d.workOrder && d.workOrder() && d.workOrder().data.onHold()
        ) {
            throw ("Work order is on hold ");
        }

        if (model.state().current()[0] === "/Ready/New") {
            if (status === "C") {
                throw (
                    "Work order is closed."
                );
            }
        }
    });

    d.workOrder.filter().criteria.push({
        operator: "~*",
        property: "status",
        value: "A|I"
    }, {
        property: "onHold",
        value: false
    });

    return model;
}

workOrderIssue.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("WorkOrderIssue", workOrderIssue);

workOrderIssue.static().post = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let ary = viewModel.selections().filter(
        (s) => s.data.status() === "P"
    ).map((s) => s.id());
    let payload = {
        method: "POST",
        path: "/make/post-work-order-issues",
        body: {ids: ary}
    };

    f.datasource().request(payload).then(function (resp) {
        viewModel.refresh();
        success(dialog, resp);
    }).catch(
        error.bind(null, dialog)
    );
};

workOrderIssue.static().postCheck = function (selections) {
    return selections.some((sel) => sel.data.status() === "P");
};

/**
    Work Order Issue Material  model
*/
function woimModel(data, feather) {
    feather = feather || catalog.getFeather("WorkOrderIssueMaterial");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleDefaultRow() {
        let site = model.parent().data.workOrder().data.site();
        let item = d.materialRequirement().data.item();
        if (
            item.data.trace() !== "N" ||
            site.data.locationControlled()
        ) {
            if (
                !d.details().length &&
                d.quantity.toJSON() > 0
            ) {
                d.details().add({
                    location: site.data.defaultWipLocation()
                });
            } else if (
                d.details().length &&
                d.quantity.toJSON() === 0
            ) {
                // Shallow copy so removing doesn't git mixed up on self
                d.details().slice().forEach(function (detail) {
                    d.details().remove(detail);
                });
            }
        }
    }

    function handleDetailsReadOnly() {
        let mr = d.materialRequirement();
        let site;
        let item;
        let hasTrace;
        let hasLoc;

        if (!mr) {
            return;
        }

        site = mr.data.site();
        item = mr.data.item();
        hasTrace = item.data.trace() !== "N";
        hasLoc = site.data.locationControlled();
        d.quantity.isReadOnly(d.details().length > 1);

        d.details().forEach(function (row) {
            row.data.trace.isReadOnly(!hasTrace);
            row.data.trace.isRequired(hasTrace);
            row.data.location.isReadOnly(!hasLoc);
            row.data.location.isRequired(hasLoc);
        });

        if (
            model.parent().data.status() === "P" &&
            (
                site.data.locationControlled() ||
                item.data.trace() !== "N"
            )
        ) {
            d.details().canAdd(true);
        } else {
            d.details().canAdd(false);
        }
    }

    function handleDetailsQty() {
        let qty = 0;

        d.details().forEach(function (row) {
            if (row.state().current()[0] !== "/Delete") {
                qty = qty.plus(row.data.quantity.toJSON());
            }
        });

        d.quantity(qty);
    }

    function handleIssQty() {
        if (d.details().length === 1) {
            d.details()[0].data.quantity(d.quantity());
        }
    }

    d.details().canAdd(false);
    model.onChanged("materialRequirement", handleDetailsReadOnly);
    model.onChanged("materialRequirement", handleDefaultRow);
    model.onChanged("details", handleDetailsReadOnly);
    model.onChanged("details", handleDetailsQty);
    model.onChanged("quantity", handleDefaultRow);
    model.onChanged("quantity", handleIssQty);
    model.parent.state().substateMap.Changing.exit(handleDetailsReadOnly);
    model.onLoad(handleDetailsReadOnly);
    model.onChanged("details.quantity", handleDetailsQty);


    return model;
}

catalog.registerModel("WorkOrderIssueMaterial", woimModel);


woimModel.static().checkIssueAll = function (ignore, viewModel) {
    return viewModel.parentViewModel().model().data.workOrder();
};

woimModel.static().issueAll = function (viewModel) {
    viewModel.parentViewModel().model().data.materials().forEach(function (l) {
        l.data.quantity(
            Math.max(
                l.data.materialRequirement().data.required.toJSON().minus(
                    l.data.materialRequirement().data.issued.toJSON()
                ).plus(l.data.materialRequirement().data.returned.toJSON()),
                0
            )
        );
    });
};
workOrder.static().issue = function (viewModel) {
    let instances = catalog.register("instances");
    let woi = workOrderIssue();
    let wo = viewModel.selections()[0];

    // Create new work order issue model
    woi.data.workOrder({
        id: wo.id(),
        number: wo.data.number(),
        status: wo.data.status(),
        onHold: wo.data.onHold(),
        site: wo.data.site(),
        item: wo.data.item()
    });
    // Register so next page knows about it
    instances[woi.id()] = woi;
    // Launch page
    m.route.set("/edit/:feather/:key", {
        feather: "WorkOrderIssue",
        key: woi.id()
    }, {
        state: {create: false}
    });
};
workOrder.static().checkIssue = function (selections) {
    return (
        selections.length === 1 &&
        !selections[0].data.onHold() &&
        (
            selections[0].data.status() === "A" ||
            selections[0].data.status() === "I"
        )
    );
};
/* -------------------------------------------------------------------------
    Dashboard: production tiles, Key Metrics and due dates.

    Tiles read bi.production_daily through the shared tile service
    (common/do-get-bi-tile-data.js); Refresh rebuilds it. KPIs come from
    /make/get-production-kpis, the histogram from /make/get-production-schedule.
------------------------------------------------------------------------- */
const DASH_MAKE_MEASURES = {
    produced: "Produced"
};

const DASH_MAKE_DIMENSIONS = {
    item: "product",
    itemCategory: "product category",
    itemGroup: "product group",
    site: "site"
};

const DASH_MAKE_WINDOWS = {
    MTD: "Month to date",
    QTD: "Quarter to date",
    WTD: "Week to date",
    YTD: "Year to date"
};

const DASH_MAKE_COMPARISONS = {
    none: "",
    priorPeriod: "prior period",
    priorYear: "prior year"
};

let dashMakeMoney;
let dashMakeCompact;

// Base currency: the rollup sums base amounts. Read late, once loaded.
function dashMakeCurrency() {
    try {
        return f.baseCurrency().data.code();
    } catch (ignore) {
        return "USD";
    }
}

function dashMakeAmount(value) {
    if (!dashMakeMoney) {
        dashMakeMoney = new Intl.NumberFormat(undefined, {
            currency: dashMakeCurrency(),
            maximumFractionDigits: 0,
            style: "currency"
        });
    }
    return dashMakeMoney.format(Number(value));
}

function dashMakeShort(value) {
    if (!dashMakeCompact) {
        dashMakeCompact = new Intl.NumberFormat(undefined, {
            currency: dashMakeCurrency(),
            maximumFractionDigits: 1,
            notation: "compact",
            style: "currency"
        });
    }
    return dashMakeCompact.format(Number(value));
}

function dashMakeUnits(value) {
    return Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 0
    });
}

const DASH_MAKE_FORMAT = {
    amount: dashMakeAmount,
    compact: dashMakeShort,
    units: dashMakeUnits
};

function dashMakeChoices(labels) {
    return Object.keys(labels).sort().map(function (key) {
        let said = labels[key];

        return {
            value: key,
            label: said.slice(0, 1).toUpperCase() + said.slice(1)
        };
    });
}

function dashMakeOptions() {
    return [{
        key: "measure",
        label: "Measure",
        choices: dashMakeChoices(DASH_MAKE_MEASURES),
        default: "produced"
    }, {
        key: "dimension",
        label: "Grouped by",
        choices: dashMakeChoices(DASH_MAKE_DIMENSIONS),
        default: "item"
    }, {
        key: "window",
        label: "Period",
        choices: dashMakeChoices(DASH_MAKE_WINDOWS),
        default: "YTD"
    }, {
        key: "comparison",
        label: "Compared with",
        choices: [
            {value: "priorYear", label: "Prior year"},
            {value: "priorPeriod", label: "Prior period"},
            {value: "none", label: "Nothing"}
        ],
        default: "priorYear"
    }, {
        key: "limit",
        label: "Show",
        choices: [
            {value: "0", label: "All"},
            {value: "5", label: "Top 5"},
            {value: "10", label: "Top 10"},
            {value: "20", label: "Top 20"}
        ],
        default: "0"
    }, {
        key: "sort",
        label: "Order",
        choices: [
            {value: "amount", label: "Largest first"},
            {value: "name", label: "By name"}
        ],
        default: "amount"
    }, {
        key: "showUnits",
        label: "Also show",
        choices: [
            {value: "", label: "Nothing else"},
            {value: "true", label: "Units"}
        ],
        default: ""
    }];
}

function dashMakeHeading(tile) {
    let dimension = (
        DASH_MAKE_DIMENSIONS[tile.dimension] ||
        DASH_MAKE_DIMENSIONS.item
    );
    let measure = (
        DASH_MAKE_MEASURES[tile.measure] ||
        DASH_MAKE_MEASURES.produced
    );
    let limit = Number(tile.limit) || 0;
    let said = measure + " " + (tile.window || "YTD") + " by " + dimension;

    if (limit > 0) {
        said = "Top " + limit + ": " + said;
    }
    return said;
}

function dashMakeLoad(tile) {
    return f.datasource().request({
        method: "POST",
        path: "/common/get-bi-tile-data",
        body: {
            asOf: tile.asOf || null,
            comparison: tile.comparison || "priorYear",
            dimension: tile.dimension || "item",
            fact: "production",
            limit: tile.limit || 0,
            measure: tile.measure || "produced",
            sort: tile.sort || "amount",
            sparkline: (
                (tile.showSpark || tile.display === "multiples")
                ? 12
                : 0
            ),
            window: tile.window || "YTD"
        }
    }).then(function (data) {
        return Object.assign({
            comparisonLabel: DASH_MAKE_COMPARISONS[data.comparison]
        }, data);
    });
}

// One request per reporting date answers every production KPI; the slot
// clears when it settles, so it de-dupes a tick and caches nothing.
let dashMakeKpiAsOf;
let dashMakeKpiPending;

function dashMakeKpiFetch(asOf) {
    let key = asOf || "";

    if (dashMakeKpiPending && dashMakeKpiAsOf === key) {
        return dashMakeKpiPending;
    }
    dashMakeKpiAsOf = key;
    dashMakeKpiPending = f.datasource().request({
        method: "POST",
        path: "/make/get-production-kpis",
        body: {asOf: asOf || null}
    }).then(function (answer) {
        dashMakeKpiPending = undefined;
        return answer;
    }, function (err) {
        dashMakeKpiPending = undefined;
        return Promise.reject(err);
    });
    return dashMakeKpiPending;
}

function dashMakeKpiLoad(key) {
    return function (context) {
        let at = (context && context.asOf) || null;
        let said = (
            (at && typeof at.toISOString === "function")
            ? at.toISOString().slice(0, 10)
            : at
        );

        return dashMakeKpiFetch(said).then(function (answer) {
            let all = answer.kpis || {};

            // Figures for another date are worse than none.
            if (said && answer.asOf && answer.asOf !== said) {
                return {value: null};
            }
            return all[key] || {value: null};
        });
    };
}


/*
    Drill-down: the work orders behind a bar of the due-date histogram --
    not closed, due in the bar's dates. The bar values what is still to
    receive at standard cost; a work order carries no such value, so the
    footer counts them and adds up ordered and received.
*/
const DASH_MAKE_DUE_COLUMNS = [
    {attr: "dueDate", width: 113},
    {attr: "number", width: 97},
    {attr: "item", width: 0},
    {attr: "site", width: 54},
    {attr: "ordered", width: 90},
    {attr: "received", width: 90},
    {attr: "status", width: 94},
    {attr: "startDate", width: 113}
];

function dashMakeDueDrill(bar) {
    function said(day) {
        return new Date(day + "T00:00:00").toLocaleDateString();
    }

    return {
        config: {
            aggregates: [
                {method: "COUNT", property: "number"},
                {method: "SUM", property: "ordered"},
                {method: "SUM", property: "received"}
            ],
            columns: DASH_MAKE_DUE_COLUMNS.map(function (col) {
                return Object.assign({label: ""}, col);
            }),
            filter: {
                criteria: [{
                    operator: "!=",
                    property: "status",
                    value: "C"
                }, {
                    operator: ">=",
                    property: "dueDate",
                    value: bar.from
                }, {
                    operator: "<=",
                    property: "dueDate",
                    value: bar.to
                }],
                sort: [{property: "dueDate"}, {property: "number"}]
            }
        },
        feather: "WorkOrder",
        icon: "factory",
        title: "Work orders " + (
            bar.late
            ? "past due "
            : "due "
        ) + (
            bar.from === bar.to
            ? said(bar.from)
            : said(bar.from) + " to " + said(bar.to)
        )
    };
}

function dashMakeRegister() {
    let globals = catalog.store().global();
    let kpis = [
        {
            key: "makeOnTimeCompletion",
            name: "On-Time Completions",
            from: "onTimeCompletion",
            better: "higher",
            unit: "percent"
        },
        {
            key: "makeProducedYtd",
            name: "Produced YTD",
            from: "producedYtd",
            better: "higher"
        },
        {
            key: "makeProducedMtd",
            name: "Produced MTD",
            from: "producedMtd",
            better: "higher"
        },
        {
            key: "makeProducedWtd",
            name: "Produced WTD",
            from: "producedWtd",
            better: "higher"
        }
    ];

    if (globals.dashboardSources) {
        globals.dashboardSources.register({
            key: "production",
            module: "SupplyChain",
            name: "Production",
            format: DASH_MAKE_FORMAT,
            betterFor: function () {
                return "higher";
            },
            headingFor: dashMakeHeading,
            options: dashMakeOptions(),
            load: dashMakeLoad
        });
    }

    if (globals.dashboardKpis) {
        kpis.forEach(function (kpi) {
            globals.dashboardKpis.register({
                key: kpi.key,
                module: "SupplyChain",
                group: "Production",
                isStandard: false,
                name: kpi.name,
                better: kpi.better,
                unit: kpi.unit || "money",
                format: function (n) {
                    if (n === null || n === undefined) {
                        return "—";
                    }
                    if (kpi.unit === "percent") {
                        return Number(n).toLocaleString(undefined, {
                            maximumFractionDigits: 1
                        }) + "%";
                    }
                    return dashMakeAmount(n);
                },
                load: dashMakeKpiLoad(kpi.from)
            });
        });
    }

    if (globals.dashboardSchedules) {
        globals.dashboardSchedules.register({
            key: "production",
            sequence: 3,
            module: "SupplyChain",
            name: "Production",
            format: DASH_MAKE_FORMAT,
            drillFor: dashMakeDueDrill,
            load: function (context) {
                return f.datasource().request({
                    method: "POST",
                    path: "/make/get-production-schedule",
                    body: {
                        asOf: context.asOf || null,
                        bucket: context.bucket
                    }
                });
            }
        });
    }

    if (globals.dashboardRefreshers) {
        globals.dashboardRefreshers.register({
            key: "productionBi",
            module: "SupplyChain",
            label: "production figures",
            run: function () {
                return f.datasource().request({
                    method: "POST",
                    path: "/make/refresh-production-bi",
                    body: {}
                });
            },
            describe: function (done) {
                let count = (done && done.buckets) || 0;

                return Number(count).toLocaleString() + " daily totals";
            }
        });
    }
}

dashMakeRegister();
