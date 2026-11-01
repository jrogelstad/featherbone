/*jslint devel*/
const CURR_SCALE = 2;
const PCT_RATIO = 0.01;

async function doCreateShipmentInvoice(obj) {
    let eKey = f.createId();
    let requests = [];

    try {
        await f.datasource.lock(
            obj.data.id,
            obj.client.currentUser(),
            eKey,
            "Creating shipment invoice",
            obj.client
        );

        let shp = await f.datasource.request({
            client: obj.client,
            id: obj.data.id,
            method: "GET",
            name: "SalesOrderShipment",
            properties: [
                "id",
                "freightCharges",
                "incoTerms",
                "isInvoiced",
                "lines",
                "salesOrder",
                "shipTo",
                "shipMethod"
            ]
        }, true);
        if (!shp) {
            return Promise.reject("Shipment not found");
        }
        // Checked after the lock above, so a second request for the same
        // shipment sees the first one's result instead of invoicing twice
        if (shp.isInvoiced) {
            return Promise.reject("Shipment has already been invoiced");
        }
        let so = await f.datasource.request({
            client: obj.client,
            id: shp.salesOrder.id,
            method: "GET",
            name: "SalesOrder",
            properties: [
                "id",
                "billingNotes",
                "billTo",
                "contact",
                "currency",
                "customer",
                "lines",
                "purchaseOrder",
                "taxable",
                "taxes",
                "terms"
            ]
        }, true);

        // Prepaid invoices are spent below. Wait for any other transaction
        // working on them before reading how much is unapplied: reading
        // first let two invoices for one sales order both see the full
        // prepayment and both apply it. The wait is a transaction-scoped
        // advisory lock, released when this transaction ends, so (unlike
        // f.datasource.lock) it leaves nothing locked behind for the
        // prepaid invoices that turn out not to be used. The second read
        // repeats the filter, so a prepayment the other request used up
        // drops out. Sorted so concurrent requests cannot deadlock.
        function ppiFilter() {
            return {criteria: [{
                property: "salesOrder.id",
                value: so.id
            }, {
                operator: ">",
                property: "unapplied.amount",
                value: 0
            }], sort: [{
                property: "invoiceDate"
            }, {
                property: "number"
            }]};
        }
        let ppiIds = await f.datasource.request({
            client: obj.client,
            filter: ppiFilter(),
            method: "GET",
            name: "PrepaidInvoice",
            properties: ["id"]
        }, true);
        ppiIds = ppiIds.map((p) => p.id).sort();
        let waitN = 0;
        while (waitN < ppiIds.length) {
            await obj.client.query(
                "SELECT pg_advisory_xact_lock(_pk) " +
                "FROM object WHERE id = $1",
                [ppiIds[waitN]]
            );
            waitN += 1;
        }

        let ppis = await f.datasource.request({
            client: obj.client,
            filter: ppiFilter(),
            method: "GET",
            name: "PrepaidInvoice"
        }, true);
        let inv = {
            balance: {amount: 0, currency: so.currency.code},
            billTo: so.billTo,
            contact: so.contact,
            currency: so.currency,
            customer: so.customer,
            freight: shp.freightCharges,
            id: f.createId(),
            incoTerms: shp.incoTerms,
            invoiceDate: f.today(),
            notes: so.billingNotes,
            paid: {amount: 0, currency: so.currency.code},
            prepaid: {amount: 0, currency: so.currency.code},
            prepayments: [],
            purchaseOrder: so.purchaseOrder,
            salesOrder: so,
            salesRep: so.salesRep,
            shipMethod: shp.shipMethod,
            shipTo: shp.shipTo,
            shipment: shp,
            subtotal: {amount: 0, currency: so.currency.code},
            tax: {amount: 0, currency: so.currency.code},
            taxable: so.taxable,
            taxes: [],
            terms: so.terms,
            total: {amount: 0, currency: so.currency.code}
        };

        if (so.taxable) {
            inv.taxable = true;
            inv.taxes = await f.datasource.request({
                client: obj.client,
                data: {id: shp.shipTo.id},
                method: "POST",
                name: "doGetAddressTaxRates"
            }, true);
        }
        let n = 0;

        inv.lines = shp.lines.filter((s) => s.quantity).map(function (ln) {
            let sol = so.lines.find((sl) => sl.id === ln.salesOrderLine.id);
            n += 1;

            return {
                amount: {
                    amount: sol.discountPrice.amount.times(
                        ln.quantity
                    ).round(CURR_SCALE),
                    currency: so.currency.code
                },
                backOrdered: sol.backOrdered,
                billed: ln.quantity,
                discount: sol.discount,
                discountPrice: sol.discountPrice,
                item: sol.item,
                line: n,
                notes: sol.notes,
                ordered: sol.ordered,
                price: sol.price,
                salesOrderLine: sol,
                shipmentLine: ln,
                shipped: ln.quantity,
                taxable: sol.taxable
            };
        });

        // Calculate taxes
        let taxLns = inv.lines.filter((ln) => ln.taxable);

        inv.taxes.forEach(function (tx) {
            tx.id = f.createId();
            let ttl = taxLns.reduce(function (t, ln) {
                return ln.amount.amount.times(
                    tx.percent
                ).times(PCT_RATIO).plus(t);
            }, 0);
            if (tx.shippingTaxable) {
                ttl = inv.freight.amount.times(
                    tx.percent
                ).times(PCT_RATIO).plus(ttl);
            }
            tx.amount = {
                // Math.round takes no scale: it rounded tax to whole units
                amount: ttl.round(CURR_SCALE),
                currency: so.currency.code
            };
            inv.tax.amount = inv.tax.amount.plus(tx.amount.amount);
        });

        inv.subtotal.amount = inv.lines.reduce(function (t, ln) {
            return ln.amount.amount.plus(t);
        }, 0);

        inv.total.amount = inv.subtotal.amount.plus(
            inv.freight.amount
        ).plus(inv.tax.amount);

        // Apply prepaid invoices until the invoice balance is covered.
        // The loop used to test inv.prepaid, which is only totalled by a
        // trigger after this runs, so it never stopped and every
        // remaining prepaid invoice got a zero-amount application.
        let ppi;
        let bal = inv.total.amount;
        let toapply = 0;
        while (ppis.length && bal > 0) {
            ppi = ppis.shift();
            if (ppi.unapplied.amount < bal) {
                toapply = ppi.unapplied.amount;
            } else {
                toapply = bal;
            }
            ppi.unapplied.amount = ppi.unapplied.amount.minus(toapply);
            ppi.applications.push({
                amount: {amount: toapply, currency: so.currency.code},
                invoice: {id: inv.id}
            });
            requests.push({
                client: obj.client,
                data: ppi,
                id: ppi.id,
                method: "POST",
                name: "PrepaidInvoice"
            });
            bal = bal.minus(toapply);
            inv.prepayments.push({
                amount: {amount: toapply, currency: so.currency.code},
                prepaidInvoice: ppi
            });
        }

        await f.datasource.request({
            client: obj.client,
            data: inv,
            method: "POST",
            name: "ShipmentInvoice"
        }, true);

        await f.datasource.request({
            client: obj.client,
            data: [{
                op: "replace",
                path: "/isInvoiced",
                value: true
            }],
            eventKey: eKey,
            id: shp.id,
            method: "PATCH",
            name: "SalesOrderShipment"
        }, true);

        // Update prepayments
        let req;
        while (requests.length) {
            req = requests.shift();
            await f.datasource.request(req, true);
        }

        return inv.id;

    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doCreateShipmentInvoice",
    doCreateShipmentInvoice
);