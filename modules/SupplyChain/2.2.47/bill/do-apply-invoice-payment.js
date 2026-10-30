/*jslint devel*/
async function doApplyInvoicePayment(obj) {
    let pre;
    async function getInvoices(objType) {
        let ids = pre.filter(
            (p) => p.objectType === objType
        ).map((p) => p.id);

        if (ids.length) {
            return await f.datasource.request({
                client: obj.client,
                filter: {criteria: [{
                    operator: "IN",
                    property: "id",
                    value: ids
                }], sort: [
                    {property: "invoiceDate"},
                    {property: "number"}
                ]},
                method: "GET",
                name: objType
            }, true);
        }
        return [];
    }

    try {
        pre = await f.datasource.request({
            client: obj.client,
            filter: {criteria: [{
                operator: "IN",
                property: "id",
                value: obj.data.ids
            }]},
            method: "GET",
            name: "Invoice",
            properties: ["id", "objectType"]
        }, true);

        // Wait for any other transaction working on these invoices
        // before reading their paid amounts. The wait is a
        // transaction-scoped advisory lock, the same one
        // f.datasource.lock takes first, so it is released when this
        // transaction ends and leaves no record locked behind. Without it
        // a concurrent payment was applied to figures read before the
        // other had committed, and wrote the invoice back over it.
        // Sorted so overlapping payments cannot deadlock each other.
        let waitIds = pre.map((p) => p.id).sort();
        let w = 0;
        while (w < waitIds.length) {
            await obj.client.query(
                "SELECT pg_advisory_xact_lock(_pk) " +
                "FROM object WHERE id = $1",
                [waitIds[w]]
            );
            w += 1;
        }

        let invs = await getInvoices("Invoice");
        let prpd = await getInvoices("PrepaidInvoice");
        let shpi = await getInvoices("ShipmentInvoice");
        invs = invs.concat(prpd);
        invs = invs.concat(shpi);

        if (!invs.length) {
            return Promise.reject("No invoice found");
        }
        invs.sort(function (a, b) {
            if (a.invoiceDate > b.invoiceDate) {
                return 1;
            }
            if (a.invoiceDate < b.invoiceDate) {
                return -1;
            }
            if (a.number > b.number) {
                return 1;
            }
            if (a.number < b.number) {
                return -1;
            }
            return 0;
        });
        let inv;
        let n = 0;
        let eKey = f.createId();

        // Lock invoices
        while (n < invs.length) {
            inv = invs[n];
            n += 1;
            await f.datasource.lock(
                inv.id,
                obj.client.currentUser(),
                eKey,
                "Applying invoice payment",
                obj.client
            );
        }

        let curr = invs[0].currency.code;
        if (obj.data.amount.currency !== curr) {
            return Promise.reject(
                "Applied currency must be the same as invoice currency"
            );
        }
        if (invs.some((i) => i.currency.code !== obj.data.amount.currency)) {
            return Promise.reject(
                "Applied currency must be the same as invoice currency"
            );
        }
        let unpaid = invs.reduce(function (prv, nxt) {
            return prv.plus(nxt.total.amount).minus(nxt.paid.amount);
        }, 0);

        if (obj.data.amount.amount > unpaid) {
            return Promise.reject(
                "Applied amount must be less than or equal " +
                "to unpaid amount of selected invoices"
            );
        }

        let unapplied = obj.data.amount.amount;

        while (unapplied && invs.length) {
            inv = invs.shift();
            unpaid = inv.total.amount.minus(inv.paid.amount);

            if (unpaid <= unapplied) {
                unapplied = unapplied.minus(unpaid);
                inv.payments.push({amount: {
                    amount: unpaid,
                    currency: curr
                }, reference: obj.data.reference});
                inv.paid.amount = inv.total.amount;
            } else {
                inv.paid.amount = inv.paid.amount.plus(unapplied);
                inv.payments.push({amount: {
                    amount: unapplied,
                    currency: curr
                }, reference: obj.data.reference});
                unapplied = 0;
            }

            await f.datasource.request({
                client: obj.client,
                data: inv,
                eventKey: eKey,
                id: inv.id,
                method: "POST",
                name: inv.objectType
            }, true);
        }
        return "Payment applied";
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doApplyInvoicePayment",
    doApplyInvoicePayment
);