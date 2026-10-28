/*jslint  unordered*/
function doPCInsert(obj) {
    return new Promise(function (resolve, reject) {
        if (!obj.newRec.site) {
            reject("Site required");
            return;
        }

        function fetchInv() {
            return f.datasource.request({
                method: "GET",
                name: "Inventory",
                client: obj.client,
                properties: ["id"],
                filter: {
                    criteria: [{
                        property: "site.id",
                        value: obj.newRec.site.id
                    }, {
                        property: "item.id",
                        operator: "IN",
                        value: obj.newRec.tags.map((t) => t.item.id)
                    }]
                }
            }, true);
        }

        function updateInv(resp) {
            return new Promise(function (resolve, reject) {
                let payloads = [];

                function next() {
                    if (!payloads.length) {
                        resolve();
                        return;
                    }

                    f.datasource.request(
                        payloads.shift(),
                        true
                    ).then(next).catch(reject);
                }

                resp.forEach(function (inv) {
                    payloads.push({
                        method: "PATCH",
                        name: "Inventory",
                        client: obj.client,
                        id: inv.id,
                        data: [{
                            op: "replace",
                            path: "/isActiveCount",
                            value: true
                        }]
                    });
                });

                next();
            });
        }

        Promise.resolve().then(
            fetchInv
        ).then(
            updateInv
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "PhysicalCount",
    doPCInsert,
    f.datasource.TRIGGER_AFTER
);

function doPCUpdate(obj) {
    return new Promise(function (resolve, reject) {
        let ids = obj.oldRec.tags.map((t) => t.item.id);
        let oldIds = ids.slice();
        let newIds = [];

        obj.newRec.tags.forEach(function (tag) {
            if (!tag) {
                return; // Deleted
            }
            if (ids.indexOf(tag.item.id) === -1) {
                ids.push(tag.item.id);
            }
            newIds.push(tag.item.id);
        });

        function fetchInv() {
            return f.datasource.request({
                method: "GET",
                name: "Inventory",
                client: obj.client,
                properties: ["id", "item"],
                filter: {
                    criteria: [{
                        property: "site.id",
                        value: obj.newRec.site.id
                    }, {
                        property: "item.id",
                        operator: "IN",
                        value: ids
                    }]
                }
            }, true);
        }

        function updateInv(resp) {
            return new Promise(function (resolve, reject) {
                let payloads = [];

                function next() {
                    if (!payloads.length) {
                        resolve();
                        return;
                    }

                    f.datasource.request(
                        payloads.shift(),
                        true
                    ).then(next).catch(reject);
                }

                resp.forEach(function (inv) {
                    let id = inv.item.id;
                    let payload = {
                        method: "PATCH",
                        name: "Inventory",
                        client: obj.client,
                        id: inv.id,
                        data: [{
                            op: "replace",
                            path: "/isActiveCount",
                            value: true
                        }]
                    };

                    if (
                        obj.oldRec.isActive &&
                        !obj.newRec.isActive
                    ) {
                        payload.data[0].value = false;
                        payload.data.push({
                            op: "replace",
                            path: "/lastCount",
                            value: f.today()
                        });
                        payloads.push(payload);
                    } else if (
                        obj.newRec.isActive &&
                        oldIds.indexOf(id) === -1 &&
                        newIds.indexOf(id) !== -1
                    ) {
                        payloads.push(payload);
                    } else if (
                        obj.newRec.isActive &&
                        oldIds.indexOf(id) !== -1 &&
                        newIds.indexOf(id) === -1
                    ) {
                        payload.data[0].value = false;
                        payloads.push(payload);
                    }
                });

                next();
            });
        }

        Promise.resolve().then(
            fetchInv
        ).then(
            updateInv
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "PATCH",
    "PhysicalCount",
    doPCUpdate,
    f.datasource.TRIGGER_AFTER
);

function doPCDelete(obj) {
    return new Promise(function (resolve, reject) {
        if (!obj.oldRec.isActive) {
            resolve();
            return;
        }

        function fetchInv() {
            return f.datasource.request({
                method: "GET",
                name: "Inventory",
                client: obj.client,
                properties: ["id"],
                filter: {
                    criteria: [{
                        property: "site.id",
                        value: obj.oldRec.site.id
                    }, {
                        property: "item.id",
                        operator: "IN",
                        value: obj.oldRec.tags.map((t) => t.item.id)
                    }]
                }
            }, true);
        }

        function updateInv(resp) {
            return new Promise(function (resolve, reject) {
                let payloads = [];

                function next() {
                    if (!payloads.length) {
                        resolve();
                        return;
                    }

                    f.datasource.request(
                        payloads.shift(),
                        true
                    ).then(next).catch(reject);
                }

                resp.forEach(function (inv) {
                    payloads.push({
                        method: "PATCH",
                        name: "Inventory",
                        client: obj.client,
                        id: inv.id,
                        data: [{
                            op: "replace",
                            path: "/isActiveCount",
                            value: false
                        }]
                    });
                });

                next();
            });
        }

        Promise.resolve().then(
            fetchInv
        ).then(
            updateInv
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "DELETE",
    "PhysicalCount",
    doPCDelete,
    f.datasource.TRIGGER_BEFORE
);
