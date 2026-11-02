/*jslint unordered devel*/
async function doPlanSoSupply(obj) {
    let eKey = f.createId();
    let itemIds = [];
    let siteIds = [];
    let subscr = obj.data.subscription;
    let so = await f.datasource.request({
        method: "GET",
        name: "SalesOrder",
        client: obj.client,
        id: obj.data.id,
        properties: ["id", "number", "lines"]
    }, true);
    let planSettings = await f.datasource.request({
        client: obj.client,
        data: {name: "planSettings"},
        method: "GET",
        name: "getSettings"
    }, true);
    planSettings = planSettings || {shippingBuffer: 0};
    let shipBuffer = planSettings.shippingBuffer;

    let process = f.datasource.createProcess({
        client: obj.client,
        count: so.lines.length,
        name: "Plan Sales Order #" + so.number,
        subscription: subscr
    });
    await process.start();

    function addIds(row) {
        if (itemIds.indexOf(row.item.id) === -1) {
            itemIds.push(row.item.id);
        }
        if (siteIds.indexOf(row.site.id) === -1) {
            siteIds.push(row.site.id);
        }
    }

    if (!so) {
        throw "Sales order wth id " + obj.data.id + " not found";
    }

    if (obj.data.lock !== false) {
        await f.datasource.lock(
            obj.data.id,
            obj.client.currentUser(),
            eKey,
            "Planning sales order",
            obj.client
        );
    }

    try {
        so.lines.forEach(function (ln) {
            addIds(ln);
            ln.materials.forEach(addIds);
        });

        let i1 = 0;
        let i2 = 0;
        let ln;
        let rq;

        while (i1 < so.lines.length) {
            ln = so.lines[i1];
            if (
                ln.status !== "C" &&
                ln.quantityDue > ln.allocated &&
                ln.item.type === "I"
            ) {
                await f.datasource.request({
                    client: obj.client,
                    data: {demandId: ln.id, timeBuffer: shipBuffer},
                    method: "POST",
                    name: "doPlanSupply",
                    user: obj.client.currentUser()
                }, true);
            }
            while (i2 < ln.materials.length) {
                rq = ln.materials[i2];
                if (
                    rq.status !== "C" &&
                    rq.quantityDue > rq.allocated &&
                    rq.item.type === "I"
                ) {
                    await f.datasource.request({
                        client: obj.client,
                        data: {demandId: rq.id, timeBuffer: shipBuffer},
                        method: "POST",
                        name: "doPlanSupply",
                        user: obj.client.currentUser()
                    });
                }
                i2 += 1;
            }
            i2 = 0;
            i1 += 1;

            await process.next();
        }

        await f.datasource.request({
            client: obj.client,
            data: {id: obj.data.id},
            method: "POST",
            name: "doUpdateSalesOrderPlanStatus"
        }, true);

        await f.datasource.request({
            client: obj.client,
            data: [{
                op: "replace",
                path: "/updated",
                value: f.now()
            }],
            id: obj.data.id,
            eventKey: eKey,
            method: "PATCH",
            name: "SalesOrder",
            user: obj.client.currentUser()
        }, true);

        await process.complete();
    } catch (err) {
        return Promise.reject(err);
    }
}

f.datasource.registerFunction(
    "POST",
    "doPlanSalesOrderSupply",
    doPlanSoSupply
);
