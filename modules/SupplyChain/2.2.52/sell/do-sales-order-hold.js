/*jslint devel*/
function doSoHold(obj) {
    let isHold = obj.data.hold;
    let isRecurse = obj.data.recursive;
    let soId = obj.data.salesOrderId;
    let so;
    let msg = (
        obj.data.hold
        ? "Sales order put on hold"
        : "Sales order taken off hold"
    );
    let lockMsg = (
        obj.data.hold
        ? "Put order on hold"
        : "Take order off hold"
    );
    let demandIds = [];
    let eKey = f.createId();

    return new Promise(function (resolve, reject) {
        function fetchSo() {
            return Promise.all([
                f.datasource.request({
                    client: obj.client,
                    id: soId,
                    method: "GET",
                    name: "SalesOrder",
                    properties: ["id", "status", "lines", "onHold"]
                }, true),
                f.datasource.lock(
                    soId,
                    obj.client.currentUser(),
                    eKey,
                    lockMsg,
                    obj.client
                )
            ]);
        }

        function process() {
            return f.datasource.request({
                client: obj.client,
                data: [{
                    op: "replace",
                    path: "/onHold",
                    value: isHold
                }],
                eventKey: eKey,
                id: soId,
                method: "PATCH",
                name: "SalesOrder",
                user: obj.client.currentUser()
            }, true);
        }

        function doRecurse(resp) {
            return new Promise(function (resolve, reject) {
                let requests = [];
                so = resp[0];

                if (!so) {
                    reject("Sales order not found");
                    return;
                }

                if (so.status !== "A" && so.status !== "B") {
                    reject(
                        "Only active sales orders may be put on hold"
                    );
                }

                so.lines.forEach(function (ln) {
                    if (ln.status !== "C" && ln.allocated) {
                        demandIds.push(ln.id);
                    }
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

                function callback(resp) {
                    resp.forEach(function (alc) {
                        requests.push({
                            client: obj.client,
                            data: {
                                hold: isHold,
                                recursive: true,
                                workOrderId: alc.supply.id
                            },
                            method: "POST",
                            name: "doPropagateWorkOrderHold"
                        });
                    });
                    next();
                }

                if (isRecurse) {
                    f.datasource.request({
                        client: obj.client,
                        filter: {criteria: [{
                            operator: "IN",
                            property: "demand.id",
                            value: demandIds
                        }, {
                            property: "supply.objectType",
                            value: "WorkOrder"
                        }]},
                        method: "GET",
                        name: "Allocation"
                    }, true).then(callback).catch(reject);
                    return;
                }
                resolve();
            });
        }

        Promise.resolve().then(
            fetchSo
        ).then(
            doRecurse
        ).then(
            process
        ).then(
            resolve.bind(null, msg)
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doSalesOrderHold",
    doSoHold
);
