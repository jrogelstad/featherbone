/*jslint unordered devel*/
async function doPlanSupply(obj) {
    let dmd;
    let resp;

    await f.datasource.request({
        method: "POST",
        name: "doCreateAllocations",
        client: obj.client,
        data: {demandId: obj.data.demandId, eventKey: obj.data.eventKey}
    }, true);

    dmd = await f.datasource.request({
        method: "GET",
        name: "Demand",
        properties: [
            "id",
            "item",
            "site",
            "quantityDue",
            "allocated",
            "dueDate",
            "objectType",
            "priority",
            "links"
        ],
        client: obj.client,
        id: obj.data.demandId
    }, true);

    if (!dmd) {
        return Promise.reject("Demand not found");
    }

    if (dmd.allocated >= dmd.quantityDue) {
        return false; // Nothing to do
    }

    let emp = await f.datasource.request({
        method: "GET",
        name: "Employee",
        properties: ["id"],
        client: obj.client,
        filter: {
            criteria: [{
                property: "userAccount",
                value: obj.client.currentUser()
            }]
        }
    }, true);
    emp = emp[0] || {};

    resp = await f.datasource.request({
        method: "GET",
        name: "Item",
        properties: [
            "conversions",
            "isFractional",
            "sites",
            "source",
            "suppliers",
            "unit",
            "status",
            "cost",
            "materialCost",
            "drawingLink",
            "documents"
        ],
        client: obj.client,
        id: dmd.item.id
    }, true);
    let item = resp || {unit: {}, conversions: []};
    resp = await f.datasource.request({
        method: "GET",
        name: "ItemUnitConversion",
        properties: [
            "fromUnit",
            "toUnit",
            "ratio"
        ],
        client: obj.client
    }, true);
    let convs = resp.filter(
        (r) => (
            r.toUnit.id === item.unit.id ||
            r.fromUnit.id === item.unit.id
        )
    ).concat(item.conversions);

    let is = item.sites.find((r) => r.site.id === dmd.site.id);
    let remqty = dmd.quantityDue.minus(dmd.allocated);
    let reqqty = remqty;
    let plnqty = remqty;
    let prod;
    let sdt;
    let supp;
    let thePrice = item.materialCost;
    let prices;
    let primSupp = (s) => s.isPrimary;
    let qualPrices = (p) => p.quantity <= plnqty;
    let theRatio = 1;
    let theUnit;
    let ordId;
    let req;
    let adat;
    let currCode;
    let timeBuffer = obj.data.timeBuffer || 0;
    let theDueDate = f.parseDate(dmd.dueDate);
    theDueDate.setDate(theDueDate.getDate().minus(timeBuffer));

    if (!item) {
        throw ("Item not found");
    }

    if (is.planningPolicy !== "L" && is.planningPolicy !== "M") {
        return;
    }

    currCode = item.cost.currency;

    function byQty(a, b) {
        return a.quantity - b.quantity;
    }

    function getRatio() {
        let found = convs.find((c) => (
            c.toUnit.id === item.unit.id &&
            c.fromUnit.id === theUnit.id
        ));
        let one = 1;
        if (found) {
            return one.div(found.ratio);
        }
        found = convs.find((c) => (
            c.fromUnit.id === item.unit.id &&
            c.toUnit.id === theUnit.id
        ));
        if (found) {
            return found.ratio;
        }
        return 1;
    }


    while (remqty) {
        ordId = f.createId();
        sdt = f.parseDate(dmd.dueDate);
        sdt.setDate(sdt.getDate().minus(is.leadTime).minus(timeBuffer));

        if (is.planningPolicy === "L") { // Plan to Order

            if (is.maximumOrderQuantity) {
                plnqty = Math.min(plnqty, is.maximumOrderQuantity);
            }
            plnqty = Math.max(plnqty, is.minimumOrderQuantity);
            if (is.orderIncrement) {
                prod = plnqty.div(is.orderIncrement);
                if (prod !== Math.ceil(prod)) {
                    plnqty = Math.ceil(prod).times(is.orderIncrement);
                }
            }
            if (!item.isFractional) {
                plnqty = Math.ceil(plnqty);
            }
            remqty = Math.max(remqty.minus(plnqty), 0);

            req = {
                client: obj.client,
                data: {
                    id: ordId,
                    item: dmd.item,
                    site: dmd.site,
                    quantity: plnqty,
                    startDate: sdt.toLocalDate(),
                    dueDate: theDueDate.toLocalDate(),
                    priority: dmd.priority,
                    demand: dmd
                },
                method: "POST",
                user: obj.client.currentUser()
            };

            if (item.source === "P") {
                supp = item.suppliers.find(primSupp);
                if (!supp) {
                    supp = item.suppliers[0];
                }
                if (supp && supp.prices.length) {
                    supp.prices.sort(byQty);
                    prices = supp.prices.filter(qualPrices).slice();
                    if (prices.length) {
                        thePrice = prices.pop().price;
                    }
                }

                theUnit = item.unit;
                if (supp && item.unit.id !== supp.unit.id) {
                    theUnit = supp.unit;
                    theRatio = getRatio();
                }
                supp = supp || {};

                req.data.supplier = supp.supplier;
                req.data.supplierItem = supp.supplierItem;
                req.data.description = supp.supplierDescription;
                req.data.manufacturer = supp.manufacturer;
                req.data.manufacturerItem = supp.manufacturerItem;
                req.data.orderQuantity = plnqty.div(theRatio);
                req.data.unit = theUnit;
                req.data.ratio = theRatio;
                req.data.price = thePrice;
                req.data.demand = dmd;
                req.data.requestedBy = emp.fullName;
                req.name = "PlannedPurchase";
            } else {
                req.name = "PlannedWorkOrder";
            }

            adat = {
                supply: {id: ordId},
                demand: {id: obj.data.demandId},
                quantity: Math.min(reqqty, plnqty)
            };
        } else { // Make to order
            req = {
                client: obj.client,
                name: "WorkOrder",
                data: {
                    id: ordId,
                    item: dmd.item,
                    site: dmd.site,
                    ordered: remqty,
                    startDate: sdt.toLocalDate(),
                    dueDate: theDueDate.toLocalDate(),
                    priority: dmd.priority,
                    drawingLink: item.drawingLink,
                    estimatedLaborCost: {currency: currCode, amount: 0},
                    estimatedMaterialCost: {currency: currCode, amount: 0},
                    estimatedServiceCost: {currency: currCode, amount: 0},
                    estimatedOverheadCost: {currency: currCode, amount: 0},
                    estimatedTotalCost: {currency: currCode, amount: 0},
                    actualLaborCost: {currency: currCode, amount: 0},
                    actualMaterialCost: {currency: currCode, amount: 0},
                    actualServiceCost: {currency: currCode, amount: 0},
                    actualOverheadCost: {currency: currCode, amount: 0},
                    actualTotalCost: {currency: currCode, amount: 0},
                    documents: item.documents
                },
                method: "POST",
                user: obj.client.currentUser()
            };

            adat = {
                supply: {id: ordId},
                demand: {id: obj.data.demandId},
                quantity: remqty
            };
            remqty = 0;
        }

        if (dmd.links && dmd.links.salesDemandId) {
            req.data.salesDemand = {id: dmd.links.salesDemandId};
            req.data.salesOrder = {id: dmd.links.salesOrderId};
            adat.salesDemand = {id: dmd.links.salesDemandId};
            adat.salesOrder = {id: dmd.links.salesOrderId};
        }

        await f.datasource.request(req, true);

        await f.datasource.request({
            client: obj.client,
            data: adat,
            method: "POST",
            name: "Allocation",
            user: obj.client.currentUser()
        }, true);
    }
}

f.datasource.registerFunction(
    "POST",
    "doPlanSupply",
    doPlanSupply
);
