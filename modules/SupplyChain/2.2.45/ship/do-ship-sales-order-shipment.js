/*jslint browser devel unordered*/
/*global console*/
const pending = [];

function doShip(obj) {
    return new Promise(function (resolve, reject) {
        let ids = obj.data.ids || [obj.data.id];
        let pdate = obj.shipDate || f.today();
        let shipments;
        let settings;
        let sos;
        let eKey = f.createId();
        let itemSites;
        let e;

        ids.forEach(function (id) {
            if (pending.indexOf(id) !== -1) {
                e = "Shipment is already in shipping process";
            }
        });
        if (e) {
            reject(e);
            return;
        }
        ids.forEach(function (id) {
            pending.push(id);
        });

        function doReject(e) {
            ids.forEach(function (id) {
                pending.splice(pending.indexOf(id), 1);
            });
            reject(e);
        }

        function fetchShipments() {
            return Promise.all([
                f.datasource.request({
                    method: "GET",
                    name: "SalesOrderShipment",
                    user: obj.client.currentUser(),
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: ids
                        }, {
                            property: "status",
                            operator: "IN",
                            value: ["P", "R"]
                        }]
                    }
                }, true),
                f.datasource.request({
                    method: "GET",
                    name: "getSettings",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: {name: "shipEngineSettings"}
                }, true)
            ]);
        }

        function fetchSalesOrders(resp) {
            let requests = [];

            shipments = resp[0];
            settings = resp[1] || {createLabelOnShip: false};

            if (shipments.some((s) => !s.shippedBy)) {
                return Promise.reject(
                    "Shipments require a Shipped By assignment"
                );
            }

            requests.push(
                f.datasource.request({
                    method: "GET",
                    name: "SalesOrder",
                    user: obj.client.currentUser(),
                    client: obj.client,
                    properties: [
                        "id",
                        "lines",
                        "number",
                        "requestedDate",
                        "onHold"
                    ],
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: shipments.map((s) => s.salesOrder.id)
                        }]
                    }
                }, true)
            );

            // Lock involved shipments and sales orders
            shipments.forEach(function (shpmt) {
                requests.push(
                    f.datasource.lock(
                        shpmt.id,
                        obj.client.currentUser(),
                        eKey,
                        "Ship shipment",
                        obj.client
                    ),
                    f.datasource.lock(
                        shpmt.salesOrder.id,
                        obj.client.currentUser(),
                        eKey,
                        "Ship shipment",
                        obj.client
                    )
                );
            });

            return Promise.all(requests);
        }

        function fetchItemSites(resp) {
            sos = resp[0];
            let itemIds = [];
            let siteIds = [];
            let err;

            function addIds(row) {
                if (itemIds.indexOf(row.item.id) === -1) {
                    itemIds.push(row.item.id);
                }
                if (siteIds.indexOf(row.site.id) === -1) {
                    siteIds.push(row.site.id);
                }
            }

            sos.forEach(function (so) {
                so.lines.forEach(function (ln) {
                    addIds(ln);
                    ln.materials.forEach(addIds);
                });
            });

            if (sos.some(function (s) {
                let early = s.requestedDate > f.today();
                let dt;
                if (s.onHold) {
                    err = "Sales order " + s.number + " is on hold ";
                    return true;
                }
                if (early) {
                    dt = f.parseDate(s.requestedDate);
                    err = (
                        "Sales order " +
                        s.number +
                        " can not be shipped before its requested date of " +
                        dt.toLocaleDateString()
                    );
                    return true;
                }
                return false;
            })) {
                return Promise.reject(err);
            }

            return f.datasource.request({
                method: "GET",
                name: "ItemSite",
                properties: [
                    "id",
                    "item",
                    "site",
                    "defaultLocation",
                    "wipLocation",
                    "planningPolicy"
                ],
                client: obj.client,
                user: obj.client.currentUser(),
                filter: {criteria: [{
                    property: "item.id",
                    operator: "IN",
                    value: itemIds
                }, {
                    property: "site.id",
                    operator: "IN",
                    value: siteIds
                }]}
            }, true);
        }

        function createLabels(resp) {
            itemSites = resp;

            if (!settings.createLabelOnShip) {
                return Promise.resolve();
            }

            function createLabel(shpt) {
                return new Promise(function (resolve, reject) {
                    if (
                        shpt.labelId || // Already has one
                        shpt.shipMethod === null ||
                        shpt.shipMethod.objectType !== "ShipEngineService"
                    ) {
                        resolve();
                        return;
                    }

                    function callback(resp) {
                        let curr;
                        if (resp) {
                            curr = resp.shipmentCost.currency.toUpperCase();
                            shpt.trackingNumber = resp.trackingNumber;
                            shpt.labelUrl = resp.labelDownload.pdf;
                            shpt.labelId = resp.labelId;
                            shpt.freightCharges = {
                                amount: resp.shipmentCost.amount,
                                currency: curr
                            };
                        }
                        resolve();
                    }

                    f.datasource.request({
                        method: "POST",
                        name: "doCreateShipmentLabel",
                        client: obj.client,
                        data: {shipment: shpt}
                    }).then(callback).catch(reject);
                });
            }

            return Promise.all(shipments.map(createLabel));
        }

        async function process() {
            let trans = [];
            let err;

            function findSol(dat) {
                let so = sos.find((s) => s.id === dat.soId);
                return so.lines.find((ln) => ln.id === dat.lineId);
            }

            function processCosts(dat) {
                let sol = findSol(dat);
                let idx;
                let lbrcst = sol.actualLaborCost.amount;
                let matcst = sol.actualMaterialCost.amount;
                let ovrcst = sol.actualOverheadCost.amount;
                let svccst = sol.actualServiceCost.amount;
                let ttlcst = 0;

                // Credit an item's cost to the buckets it is made of, as
                // work order postings do. Whatever the buckets do not
                // account for stays in material, so the amount credited
                // is always the item's cost times the quantity. Shipping
                // used to put all of it in material, so labor and
                // overhead never appeared on a sales order line.
                function addItemCost(item, qty) {
                    let mat = (
                        item.materialCost
                        ? item.materialCost.amount
                        : 0
                    );
                    let lbr = item.laborCost ? item.laborCost.amount : 0;
                    let ovr = (
                        item.overheadCost
                        ? item.overheadCost.amount
                        : 0
                    );
                    let svc = (
                        item.serviceCost
                        ? item.serviceCost.amount
                        : 0
                    );
                    let rest = item.cost.amount.minus(
                        mat
                    ).minus(lbr).minus(ovr).minus(svc);

                    matcst = matcst.plus(qty.times(mat.plus(rest)));
                    lbrcst = lbrcst.plus(qty.times(lbr));
                    ovrcst = ovrcst.plus(qty.times(ovr));
                    svccst = svccst.plus(qty.times(svc));
                }

                if (err) {
                    reject(err);
                    return;
                }

                let matls = sol.materials.filter(
                    (m) => m.status !== "C"
                );
                matls.forEach(function (matl) {
                    let is;
                    let loc;
                    let toIss;
                    let doneQty;
                    idx = sol.materials.indexOf(matl);

                    if (matl.item.trace !== "N") {
                        return;  // Don't backflush traced
                    }

                    is = itemSites.find(
                        (r) => (
                            r.site.id === matl.site.id &&
                            r.item.id === matl.item.id
                        )
                    );

                    if (dat.site.locationControlled) {
                        loc = (
                            is.wipLocation ||
                            dat.site.defaultWipLocation ||
                            is.defaultLocation ||
                            dat.site.defaultLocation
                        );
                    }

                    doneQty = dat.shipped;

                    toIss = doneQty.times(
                        matl.quantityPer
                    );

                    if (!matl.issued) {
                        toIss = toIss.plus(
                            matl.fixedQuantity
                        );
                    }

                    if (
                        !matl.item.isFractional &&
                        Math.ceil(toIss) !== toIss
                    ) {
                        toIss = Math.ceil(toIss);
                    }

                    if (toIss) {
                        matl.issued = matl.issued.plus(toIss);
                        addItemCost(is.item, toIss);

                        // Reduce allocations
                        if (is.planningPolicy !== "R") {
                            trans.push({
                                client: obj.client,
                                method: "POST",
                                name: "doTransactAllocated",
                                user: obj.client.currentUser(),
                                data: {
                                    id: matl.id,
                                    quantity: toIss,
                                    type: "demand",
                                    updatePlanStatus: false
                                }
                            });
                        }

                        trans.push({
                            method: "POST",
                            name: "InventoryTransaction",
                            client: obj.client,
                            user: obj.client.currentUser(),
                            data: {
                                id: f.createId(),
                                reference: matl.number,
                                document: dat.shipNr,
                                type: "Sales Order Issue",
                                date: pdate,
                                item: matl.item,
                                site: dat.site,
                                quantity: toIss.times(-1),
                                location: loc
                            }
                        });
                        dat.patch.data.push({
                            op: "replace",
                            path: (
                                "/lines/" + dat.lineIndex +
                                "/materials/" + idx + "/issued"
                            ),
                            value: matl.issued
                        });
                    }
                });

                // The item shipped carries its own cost, by bucket
                let solSite = itemSites.find(
                    (r) => (
                        r.site.id === sol.site.id &&
                        r.item.id === sol.item.id
                    )
                );
                addItemCost(
                    (
                        solSite
                        ? solSite.item
                        : sol.item
                    ),
                    dat.shipped
                );

                // Update actual cost. The total is always the sum of the
                // four buckets. It used to start at zero and add only the
                // buckets that changed, and labor, overhead and service
                // never changed here, so it ignored them.
                ttlcst = lbrcst.plus(ovrcst).plus(matcst).plus(svccst);
                if (sol.actualLaborCost.amount !== lbrcst) {
                    dat.patch.data.push({
                        op: "replace",
                        path: (
                            "/lines/" + dat.lineIndex +
                            "/actualLaborCost"
                        ),
                        value: {
                            currency: sol.actualLaborCost.currency,
                            amount: lbrcst
                        }
                    });
                }
                if (sol.actualOverheadCost.amount !== ovrcst) {
                    dat.patch.data.push({
                        op: "replace",
                        path: (
                            "/lines/" + dat.lineIndex +
                            "/actualOverheadCost"
                        ),
                        value: {
                            currency: sol.actualOverheadCost.currency,
                            amount: ovrcst
                        }
                    });
                }
                if (sol.actualServiceCost.amount !== svccst) {
                    dat.patch.data.push({
                        op: "replace",
                        path: (
                            "/lines/" + dat.lineIndex +
                            "/actualServiceCost"
                        ),
                        value: {
                            currency: sol.actualServiceCost.currency,
                            amount: svccst
                        }
                    });
                }
                if (sol.actualMaterialCost.amount !== matcst) {
                    dat.patch.data.push({
                        op: "replace",
                        path: (
                            "/lines/" + dat.lineIndex +
                            "/actualMaterialCost"
                        ),
                        value: {
                            currency: sol.actualMaterialCost.currency,
                            amount: matcst
                        }
                    });
                }
                if (sol.actualTotalCost.amount !== ttlcst) {
                    dat.patch.data.push({
                        op: "replace",
                        path: (
                            "/lines/" + dat.lineIndex +
                            "/actualTotalCost"
                        ),
                        value: {
                            currency: sol.actualTotalCost.currency,
                            amount: ttlcst
                        }
                    });
                }
            }

            shipments.forEach(function (shipment) {
                let soStatus = "C";
                let soTx = {
                    method: "PATCH",
                    name: "SalesOrder",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: shipment.salesOrder.id,
                    eventKey: eKey,
                    data: []
                };
                let shipData;
                let so = sos.find((s) => s.id === shipment.salesOrder.id);

                shipment.lines.forEach(function (line) {
                    let qty = 0;
                    let soLine = findSol({
                        soId: shipment.salesOrder.id,
                        lineId: line.salesOrderLine.id
                    });
                    let idx;
                    let is = itemSites.find(
                        (r) => (
                            r.site.id === soLine.site.id &&
                            r.item.id === soLine.item.id
                        )
                    );

                    if (line.quantity < 0) {
                        err = "Line quantity must be positive";
                        return;
                    }

                    if (line.quantity > 0) {
                        if (
                            shipment.site.locationControlled ||
                            line.item.trace !== "N"
                        ) {
                            if (!line.details.length) {
                                err = (
                                    "Shipment line requires detail records"
                                );
                                return;
                            }

                            line.details.forEach(function (row) {
                                qty = qty.plus(row.quantity);
                            });

                            if (qty !== line.quantity) {
                                err = (
                                    "Shipment line quantity must " +
                                    "match detail"
                                );
                                return;
                            }
                        } else {
                            qty = line.quantity;
                        }
                    }

                    if (!qty) {
                        return;
                    }

                    idx = so.lines.indexOf(soLine);
                    soLine.shipped = soLine.shipped.plus(qty);

                    soTx.data.push({
                        op: "replace",
                        path: `/lines/${idx}/shipped`,
                        value: soLine.shipped
                    });

                    // Process cost & assemble to order data
                    if (line.quantity) {
                        processCosts({
                            soId: shipment.salesOrder.id,
                            lineId: soLine.id,
                            lineIndex: idx,
                            shipped: line.quantity,
                            patch: soTx,
                            site: shipment.site,
                            shipNr: shipment.number
                        });

                        let disc = 1;
                        let one = 1;
                        if (soLine.discount) {
                            disc = one.minus(disc.times(0.01));
                        }
                    }

                    // Transact shipped item if it's inventory
                    if (line.item.type === "I") {
                        // Reduce allocations
                        if (is.planningPolicy !== "R") {
                            trans.push({
                                client: obj.client,
                                method: "POST",
                                name: "doTransactAllocated",
                                user: obj.client.currentUser(),
                                data: {
                                    id: soLine.id,
                                    quantity: line.quantity,
                                    type: "demand",
                                    updatePlanStatus: false
                                }
                            });
                        }

                        if (!line.details.length) {
                            trans.push({
                                method: "POST",
                                name: "InventoryTransaction",
                                client: obj.client,
                                user: obj.client.currentUser(),
                                data: {
                                    id: f.createId(),
                                    document: shipment.number,
                                    reference: line.salesOrderLine.number,
                                    type: "Shipment",
                                    date: pdate,
                                    item: line.item,
                                    site: shipment.site,
                                    quantity: line.quantity.times(-1)
                                }
                            });
                        } else {
                            line.details.forEach(function (row) {
                                trans.push({
                                    method: "POST",
                                    name: "InventoryTransaction",
                                    client: obj.client,
                                    user: obj.client.currentUser(),
                                    data: {
                                        id: f.createId(),
                                        document: shipment.number,
                                        reference:
                                        line.salesOrderLine.number,
                                        type: "Shipment",
                                        date: pdate,
                                        item: line.item,
                                        site: shipment.site,
                                        quantity: row.quantity.times(-1),
                                        location: row.location,
                                        trace: row.trace
                                    }
                                });
                            });
                        }
                    }
                });

                shipData = [{
                    op: "replace",
                    path: "/status",
                    value: "S"
                }, {
                    op: "replace",
                    path: "/shipDate",
                    value: pdate
                }];

                if (shipment.labelId) {
                    shipData.push({
                        op: "replace",
                        path: "/labelId",
                        value: shipment.labelId
                    }, {
                        op: "replace",
                        path: "/labelUrl",
                        value: shipment.labelUrl
                    }, {
                        op: "replace",
                        path: "/trackingNumber",
                        value: shipment.trackingNumber
                    }, {
                        op: "replace",
                        path: "/freightCharges",
                        value: shipment.freightCharges
                    });
                }

                trans.push({
                    method: "PATCH",
                    name: "Shipment",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: shipment.id,
                    eventKey: eKey,
                    data: shipData
                });

                so.lines.some(function (line) {
                    if (line.shipped < line.ordered) {
                        soStatus = "A";
                        return true;
                    }
                });

                soTx.data.push({
                    op: "replace",
                    path: "/status",
                    value: soStatus
                });
                trans.push(soTx);
                trans.push({
                    client: obj.client,
                    data: {id: soTx.id},
                    method: "POST",
                    name: "doUpdateSalesOrderPlanStatus"
                });
            });

            if (err) {
                return Promise.reject(err);
            }

            try {
                // Execute it all
                while (trans.length) {
                    await f.datasource.request(
                        trans.shift(),
                        true
                    );
                }
            } catch (terr) {
                return Promise.reject(terr);
            } finally {
                ids.forEach(function (id) {
                    pending.splice(pending.indexOf(id), 1);
                });
            }
        }

        Promise.resolve().then(
            fetchShipments
        ).then(
            fetchSalesOrders
        ).then(
            fetchItemSites
        ).then(
            createLabels
        ).then(
            process
        ).then(
            resolve.bind(null, "Shipment(s) shipped successfully")
        ).catch(
            doReject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doShipSalesOrderShipment",
    doShip
);