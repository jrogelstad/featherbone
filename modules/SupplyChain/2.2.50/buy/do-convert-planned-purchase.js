/*jslint unordered*/
/*global console*/

async function doConvertPlannedPurchase(obj) {
    let d = obj.data;
    let eKey = f.createId();
    let plns;
    let supp;
    let emp;
    let po;
    let allocs;
    let site;
    let i = 0;
    let id;
    let woreqs = [];
    let solines = [];
    let soreqs = [];
    let osps = [];

    try {
        plns = await f.datasource.request({
            method: "GET",
            name: "PlannedPurchase",
            client: obj.client,
            filter: {
                criteria: [{
                    property: "id",
                    operator: "IN",
                    value: d.ids
                }]
            }
        }, true);

        supp = await f.datasource.request({
            method: "GET",
            name: "Supplier",
            client: obj.client,
            id: d.supplierId
        }, true);

        emp = await f.datasource.request({
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
        emp = emp[0];

        allocs = await f.datasource.request({
            method: "GET",
            name: "Allocation",
            client: obj.client,
            filter: {
                criteria: [{
                    property: "supply.id",
                    operator: "IN",
                    value: d.ids
                }]
            }
        }, true);

        if (d.purchaseOrderId) {
            await f.datasource.lock(
                d.purchaseOrderId,
                obj.client.currentUser(),
                eKey,
                "Converting planned purchases",
                obj.client
            );

            po = await f.datasource.request({
                method: "GET",
                name: "PurchaseOrder",
                client: obj.client,
                id: d.purchaseOrderId
            }, true);
        }

        while (i < d.ids.length) {
            id = d.ids[i];
            i += 1;
            await f.datasource.lock(
                id,
                obj.client.currentUser(),
                eKey,
                "Converting planned purchases",
                obj.client
            );
        }

        if (d.purchaseOrderId && !po) {
            return Promise.reject("Purchase order not found");
        }

        if (po && po.status === "C") {
            return Promise.reject(
                "Purchase order " + po.number + " is closed"
            );
        }

        if (!plns.length) {
            return Promise.reject("Planned orders not found");
        }

        site = await f.datasource.request({
            method: "GET",
            name: "Site",
            properties: ["id", "address", "billTo"],
            client: obj.client,
            id: plns[0].site.id
        }, true);

        let poId = d.purchaseOrderId || f.createId();
        let nr = (
            po
            ? po.lines.length
            : 1
        );
        let plndate;
        let requests = [];

        if (!po) {
            plns.forEach(function (pl) {
                if (!plndate || plndate > pl.dueDate) {
                    plndate = pl.dueDate;
                }
            });
            po = {
                id: poId,
                supplier: supp,
                contact: supp.contact,
                currency: supp.currency,
                terms: supp.terms,
                shipMethod: supp.shipMethod,
                incoTerms: supp.incoTerms,
                site: plns[0].site,
                buyer: emp,
                orderDate: f.today(),
                shipTo: site.address,
                billTo: site.billTo,
                plannedDelivery: plndate,
                owner: obj.client.currentUser(),
                lines: [],
                status: "P"
            };
        }

        // Silently remove previous allocations
        let c = 0;
        let item;
        const sql1 = "UPDATE planned_purchase SET allocated=0 WHERE id=$1";
        const sql2 = "DELETE FROM allocation WHERE id=$1;";
        const sql3 = "UPDATE demand SET allocated = allocated - $1 WHERE id=$2";
        while (c < d.ids.length) {
            item = d.ids[c];
            await obj.client.query(sql1, [item]);
            c += 1;
        }
        c = 0;
        while (c < allocs.length) {
            item = allocs[c];
            await obj.client.query(sql2, [item.id]);
            await obj.client.query(sql3, [item.quantity, item.demand.id]);
            c += 1;
        }

        // Process in order selected
        d.ids.forEach(function (id) {
            let pl = plns.find((p) => p.id === id);
            let alcs = allocs.filter((a) => a.supply.id === id);
            let lnId = f.createId();

            if (pl) {
                po.lines.push({
                    id: lnId,
                    line: nr,
                    item: pl.item,
                    site: pl.site,
                    ordered: pl.orderQuantity,
                    unit: pl.unit,
                    ratio: pl.ratio,
                    quantity: pl.quantity,
                    price: pl.price,
                    supplierItem: pl.supplierItem,
                    manufacturer: pl.manufacturer,
                    manufacturerItem: pl.manufacturerItem,
                    plannedDelivery: pl.dueDate,
                    owner: obj.client.currentUser(),
                    description: pl.description || pl.item.description,
                    requestedBy: pl.requestedBy,
                    salesDemand: pl.salesDemand,
                    salesOrder: pl.salesOrder,
                    status: (
                        po.status === "B"
                        ? "A"
                        : po.status
                    )
                });
                nr += 1;

                requests.push({
                    method: "DELETE",
                    name: "PlannedPurchase",
                    id: pl.id,
                    eventKey: eKey,
                    client: obj.client
                });

                // Move allocs to p/o
                alcs.forEach(function (alc) {
                    switch (alc.demand.objectType) {
                    case "OutsideProcess":
                        osps.push(alc.demand.id);
                        break;
                    case "SalesOrderLine":
                        solines.push(alc.demand.id);
                        break;
                    case "SalesOrderRequirement":
                        soreqs.push(alc.demand.id);
                        break;
                    case "WorkOrderRequirement":
                        woreqs.push(alc.demand.id);
                        break;
                    }
                    requests.push({
                        method: "POST",
                        name: "Allocation",
                        client: obj.client,
                        data: {
                            supply: {id: lnId},
                            demand: alc.demand,
                            quantity: alc.quantity,
                            isFirm: alc.isFirm
                        }
                    });
                });
            }
        });

        requests.unshift({
            method: "POST",
            name: d.feather || "PurchaseOrder",
            client: obj.client,
            user: obj.client.currentUser(),
            id: poId,
            eventKey: eKey,
            data: po
        });

        if (woreqs.length) {
            requests.push({
                client: obj.client,
                data: {requirementIds: woreqs},
                method: "POST",
                name: "doUpdateWorkOrderPlanStatus"
            });
        }

        if (osps.length) {
            requests.push({
                client: obj.client,
                data: {outsideProcessIds: osps},
                method: "POST",
                name: "doUpdateWorkOrderPlanStatus"
            });
        }

        if (solines.length || soreqs.length) {
            requests.push({
                client: obj.client,
                data: {lineIds: solines, requirementIds: soreqs},
                method: "POST",
                name: "doUpdateSalesOrderPlanStatus"
            });
        }

        while (requests.length) {
            await f.datasource.request(requests.shift(), true);
        }
        return poId;
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doConvertPlannedPurchase",
    doConvertPlannedPurchase
);