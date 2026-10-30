/*jslint*/
f.datasource.registerFunction(
    "POST",
    "ShipmentInvoice",
    function (obj) {
        obj.newRec.prepaid.amount = obj.newRec.prepayments.reduce(
            function (prv, nxt) {
                return prv.plus(nxt.amount.amount);
            },
            0
        );
        obj.newRec.paid.amount = obj.newRec.prepaid.amount;
        if (obj.newRec.prepaid.amount < 0) {
            throw "Prepaid amount cannot be less than zero";
        }
        if (obj.newRec.prepaid.amount > obj.newRec.total.amount) {
            throw "Prepaid amount cannot be greater than the invoice total";
        }
    },
    f.datasource.TRIGGER_BEFORE
);
f.datasource.registerFunction(
    "DELETE",
    "ShipmentInvoice",
    async function (obj) {
        let ppi;
        let ppis;
        let app;

        if (obj.oldRec.prepayments.length) {
            ppis = await f.datasource.request({
                client: obj.client,
                filter: {criteria: [{
                    operator: "IN",
                    property: "id",
                    value: obj.oldRec.prepayments.map(
                        (p) => p.prepaidInvoice.id
                    )
                }]},
                isForUpdate: true,
                method: "GET",
                name: "PrepaidInvoice"
            }, true);

            // Remove applications from prepaid invoice
            while (ppis.length) {
                ppi = ppis.pop();
                app = ppi.applications.find(
                    (p) => p.invoice.id === obj.oldRec.id
                );
                if (app) {
                    ppi.applications.splice(ppi.applications.indexOf(app), 1);
                    await f.datasource.request({
                        client: obj.client,
                        data: ppi,
                        id: ppi.id,
                        method: "POST",
                        name: "PrepaidInvoice"
                    }, true);
                }
            }
        }

        await f.datasource.request({
            client: obj.client,
            data: [{
                op: "replace",
                path: "/isInvoiced",
                value: false
            }],
            id: obj.oldRec.shipment.id,
            method: "PATCH",
            name: "SalesOrderShipment"
        }, true);
    },
    f.datasource.TRIGGER_BEFORE
);