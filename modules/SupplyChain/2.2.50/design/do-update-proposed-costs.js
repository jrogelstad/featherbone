/*jslint devel unordered*/
const sql1 = (
    "UPDATE product SET " +
    "  material_cost.amount = $1, " +
    "  overhead_cost.amount = $2, " +
    "  labor_cost.amount = $3, " +
    "  service_cost.amount = $4, " +
    "  cost.amount = $5, " +
    "  updated = now(), " +
    "  updated_by = $6 " +
    "WHERE id = $7"
);
const sql2 = (
    "UPDATE proposed_cost SET " +
    "  status = 'U', " +
    "  updated = now(), " +
    "  updated_by = $1 " +
    "WHERE id = $2"
);

async function doUpdate(obj) {
    try {
        let subscr = obj.data.subscription;
        let process;
        let fltr = {criteria: [{property: "status", value: "A"}]};
        let invfltr = {criteria: [{
            property: "quantity",
            operator: ">",
            value: 0
        }]};

        if (obj.data.ids) {
            fltr.criteria.push({
                property: "id",
                operator: "IN",
                value: obj.data.ids
            });
        } else {
            // Stay inside the request's transaction: a COMMIT here
            // would end it early and leave the rest in autocommit.
            await obj.client.query(
                "DELETE FROM \"$subscription\" " +
                "WHERE objectid IN ('proposed_cost', 'product');"
            );
        }
        let resp = await f.datasource.request({
            method: "GET",
            name: "ProposedCost",
            client: obj.client,
            filter: fltr,
            properties: [
                "id",
                "item",
                "materialCost",
                "laborCost",
                "overheadCost",
                "serviceCost",
                "totalCost"
            ]
        }, true);

        invfltr.criteria.push({
            property: "item.id",
            operator: "IN",
            value: resp.map((r) => r.item.id)
        });

        let is;
        let iss;
        let invs = await f.datasource.request({
            method: "GET",
            name: "Inventory",
            client: obj.client,
            filter: invfltr,
            properties: [
                "id",
                "item",
                "site"
            ]
        }, true);

        process = f.datasource.createProcess({
            client: obj.client,
            count: resp.length,
            name: "Updating costs",
            subscription: subscr
        });
        await process.start();

        // Faster!
        let row;
        while (resp.length) {
            row = resp.shift();
            await Promise.all([
                obj.client.query(sql1, [
                    row.materialCost.amount,
                    row.overheadCost.amount,
                    row.laborCost.amount,
                    row.serviceCost.amount,
                    row.totalCost.amount,
                    obj.client.currentUser(),
                    row.item.id
                ]),
                obj.client.query(sql2, [
                    obj.client.currentUser(),
                    row.id
                ]),
                process.next()
            ]);
            iss = invs.filter((i) => i.item.id === row.item.id);
            while (iss.length) {
                is = iss.shift();
                await f.datasource.request({
                    method: "POST",
                    name: "InventoryTransaction",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: {
                        date: f.today(),
                        item: {id: is.item.id},
                        site: {id: is.site.id},
                        quantity: 0,
                        type: "Standard Cost Update",
                        document: is.item.number,
                        reference: is.item.number
                    }
                }, true);
            }
        }
        await process.complete();
        return "Item(s) updated with proposed costs";

    } catch (e) {
        return Promise.reject(e);
    }

}

f.datasource.registerFunction(
    "POST",
    "doUpdateProposedCosts",
    doUpdate
);