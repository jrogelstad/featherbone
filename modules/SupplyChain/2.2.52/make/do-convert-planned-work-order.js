/*jslint devel unordered*/
async function doConvertPlannedWo(obj) {
    try {
        let requests = [];
        let eKey = obj.data.eventKey;
        let pl = await f.datasource.request({
            method: "GET",
            name: "PlannedWorkOrder",
            client: obj.client,
            id: obj.data.id
        }, true);

        if (!pl) {
            return Promise.reject(
                "Planned work order wth id " + obj.data.id +
                " not found"
            );
        }

        let theProduct = await f.datasource.request({
            client: obj.client,
            id: pl.item.id,
            method: "GET",
            name: "Product",
            properties: ["id", "drawingLink", "documents", "cost"]
        }, true);
        let allocs = await f.datasource.request({
            method: "GET",
            name: "Allocation",
            client: obj.client,
            filter: {
                criteria: [{
                    property: "supply.id",
                    value: obj.data.id
                }]
            }
        }, true);

        // Silently remove previous allocations
        let c = 0;
        let alc;
        const sql1 = "UPDATE planned_work_order SET allocated=0 WHERE id=$1";
        const sql2 = "DELETE FROM allocation WHERE id=$1;";
        const sql3 = "UPDATE demand SET allocated = allocated - $1 WHERE id=$2";
        await obj.client.query(sql1, [obj.data.id]);

        while (c < allocs.length) {
            alc = allocs[c];
            await obj.client.query(sql2, [alc.id]);
            await obj.client.query(sql3, [alc.quantity, alc.demand.id]);
            c += 1;
        }

        // Begin
        let woId = f.createId();
        let woreqs = [];
        let solines = [];
        let soreqs = [];

        requests.push({
            client: obj.client,
            data: {
                documents: theProduct.documents.map(function (doc) {
                    return {link: doc.link, notes: doc.notes};
                }),
                drawingLink: theProduct.drawingLink,
                dueDate: pl.dueDate,
                id: woId,
                ordered: pl.quantity,
                item: theProduct,
                priority: pl.priority,
                salesDemand: pl.salesDemand,
                salesOrder: pl.salesOrder,
                site: pl.site,
                startDate: pl.startDate,
                status: "U",
                actualMaterialCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                actualLaborCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                actualServiceCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                actualOverheadCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                actualTotalCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                estimatedMaterialCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                estimatedLaborCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                estimatedServiceCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                estimatedOverheadCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                },
                estimatedTotalCost: {
                    currency: theProduct.cost.currency,
                    amount: 0
                }
            },
            method: "POST",
            name: "WorkOrder",
            user: obj.client.currentUser()
        });

        requests.push({
            client: obj.client,
            id: obj.data.id,
            eventKey: eKey,
            method: "DELETE",
            name: "PlannedWorkOrder",
            user: obj.client.currentUser()
        });

        // Move allocs to w/o
        allocs.forEach(function (alc) {
            switch (alc.demand.objectType) {
            case "SalesOrderLine":
                solines.push(alc.demand.id);
                break;
            case "SalesOrderRequirement":
                soreqs.push(alc.demand.id);
                break;
            case "WorkOrderRequirement":
                woreqs.push(alc.demand.id);
                break;
            }
            requests.push({
                client: obj.client,
                data: {
                    supply: {id: woId},
                    demand: alc.demand,
                    quantity: alc.quantity,
                    isFirm: alc.isFirm
                },
                method: "POST",
                name: "Allocation"
            });
        });

        if (woreqs.length) {
            requests.push({
                client: obj.client,
                data: {requirementIds: woreqs},
                method: "POST",
                name: "doUpdateWorkOrderPlanStatus"
            });
        }

        if (solines.length || soreqs.length) {
            requests.push({
                client: obj.client,
                data: {lineIds: solines, requirementIds: soreqs},
                method: "POST",
                name: "doUpdateSalesOrderPlanStatus"
            });
        }

        while (requests.length) {
            await f.datasource.request(requests.shift(), true);
        }

        return "Work order created";
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doConvertPlannedWorkOrder",
    doConvertPlannedWo
);

function doConvertPlannedWos(obj) {
    return new Promise(function (resolve, reject) {
        let eKey = f.createId();

        function next() {
            if (!obj.data.ids.length) {
                resolve("Work orders created");
                return;
            }

            doConvertPlannedWo({
                client: obj.client,
                data: {id: obj.data.ids.shift(), eventKey: eKey}
            }).then(next).catch(reject);
        }

        // Lock planned orders
        Promise.all(obj.data.ids.map(function (id) {
            return f.datasource.lock(
                id,
                obj.client.currentUser(),
                eKey,
                "Converting to work order",
                obj.client
            );
        })).then(next).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doConvertPlannedWorkOrders",
    doConvertPlannedWos
);
