/*jslint browser devel unordered*/
/*global console*/
/*
    What a receipt line is worth: the quantity received at the order
    line's unit price, kept on the line so the figure the dashboard shows
    and the receipts behind it are the same numbers. A later price change
    on the order does not reach back into a receipt that has been posted.

    It is money, so it says it twice (John, Oct 2026): `amount` in the
    order's own currency -- what the supplier will be paid for it -- and
    `baseAmount` in the currency the books are kept in, converted with
    the framework's convertCurrency at the rate in force the day the
    receipt is posted. `effective` is that day, which is what marks the
    base amount as settled rather than to be converted again at whatever
    the rate is when somebody looks. The dashboard adds up the base
    amount; the difference between it and the standard cost the
    inventory transaction carries is the purchase price variance.

    A missing rate stops the post with the framework's own message, as it
    does anywhere else a value is converted.

    Same arithmetic as the fill-in for receipts that predate the
    property (receipt-line-amounts.js): quantity / ordered of the line's
    amount, to the cent, then the day's rate for the base amount.
*/
async function receiptLineAmount(quantity, poLine, date, client) {
    const SCALE = 2;
    let paid = poLine.amount;
    let share;
    let base;

    if (!paid || !paid.currency) {
        return null;
    }

    share = (
        (
            poLine.ordered &&
            paid.amount !== null &&
            paid.amount !== undefined
        )
        ? Number(quantity).times(paid.amount).div(poLine.ordered).round(SCALE)
        : 0
    );
    base = await f.datasource.request({
        client,
        data: {
            amount: share,
            effective: date,
            fromCurrency: paid.currency
        },
        method: "GET",
        name: "convertCurrency"
    }, true);

    return {
        amount: share,
        baseAmount: base.amount,
        currency: paid.currency,
        effective: date
    };
}

