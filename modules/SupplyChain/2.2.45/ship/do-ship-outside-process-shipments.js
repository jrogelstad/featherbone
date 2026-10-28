/*jslint browser devel unordered*/
/*global console*/
const pending = [];

function doShip(obj) {
    return new Promise(function (resolve, reject) {
        let ids = obj.data.ids || [obj.data.id];
        let pdate = obj.shipDate || f.today();
        let shipments;
        let settings;
        let pos;
        let eKey = f.createId();
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
                    name: "OutsideProcessShipment",
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

        function fetchPurchaseOrders(resp) {
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
                    name: "PurchaseOrder",
                    client: obj.client,
                    properties: [
                        "id",
                        "lines",
                        "number"
                    ],
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: shipments.map((s) => s.purchaseOrder.id)
                        }]
                    }
                }, true)
            );

            // Lock involved shipments and purchase orders
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
                        shpmt.purchaseOrder.id,
                        obj.client.currentUser(),
                        eKey,
                        "Ship shipment",
                        obj.client
                    )
                );
            });

            return Promise.all(requests);
        }

        function createLabels(resp) {
            pos = resp[0];

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
            let shipment;
            let poTx;
            let shipData;
            let po;
            let line;
            let poLine;
            let idx;
            let alloc;
            let allocs;
            let sql1 = (
                "SELECT wo.id AS wo_id, wo.status AS wo_status, " +
                "  woop.id AS woop_id " +
                "FROM outside_process osp " +
                "  JOIN work_order_operation woop " +
                "    ON woop._pk=" +
                "    osp._work_order_operation_work_order_operation_pk " +
                "  JOIN work_order wo " +
                "    ON wo._pk=woop._work_order_work_order_pk " +
                "WHERE osp.id=$1 "
            );
            let wos;
            let wo;

            try {
                while (shipments.length) {
                    shipment = shipments.shift();
                    poTx = {
                        method: "PATCH",
                        name: "PurchaseOrder",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        id: shipment.purchaseOrder.id,
                        eventKey: eKey,
                        data: []
                    };
                    po = pos.find((s) => s.id === shipment.purchaseOrder.id);

                    if (!shipment.lines.some((ln) => ln.quantity > 0)) {
                        return Promise.reject(
                            "At least one line must have a " +
                            "quantity greater than zero"
                        );
                    }

                    while (shipment.lines.length) {
                        line = shipment.lines.shift();
                        poLine = po.lines.find(
                            (ln) => ln.id === line.purchaseOrderLine.id
                        );

                        if (line.quantity < 0) {
                            return Promise.reject(
                                "Line quantity must be positive"
                            );
                        }

                        if (line.quantity) {
                            // Update outside process
                            allocs = await f.datasource.request({
                                client: obj.client,
                                filter: {criteria: [{
                                    property: "supply.id",
                                    value: poLine.id
                                }]},
                                method: "GET",
                                name: "Allocation",
                                properties: ["id", "demand"]
                            }, true);

                            if (!allocs.length) {
                                return Promise.reject(
                                    "Work order allocation for " +
                                    "service not found"
                                );
                            }

                            if (allocs.length > 1) {
                                return Promise.reject(
                                    "Something went wrong. " +
                                    "More than one allocation " +
                                    "found for service. " +
                                    "Contact your administrator."
                                );
                            }

                            alloc = allocs[0];
                            await obj.client.query(
                                "UPDATE outside_process op " +
                                "SET shipped = shipped + $1, " +
                                "  status = 'I', " +
                                "  updated = now(), " +
                                "  updated_by = $3 " +
                                "WHERE op.id=$2;",
                                [
                                    line.quantity,
                                    alloc.demand.id,
                                    obj.client.currentUser()
                                ]
                            );

                            wos = await obj.client.query(
                                sql1,
                                [alloc.demand.id]
                            );
                            wo = wos.rows[0];

                            if (!wo) {
                                return Promise.reject(
                                    "Work order operation not found"
                                );
                            }

                            if (wo.wo_status === "P") {
                                // Force release if not already
                                await f.datasource.request({
                                    client: obj.client,
                                    data: [{
                                        op: "replace",
                                        path: "/status",
                                        value: "A"
                                    }],
                                    id: wo.wo_id,
                                    method: "PATCH",
                                    name: "WorkOrder"
                                }, true);
                            }

                            await f.datasource.request({
                                client: obj.client,
                                data: {
                                    employee: shipment.employee,
                                    operation: {id: wo.woop_id},
                                    quantity: line.quantity,
                                    startOperation: true
                                },
                                method: "POST",
                                name: "OperationCompletion"
                            }, true);

                            idx = po.lines.indexOf(poLine);
                            poLine.shipped = poLine.shipped.plus(line.quantity);

                            poTx.data.push({
                                op: "replace",
                                path: `/lines/${idx}/shipped`,
                                value: poLine.shipped
                            });
                        }
                    }

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

                    trans.push(poTx);
                }

                // Execute it all
                while (trans.length) {
                    await f.datasource.request(
                        trans.shift(),
                        true
                    );
                }
            } catch (err) {
                return Promise.reject(err);
            } finally {
                ids.forEach(function (id) {
                    pending.splice(pending.indexOf(id), 1);
                });
            }
        }

        Promise.resolve().then(
            fetchShipments
        ).then(
            fetchPurchaseOrders
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
    "doShipOutsideProcessShipments",
    doShip
);