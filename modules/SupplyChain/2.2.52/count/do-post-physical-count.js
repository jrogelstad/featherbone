/*jslint unordered*/
/*global console*/

async function doPostPhysicalCount(obj) {
    let eKey = f.createId();

    // Lock first, then read. Locking waits for any other transaction
    // holding the count, so the isActive check below sees what that
    // transaction committed. Checking first let two concurrent posts
    // both find the count active and both post its tags.
    await f.datasource.lock(
        obj.data.id,
        obj.client.currentUser(),
        eKey,
        "Post physical count",
        obj.client
    );

    let count = await f.datasource.request({
        method: "GET",
        name: "PhysicalCount",
        client: obj.client,
        id: obj.data.id
    }, true);

    if (!count) {
        throw "Physical count not found";
    }

    if (!count.isActive) {
        throw "Physical count " + count.number + " is not active";
    }

    try {
        await f.datasource.request({
            method: "PATCH",
            name: "PhysicalCount",
            client: obj.client,
            id: count.id,
            eventKey: eKey,
            data: [{
                op: "replace",
                path: "/isActive",
                value: false
            }, {
                op: "replace",
                path: "/closedTime",
                value: f.now()
            }]
        });

        let tags = count.tags.filter(
            (t) => t.isComplete && t.quantityChange
        );
        let tag;

        while (tags.length) {
            tag = tags.shift();
            console.log("Processing tag->", tag.number);
            let unalc = 0;
            let inv = tag.inventory;

            // Deal with impacted allocations
            if (tag.quantityChange < 0 && inv.allocated) {
                unalc = Math.max(
                    Math.abs(tag.quantityChange).minus(
                        inv.quantity.minus(
                            inv.allocated
                        )
                    ),
                    0
                );

                if (unalc) {
                    await f.datasource.request({
                        client: obj.client,
                        method: "POST",
                        name: "doTransactAllocated",
                        user: obj.client.currentUser(),
                        data: {
                            id: inv.id,
                            quantity: unalc,
                            type: "supply"
                        }
                    }, true);
                }
            }

            await f.datasource.request({
                method: "POST",
                name: "InventoryTransaction",
                client: obj.client,
                user: obj.client.currentUser(),
                data: {
                    id: f.createId(),
                    document: count.number,
                    reference: count.number + "\\" + tag.number,
                    type: "Physical Count",
                    date: f.today(),
                    item: tag.item,
                    site: count.site,
                    location: tag.location,
                    trace: tag.traceNumber,
                    quantity: tag.quantityChange
                }
            }, true);

            await f.datasource.request({
                method: "POST",
                name: "doRecalcInventoryOrders",
                client: obj.client,
                user: obj.client.currentUser(),
                data: {
                    itemId: tag.item.id,
                    siteId: count.site.id
                }
            });
        }

    } catch (err) {
        f.datasource.request({
            method: "POST",
            name: "Alert",
            user: obj.client.currentUser(),
            data: {
                category: "Physical Count",
                severity: "Error",
                message: (
                    "Physical count failed to post: " +
                    err
                ),
                relation: {
                    code: count.number,
                    id: count.id,
                    objectType: "PhysicalCount"
                }
            },
            tenant: obj.client.tenant()
        }, true);

        return Promise.reject(err);
    }

    return "Physical count posted successfully";
}

f.datasource.registerFunction(
    "POST",
    "doPostPhysicalCount",
    doPostPhysicalCount
);