function doPost(obj) {
    return new Promise(function (resolve, reject) {
        let ids = obj.data.ids || [obj.data.id];
        let pdate = obj.shipDate || f.today();
        let receipts;
        let traced = [];
        let eKey = f.createId();

        function doReject(e) {
            let rcpt;
            let theUser = obj.client.currentUser();
            let theTenant = obj.client.tenant();

            if (receipts) {
                obj.client.onRollback(async function () {
                    // Do we ever post multiple?
                    f.datasource.request({
                        method: "POST",
                        name: "Alert",
                        user: theUser,
                        data: {
                            category: "Purchase Order Receipt",
                            severity: "Warning",
                            message: (
                                "One or more purchase receipts " +
                                "failed to post " +
                                "due to the following error: " +
                                e
                            ),
                            relation: (
                                (receipts && receipts.length)
                                ? {
                                    code: receipts[0].number,
                                    id: receipts[0].id,
                                    objectType: "PurchaseOrderReceipt"
                                }
                                : undefined
                            )
                        },
                        tenant: theTenant
                    }, true);

                    while (receipts.length) {
                        rcpt = receipts.shift();

                        await f.datasource.request({
                            method: "PATCH",
                            name: "PurchaseOrderReceipt",
                            user: theUser,
                            id: rcpt.id,
                            data: [{
                                op: "replace",
                                path: "/error",
                                value: e
                            }],
                            tenant: theTenant
                        });
                    }
                });
            }
            reject(e);
        }

        // Wait for any other transaction working on these receipts
        // before reading them. The wait is a transaction-scoped advisory
        // lock, the same one f.datasource.lock takes first, so it is
        // released when this transaction ends and leaves no record
        // locked behind. Without it a second post of the same receipt
        // read status "P" before the first had committed, then waited at
        // the lock below and posted the inventory again. Sorted so
        // overlapping posts cannot deadlock each other.
        async function waitForReceipts() {
            let sorted = ids.slice().sort();
            let n = 0;

            while (n < sorted.length) {
                await obj.client.query(
                    "SELECT pg_advisory_xact_lock(_pk) " +
                    "FROM object WHERE id = $1",
                    [sorted[n]]
                );
                n += 1;
            }
        }

        function fetchReceipts() {
            return new Promise(function (resolve, reject) {
                f.datasource.request({
                    method: "GET",
                    name: "PurchaseOrderReceipt",
                    user: obj.client.currentUser(),
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: ids
                        }, {
                            property: "status",
                            value: "P"
                        }]
                    },
                    properties: [
                        "id",
                        "number",
                        "purchaseOrder",
                        "site",
                        "lines"
                    ]
                }, true).then(resolve).catch(reject);
            });
        }

        function lock(resp) {
            let requests = [];
            let err;

            receipts = resp;
            function haveNoQty(receipt) {
                let invalid = !receipt.lines.some((ln) => ln.quantity > 0);
                if (invalid) {
                    err = (
                        "Purchase receipt " + receipt.number +
                        " has no quantity to post"
                    );
                }
                return invalid;
            }

            if (receipts.some(haveNoQty)) {
                reject(err);
                return;
            }

            // Lock involved receipts and purchase orders
            receipts.forEach(function (rcpt) {
                requests.push(
                    f.datasource.lock(
                        rcpt.id,
                        obj.client.currentUser(),
                        eKey,
                        "Post purchase order receipt",
                        obj.client
                    ),
                    f.datasource.lock(
                        rcpt.purchaseOrder.id,
                        obj.client.currentUser(),
                        eKey,
                        "Post purchase order receipt",
                        obj.client
                    )
                );
            });

            return Promise.all(requests);
        }

        function fetchTrc() {
            return new Promise(function (resolve, reject) {
                let requests = [];
                let next;

                receipts.forEach(function (rcpt) {
                    rcpt.lines.forEach(function (line) {
                        line.details.forEach(function (dtl) {
                            if (dtl.trace) {
                                requests.push({
                                    method: "GET",
                                    name: "Trace",
                                    client: obj.client,
                                    filter: {
                                        criteria: [{
                                            property: "number",
                                            value: dtl.trace
                                        }]
                                    }
                                });
                            }
                        });
                    });
                });

                function callback(resp) {
                    if (resp.length) {
                        traced.push(resp[0]);
                    }

                    next();
                }

                next = function () {
                    if (!requests.length) {
                        resolve();
                        return;
                    }

                    f.datasource.request(
                        requests.shift(),
                        true
                    ).then(callback).catch(reject);
                };

                next();
            });
        }

        async function process() {
            let trans = [];
            let po;
            let receipt;
            let i = 0;
            let poStatus;
            let poTx;
            let qty = 0;
            let poLine;
            let idx;
            let nr;
            let cn;
            let line;
            let j = 0;
            let allocs;
            let op;
            let emp;
            let amounts;
            let worth;

            function handleAllocations(supply, sqty) {
                let unalc;

                if (supply.allocated > 0) {
                    if (supply.allocated > sqty) {
                        unalc = sqty;
                    } else {
                        unalc = supply.allocated;
                    }
                }

                if (unalc) {
                    trans.push({
                        client: obj.client,
                        method: "POST",
                        name: "doTransactAllocated",
                        user: obj.client.currentUser(),
                        eventKey: eKey,
                        data: {
                            id: supply.id,
                            quantity: unalc,
                            type: "supply",
                            reallocate: true
                        }
                    });
                }
            }

            while (i < receipts.length) {
                receipt = receipts[i];
                i += 1;
                j = 0; // Each receipt starts at its own first line
                amounts = [];
                try {
                    po = await f.datasource.request({
                        method: "GET",
                        name: "PurchaseOrder",
                        client: obj.client,
                        id: receipt.purchaseOrder.id,
                        properties: ["id", "lines"]
                    }, true);
                } catch (e) {
                    return Promise.reject(e);
                }
                poStatus = "C";
                poTx = {
                    method: "PATCH",
                    name: "PurchaseOrder",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: receipt.purchaseOrder.id,
                    eventKey: eKey,
                    data: []
                };

                while (j < receipt.lines.length) {
                    line = receipt.lines[j];
                    j += 1;
                    qty = 0;

                    poLine = po.lines.find(
                        (ln) => ln.id === line.purchaseOrderLine.id
                    );

                    nr = poLine.number;

                    if (line.quantity >= 0) {
                        worth = await receiptLineAmount(
                            line.quantity,
                            poLine,
                            pdate,
                            obj.client
                        );
                        if (worth) {
                            amounts.push({
                                op: "replace",
                                path: "/lines/" + (j - 1) + "/amount",
                                value: worth
                            });
                        }
                    }

                    if (line.quantity < 0) {
                        return Promise.reject("Line quantity must be positive");
                    }

                    if (
                        line.quantity > 0 &&
                        (
                            receipt.site.locationControlled ||
                            poLine.item.trace !== "N"
                        )
                    ) {
                        if (!line.details.length) {
                            return Promise.reject(
                                "Receipt line requires detail records"
                            );
                        }

                        line.details.forEach(function (row) {
                            qty = qty.plus(row.quantity);
                        });

                        if (qty !== line.quantity) {
                            return Promise.reject(
                                "Receipt line quantity must match detail"
                            );
                        }
                    } else {
                        qty = line.quantity;
                    }

                    if (qty) {
                        idx = po.lines.indexOf(poLine);
                        poLine.received = poLine.received.plus(
                            line.quantity
                        );
                        poTx.data.push({
                            op: "replace",
                            path: "/lines/" + idx + "/received",
                            value: poLine.received
                        });
                    }

                    if (!qty || poLine.item.type === "E") {
                        // Handle outside process if applicable,
                        // otherwise nothing
                        if (poLine.item.objectType === "Service") {
                            if (poLine.shipped < poLine.received) {
                                return Promise.reject(
                                    "Cannot receive quantity " + qty + " of " +
                                    poLine.item.number +
                                    " that would make total receipts greater " +
                                    "than the shipped quantity of " +
                                    poLine.shipped
                                );
                            }

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
                                    "Work order allocation " +
                                    "for service " + poLine.item.number +
                                    " not found"
                                );
                            }

                            if (allocs.length > 1) {
                                return Promise.reject(
                                    "Something went wrong. " +
                                    "More than one allocation found " +
                                    "for service " + poLine.item.number +
                                    ". Contact your administrator."
                                );
                            }

                            await obj.client.query(
                                "UPDATE outside_process " +
                                "SET received = received + $1, " +
                                "  quantity_due = " +
                                "  GREATEST(quantity_due - $1, 0), " +
                                "  status = CASE " +
                                "  WHEN quantity_due - $1 <= 0 THEN 'C' " +
                                "  ELSE 'I' END, " +
                                "  updated = now(), " +
                                "  updated_by = $3 " +
                                "WHERE outside_process.id=$2",
                                [
                                    qty,
                                    allocs[0].demand.id,
                                    obj.client.currentUser()
                                ]
                            );
                            op = await obj.client.query(
                                "SELECT woop.id AS op_id, wo.id AS wo_id " +
                                "FROM work_order_operation woop, " +
                                "  outside_process op, work_order wo " +
                                "WHERE op.id=$1 " +
                                "AND woop._pk=op._work_order_operation" +
                                "_work_order_operation_pk " +
                                "AND woop._work_order_work_order_pk=wo._pk ",
                                [allocs[0].demand.id]
                            );

                            if (!op.rows.length) {
                                return Promise.reject(
                                    "Outside process operation not found"
                                );
                            }

                            emp = await obj.client.query(
                                "SELECT emp.id " +
                                "FROM employee emp, user_account ua " +
                                "WHERE ua.name=$1 " +
                                "  AND emp._pk=ua._contact_contact_pk; ",
                                [obj.client.currentUser()]
                            );

                            if (!emp.rows.length) {
                                return Promise.reject(
                                    "Matching employee record not found for " +
                                    "user account " + obj.client.currentUser()
                                );
                            }

                            await f.datasource.request({
                                client: obj.client,
                                data: {
                                    employee: {id: emp.rows[0].id},
                                    operation: {id: op.rows[0].op_id},
                                    quantity: qty
                                },
                                method: "POST",
                                name: "OperationCompletion"
                            }, true);
                        }

                        // No location or trace control
                    } else if (!line.details.length) {
                        qty = qty.times(poLine.ratio);
                        if (!poLine.item.isFractional) {
                            qty = Math.ceil(qty);
                        }

                        // Kit
                        if (poLine.components.length) {
                            cn = 1;
                            poLine.components.forEach(
                                function (c) {
                                    let cqty = qty.times(c.quantityPer);
                                    if (c.fixedQuantity && !c.received) {
                                        cqty = cqty.plus(c.fixedQuantity);
                                    }
                                    if (!c.item.isFractional) {
                                        cqty = Math.ceil(cqty);
                                    }

                                    handleAllocations(c, cqty);

                                    trans.push({
                                        method: "POST",
                                        name: "InventoryTransaction",
                                        client: obj.client,
                                        user: obj.client.currentUser(),
                                        data: {
                                            id: f.createId(),
                                            document: receipt.number,
                                            reference: nr + "." + cn,
                                            type: "Purchase Order Receipt",
                                            date: pdate,
                                            item: c.item,
                                            site: receipt.site,
                                            quantity: cqty
                                        }
                                    });
                                    c.received = c.received.plus(cqty);
                                    poTx.data.push({
                                        op: "replace",
                                        path: (
                                            "/lines/" + idx +
                                            "/components/" +
                                            (cn - 1) + "/received"
                                        ),
                                        value: c.received
                                    });
                                    cn += 1;
                                }
                            );
                            // Inventory
                        } else {
                            handleAllocations(poLine, qty);

                            trans.push({
                                method: "POST",
                                name: "InventoryTransaction",
                                client: obj.client,
                                user: obj.client.currentUser(),
                                data: {
                                    id: f.createId(),
                                    document: receipt.number,
                                    reference: nr,
                                    type: "Purchase Order Receipt",
                                    date: pdate,
                                    item: poLine.item,
                                    site: receipt.site,
                                    quantity: qty
                                }
                            });
                        }
                        // Location and trace controlled items
                    } else {
                        line.details.forEach(function (row) {
                            qty = row.quantity.times(
                                poLine.ratio
                            );
                            if (!poLine.item.isFractional) {
                                qty = Math.ceil(qty);
                            }

                            // Kit
                            if (poLine.components.length) {
                                cn = 1;
                                poLine.components.forEach(
                                    function (c) {
                                        let cqty = qty.times(c.quantityPer);
                                        if (
                                            c.fixedQuantity &&
                                            !c.received
                                        ) {
                                            cqty = cqty.plus(
                                                c.fixedQuantity
                                            );
                                        }
                                        if (!c.item.isFractional) {
                                            cqty = Math.ceil(cqty);
                                        }

                                        handleAllocations(c, cqty);

                                        trans.push({
                                            method: "POST",
                                            name: "InventoryTransaction",
                                            client: obj.client,
                                            user: obj.client.currentUser(),
                                            data: {
                                                id: f.createId(),
                                                document: receipt.number,
                                                reference: nr,
                                                type: (
                                                    "Purchase Order Receipt"
                                                ),
                                                date: pdate,
                                                item: c.item,
                                                site: receipt.site,
                                                quantity: cqty,
                                                location: row.location
                                            }
                                        });
                                        c.received = c.received.plus(cqty);
                                        poTx.data.push({
                                            op: "replace",
                                            path: (
                                                "/lines/" + idx +
                                                "/components/" +
                                                (cn - 1) + "/received"
                                            ),
                                            value: c.received
                                        });
                                        cn += 1;
                                    }
                                );
                                // Inventory
                            } else {
                                handleAllocations(poLine, qty);

                                trans.push({
                                    method: "POST",
                                    name: "InventoryTransaction",
                                    client: obj.client,
                                    user: obj.client.currentUser(),
                                    data: {
                                        id: f.createId(),
                                        document: receipt.number,
                                        reference: nr,
                                        type: "Purchase Order Receipt",
                                        date: pdate,
                                        item: poLine.item,
                                        site: receipt.site,
                                        quantity: qty,
                                        location: row.location,
                                        trace: traced.find(
                                            (t) => row.trace === t.number
                                        )
                                    }
                                });
                            }
                        });
                    }

                    po.lines.some(function (line) {
                        if (line.received < line.ordered) {
                            poStatus = "B";
                            return true;
                        }
                    });

                    poTx.data.push({
                        op: "replace",
                        path: "/status",
                        value: poStatus
                    });
                }

                trans.push({
                    method: "PATCH",
                    name: "PurchaseOrderReceipt",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: receipt.id,
                    eventKey: eKey,
                    data: amounts.concat([{
                        op: "replace",
                        path: "/status",
                        value: "R"
                    }, {
                        op: "replace",
                        path: "/receiptDate",
                        value: pdate
                    }, {
                        op: "replace",
                        path: "/error",
                        value: ""
                    }])
                });

                trans.push(poTx);
            }

            try {
                while (trans.length) {
                    await f.datasource.request(
                        trans.shift(),
                        true
                    );
                }
            } catch (e) {
                return Promise.reject(e);
            }
        }

        Promise.resolve().then(
            waitForReceipts
        ).then(
            fetchReceipts
        ).then(
            lock
        ).then(
            fetchTrc
        ).then(
            process
        ).then(
            resolve
        ).catch(
            doReject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doPostPurchaseOrderReceipts",
    doPost
);