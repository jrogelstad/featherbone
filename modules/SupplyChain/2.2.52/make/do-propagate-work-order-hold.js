/*jslint unordered*/
function doPropWoHold(obj) {
    let isHold = obj.data.hold;
    let isRecurse = obj.data.recursive;
    let woId = obj.data.workOrderId;
    let wo;
    let msg = (
        isHold
        ? "Work order(s) put on hold"
        : "Work order(s) taken off hold"
    );

    return new Promise(function (resolve, reject) {
        function fetchWo() {
            return f.datasource.request({
                method: "GET",
                name: "WorkOrder",
                properties: ["id", "status", "materials", "operations"],
                client: obj.client,
                id: woId
            }, true);
        }

        function process(resp) {
            let dat = [{
                op: "replace",
                path: "/onHold",
                value: isHold
            }];
            let n = 0;
            wo = resp;

            if (!wo) {
                resolve();
                return;
            }

            wo.operations.forEach(function (op) {
                if (op.status !== "C") {
                    dat.push({
                        op: "replace",
                        path: "/operations/" + n + "/onHold",
                        value: isHold
                    });
                }
                n += 1;
            });

            return f.datasource.request({
                method: "PATCH",
                name: "WorkOrder",
                client: obj.client,
                user: obj.client.currentUser(),
                id: woId,
                data: dat
            }, true);
        }

        function doRecurse() {
            return new Promise(function (resolve, reject) {
                let requests = [];
                function next() {
                    if (!requests.length) {
                        resolve(msg);
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
                            method: "POST",
                            name: "doPropagateWorkOrderHold",
                            client: obj.client,
                            data: {
                                hold: isHold,
                                recursive: isRecurse,
                                workOrderId: alc.supply.id
                            }
                        });
                    });
                    next();
                }

                if (isRecurse) {
                    f.datasource.request({
                        method: "GET",
                        name: "Allocation",
                        client: obj.client,
                        filter: {criteria: [{
                            property: "demand.id",
                            operator: "IN",
                            value: wo.materials.map((r) => r.id)
                        }, {
                            property: "supply.objectType",
                            value: "WorkOrder"
                        }, {
                            property: "isFirm",
                            value: true
                        }]}
                    }, true).then(callback).catch(reject);
                    return;
                }
                resolve(msg);
            });
        }

        Promise.resolve().then(
            fetchWo
        ).then(
            process
        ).then(
            doRecurse
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doPropagateWorkOrderHold",
    doPropWoHold
);
