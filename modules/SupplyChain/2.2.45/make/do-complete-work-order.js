/*jslint unordered*/
async function doCompleteWo(obj) {
    let ids = (obj.data.ids || [obj.data.id]);
    let qty = obj.data.quantity;

    let wos = await f.datasource.request({
        method: "GET",
        name: "WorkOrder",
        client: obj.client,
        properties: ["id", "number", "status", "quantity", "item", "site"],
        filter: {criteria: [{
            property: "id",
            operator: "IN",
            value: ids
        }]}
    }, true);
    let dtl = [];
    let rid;
    let rids = [];
    let is;
    let loc;
    let wo;
    let woSite;

    if (!wos.length) {
        throw "No work orders found";
    }

    while (wos.length) {
        wo = wos.shift();
        if (wo.status !== "A" && wo.status !== "I") {
            return Promise.reject(
                "Work order " + wo.number + " is not active"
            );
        }

        if (wo.item.trace !== "N") {
            return Promise.reject(
                "Receipts for traced product " +
                wo.item.number + " must be created manually"
            );
        }

        if (wo.site.locationControlled) {
            is = await f.datasource.request({
                method: "GET",
                name: "ItemSite",
                client: obj.client,
                properties: ["id", "defaultLocation"],
                filter: {criteria: [{
                    property: "item.id",
                    value: wo.item.id
                }, {
                    property: "site.id",
                    value: wo.site.id
                }]}
            }, true);
            woSite = await f.datasource.request({
                method: "GET",
                name: "Site",
                client: obj.client,
                properties: ["defaultLocation", "defaultReceiveLocation"],
                id: wo.site.id
            }, true);

            if (!is.length) {
                return Promise.reject(
                    "Item site not found for " + wo.item.number
                );
            }

            loc = (
                is[0].defaultLocation ||
                woSite.defaultReceiveLocation ||
                woSite.defaultLocation
            );

            if (!loc) {
                return Promise.reject(
                    "No default location to receive for " + wo.item.number +
                    " at " + wo.site.code
                );
            }

            dtl.push({location: loc, quantity: qty});
        }

        rid = f.createId();
        rids.push(rid);
        await f.datasource.request({
            method: "POST",
            name: "WorkOrderReceipt",
            client: obj.client,
            id: rid,
            data: {
                id: rid,
                details: dtl,
                quantity: qty || wo.quantity,
                receiptDate: f.today(),
                site: wo.site,
                workOrder: wo
            }
        }, true);
    }
}

f.datasource.registerFunction(
    "POST",
    "doCompleteWorkOrder",
    doCompleteWo
);
