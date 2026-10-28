/*jslint unordered*/

/**
  Site handler
*/

function doUpdateSiteAfter(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let oldRec = obj.oldRec;

        if (newRec.locationControlled === oldRec.locationControlled) {
            resolve();
            return;
        }

        // Update inventory records if necessary
        function updateInventory(resp) {
            let requests = [];

            resp.forEach(function (inv) {
                if (newRec.locationControlled) {
                    inv.locations.push({
                        location: newRec.defaultLocation,
                        quantity: inv.quantity
                    });
                    inv.traced.forEach(function (trc) {
                        trc.location = newRec.defaultLocation;
                    });
                } else {
                    inv.locations.length = 0;
                    inv.traced.forEach(function (trc) {
                        trc.location = null;
                    });
                }

                requests.push({
                    method: "POST",
                    name: "Inventory",
                    id: inv.id,
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: inv
                });
            });

            function next() {
                if (!requests.length) {
                    resolve();
                    return;
                }

                f.datasource.request(
                    requests.shift(),
                    true
                ).then(next).catch(reject);
            }

            next();
        }

        f.datasource.request({
            method: "GET",
            name: "Inventory",
            properties: ["id", "locations", "traced", "quantity"],
            client: obj.client,
            filter: {
                criteria: [{
                    property: "quantity",
                    operator: ">",
                    value: 0
                }, {
                    property: "site.id",
                    value: oldRec.id
                }]
            }
        }).then(updateInventory).catch(reject);

    });
}

f.datasource.registerFunction(
    "PATCH",
    "Site",
    doUpdateSiteAfter,
    f.datasource.TRIGGER_AFTER
);