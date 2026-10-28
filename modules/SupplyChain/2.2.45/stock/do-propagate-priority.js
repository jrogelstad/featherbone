/*jslint devel unordered*/
function doPropPriority(obj) {
    return new Promise(function (resolve, reject) {
        function fetchAlloc() {
            return Promise.all([
                f.datasource.request({
                    method: "GET",
                    name: "Demand",
                    properties: ["id", "priority"],
                    client: obj.client,
                    id: obj.data.demandId
                }, true),
                f.datasource.request({
                    method: "GET",
                    name: "Allocation",
                    client: obj.client,
                    filter: {criteria: [{
                        property: "demand.id",
                        value: obj.data.demandId
                    }, {
                        property: "supply.objectType",
                        operator: "!=",
                        value: "Inventory"
                    }]}
                }, true)
            ]);
        }

        function process(resp) {
            return new Promise(function (resolve, reject) {
                let dmd = resp[0];
                let allocs = resp[1];
                let requests = [];

                if (!dmd || !allocs.length) {
                    resolve();
                    return;
                }

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

                allocs.forEach(function (alloc) {
                    requests.push({
                        method: "PATCH",
                        name: "Supply",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        id: alloc.supply.id,
                        data: [{
                            op: "replace",
                            path: "/priority",
                            value: dmd.priority
                        }]
                    });
                    // Allocations are hard if high priority
                    if (dmd.priority === "1") {
                        requests.push({
                            method: "PATCH",
                            name: "Allocation",
                            client: obj.client,
                            user: obj.client.currentUser(),
                            id: alloc.id,
                            data: [{
                                op: "replace",
                                path: "/isFirm",
                                value: true
                            }]
                        });
                    }
                });
                next();
            });
        }

        Promise.resolve().then(
            fetchAlloc
        ).then(
            process
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doPropagatePriority",
    doPropPriority
);
