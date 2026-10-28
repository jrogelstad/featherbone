/*jslint unordered*/
// Sort by inventory, firmed, planned, due date, create date
function byTypeDate(a, b) {
    if (
        a.objectType === "Inventory" &&
        b.objectType !== "Inventory"
    ) {
        return 1;
    }

    if (
        a.objectType === "Inventory" &&
        b.objectType === "Inventory"
    ) {
        if (a.created > b.created) {
            return 1;
        }
        return -1;
    }

    if (
        !a.objectType.startsWith("Planned") &&
        b.objectType.startsWith("Planned")
    ) {
        return -1;
    }

    if (
        a.dueDate > b.dueDate
    ) {
        return 1;
    }
    if (
        a.dueDate < b.dueDate
    ) {
        return -1;
    }

    if (a.created > b.created) {
        return 1;
    }
    return -1;
}

async function doCreateAllocations(obj) {
    let clear = Boolean(obj.data.clear);
    let dmds;
    let sups;
    let allc;
    let eKey = obj.data.eventKey || f.createId();
    let demandId = obj.data.demandId;
    let subscr = obj.data.subscription;
    let isites;
    let sql;
    let n = 0;

    try {
        if (clear) {
            await f.datasource.request({
                client: obj.client,
                data: {updateOrders: false},
                method: "POST",
                name: "doClearAllocations"
            }, true);
        }

        let fltr = {criteria: [{
            property: "status",
            operator: "!=",
            value: "C"
        }]};

        if (demandId) {
            fltr.criteria.push({
                property: "id",
                value: demandId
            });
        }

        dmds = await f.datasource.request({
            client: obj.client,
            filter: fltr,
            method: "GET",
            name: "Demand",
            properties: [
                "number",
                "created",
                "dueDate",
                "id",
                "item",
                "number",
                "objectType",
                "quantityDue",
                "allocated",
                "site",
                "links"
            ],
            isForUpdate: true
        }, true);

        let fltr1 = {criteria: [{
            property: "status",
            operator: "!=",
            value: "C"
        }, {
            property: "quantity",
            operator: ">",
            value: "0"
        }]};
        let fltr2;

        if (!dmds.length) {
            return Promise.resolve([], []);
        }

        if (demandId) {
            fltr1.criteria.push({
                property: "item.id",
                value: dmds[0].item.id
            }, {
                property: "site.id",
                value: dmds[0].site.id
            });
            fltr2 = {criteria: [{
                property: "supply.item.id",
                value: dmds[0].item.id
            }, {
                property: "supply.site.id",
                value: dmds[0].site.id
            }]};
        }

        sups = await f.datasource.request({
            client: obj.client,
            filter: fltr1,
            method: "GET",
            name: "Supply",
            properties: [
                "created",
                "dueDate",
                "id",
                "item",
                "objectType",
                "quantity",
                "site",
                "allocated"
            ],
            isForUpdate: true
        }, true);

        allc = await f.datasource.request({
            client: obj.client,
            filter: fltr2,
            method: "GET",
            name: "Allocation",
            properties: [
                "demand",
                "id",
                "quantity",
                "supply",
                "salesDemand",
                "salesOrder"
            ],
            isForUpdate: true
        }, true);

        let requests = [];
        let alc;

        requests = [];
        dmds.sort(byTypeDate);
        sups.sort(byTypeDate);

        dmds = dmds.filter((r) => r.quantityDue > r.allocated);
        sups = sups.filter((r) => r.quantity > r.allocated);

        if (!dmds.length) {
            return Promise.resolve([], []);
        }

        // Only allocate demands that are plan to order or make to order
        sql = (
            "SELECT iz.planning_policy, i.id AS item_id, s.id AS site_id " +
            "FROM item_site iz " +
            "  JOIN demand d ON d._item_item_pk=iz._item_item_pk " +
            "    AND d._site_site_pk=iz._site_site_pk " +
            "  JOIN item i ON i._pk=iz._item_item_pk " +
            "  JOIN site s ON s._pk=iz._site_site_pk " +
            "WHERE d.id IN (" +
            dmds.map(function () {
                n += 1;
                return "$" + n;
            }).toString() + ");"
        );
        isites = await obj.client.query(sql, dmds.map((d) => d.id));

        dmds = dmds.filter(function (d) {
            let is = isites.rows.find((i) => (
                i.item_id === d.item.id &&
                i.site_id === d.site.id
            ));
            return is.planning_policy !== "R";
        });

        // Determine demand orders affected
        n = 0;
        let wdmds = dmds.filter(
            (d) => d.objectType === "WorkOrderRequirement"
        ).map((d) => d.id);
        let soldmds = dmds.filter(
            (d) => d.objectType === "SalesOrderLine"
        ).map((d) => d.id);
        let sordmds = dmds.filter(
            (d) => d.objectType === "SalesOrderRequirement"
        ).map((d) => d.id);

        dmds.forEach(function (d) {
            let s;
            let reqd;
            let avail;
            let qty;
            let slist = sups.filter(
                (su) => (
                    su.item.id === d.item.id &&
                    su.site.id === d.site.id &&
                    su.allocated < su.quantity
                )
            );

            function existingAllocation(a) {
                return (
                    a.supply && a.supply.id === s.id &&
                    a.demand && a.demand.id === d.id
                );
            }

            while (d.allocated < d.quantityDue && slist.length) {
                s = slist.shift();
                alc = allc.find(existingAllocation);
                reqd = d.quantityDue.minus(d.allocated);
                avail = s.quantity.minus(s.allocated);
                qty = Math.min(avail, reqd);

                if (alc) {
                    alc.quantity = alc.quantity.plus(qty);
                    requests.push({
                        client: obj.client,
                        data: [{
                            op: "replace",
                            path: "/quantity",
                            value: alc.quantity
                        }],
                        eventKey: eKey,
                        id: alc.id,
                        method: "PATCH",
                        name: "Allocation"
                    });
                } else {
                    alc = {
                        id: f.createId(),
                        supply: s,
                        demand: d,
                        quantity: qty
                    };
                    if (d.links && d.links.salesDemandId) {
                        alc.salesDemand = {id: d.links.salesDemandId};
                        alc.salesOrder = {id: d.links.salesOrderId};
                    }
                    allc.push(alc);
                    requests.push({
                        client: obj.client,
                        data: alc,
                        id: alc.id,
                        method: "POST",
                        name: "Allocation"
                    });
                }

                //console.log("Handled nr ", d.number, " QTY:", qty);
                s.allocated = s.allocated.plus(qty);
                d.allocated = d.allocated.plus(qty);
            }
        });

        if (wdmds.length) {
            requests.push({
                client: obj.client,
                data: {requirementIds: wdmds},
                method: "POST",
                name: "doUpdateWorkOrderPlanStatus"
            });
        }

        if (soldmds.length || sordmds.length) {
            requests.push({
                client: obj.client,
                data: {lineIds: soldmds, requirementIds: sordmds},
                method: "POST",
                name: "doUpdateSalesOrderPlanStatus"
            });
        }

        let process = f.datasource.createProcess({
            client: obj.client,
            count: requests.length,
            name: "Create allocations",
            subscription: subscr
        });
        await process.start();

        let payload;
        while (requests.length) {
            payload = requests.shift();
            await f.datasource.request(payload, true);
            await process.next();
        }

        await f.datasource.unlock({
            username: obj.client.currentUser(),
            eventKey: eKey
        }, obj.client);

        await process.complete();

        return "Allocations created";
    } catch (e) {
        // Unlock involved records
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doCreateAllocations",
    doCreateAllocations
);