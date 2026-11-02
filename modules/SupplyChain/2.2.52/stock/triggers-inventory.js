/*jslint unordered*/

async function doInsertInventory(obj) {
    let newRec = obj.newRec;

    let item = await f.datasource.request({
        method: "GET",
        client: obj.client,
        name: "Item",
        id: newRec.item.id
    }, true);

    if (!item) {
        return Promise.reject("Invalid item");
    }

    let site = await f.datasource.request({
        method: "GET",
        client: obj.client,
        name: "Site",
        id: newRec.site.id
    }, true);

    if (!site) {
        return Promise.reject("Invalid site");
    }

    newRec.number = "(" + site.code + ") " + item.number;

    if (!newRec.status) {
        newRec.status = "A";
    }
}

f.datasource.registerFunction(
    "POST",
    "Inventory",
    doInsertInventory,
    f.datasource.TRIGGER_BEFORE
);

function doUpdateInventory(obj) {
    return new Promise(function (resolve) {
        let newRec = obj.newRec;

        newRec.projected = newRec.available.plus(
            newRec.onOrder
        ).minus(newRec.demand);

        resolve();
    });
}

f.datasource.registerFunction(
    "PATCH",
    "Inventory",
    doUpdateInventory,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Inventory",
    function (obj) {
        let oldRec = obj.oldRec;
        let newRec = obj.newRec;

        if (oldRec.quantity >= 0 && newRec.quantity < 0) {
            let txt = (
                `Inventory ${newRec.number} ` +
                `has dropped below zero to ${newRec.quantity}`
            );

            let theTenant = obj.client.tenant();
            let currUser = obj.client.currentUser();

            obj.client.onCommit(function () {
                f.datasource.request({
                    data: {
                        category: "Inventory",
                        message: txt,
                        relation: {
                            code: newRec.number,
                            id: newRec.id,
                            objectType: "Inventory"
                        },
                        severity: "Critical"
                    },
                    method: "POST",
                    name: "Alert",
                    tenant: theTenant,
                    user: currUser
                }, true);
            });
        }
    },
    f.datasource.TRIGGER_AFTER
);
