/*jslint unordered*/
/*global console*/

function doCreatePhysicalCount(obj) {
    let d = obj.data;
    let currCode;

    return new Promise(function (resolve, reject) {
        function preFetch() {
            let requests = [
                f.datasource.request({
                    method: "GET",
                    name: "PhysicalCount",
                    properties: ["id"],
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "isActive",
                            value: true
                        }]
                    }
                }, true),
                f.datasource.request({
                    method: "GET",
                    name: "Currency",
                    properties: ["code"],
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "isBase",
                            value: true
                        }]
                    }
                }, true)
            ];

            return Promise.all(requests);
        }

        function fetchInventory(resp) {
            let count = resp[0];
            let curr = resp[1][0];
            let params = [{
                property: "item.status",
                value: "A"
            }];
            let dt = f.parseDate(f.today());

            if (count.length) {
                return Promise.reject(
                    "Active count must be closed before creating a new one"
                );
            }

            if (!curr) {
                return Promise.reject(
                    "No base currency found"
                );
            }
            currCode = curr.code;

            if (!d.site) {
                return Promise.reject(
                    "Site must be specified"
                );
            }

            params.push({
                property: "site.id",
                value: d.site.id
            });

            if (d.abcClass) {
                params.push({
                    property: "itemSite.abcClass",
                    value: d.abcClass
                });
            }

            if (d.item) {
                params.push({
                    property: "item.id",
                    value: d.item.id
                });
            }

            if (d.category) {
                params.push({
                    property: "item.category.id",
                    value: d.category.id
                });
            }

            if (d.group) {
                params.push({
                    property: "item.group.id",
                    value: d.group.id
                });
            }

            if (d.hasQuantity) {
                params.push({
                    property: "quantity",
                    operator: "!=",
                    value: 0
                });
            }

            if (d.useDays && d.days) {
                dt.setDate(dt.getDate() - d.days);
                params.push({
                    property: "lastCount",
                    operator: "<=",
                    value: dt.toLocalDate()
                });
            }

            return f.datasource.request({
                method: "GET",
                name: "Inventory",
                client: obj.client,
                properties: [
                    "id",
                    "item",
                    "lastCount",
                    "locations",
                    "quantity",
                    "traced"
                ],
                filter: {
                    criteria: params,
                    sort: [{
                        property: "lastCount"
                    }, {
                        property: "item.number"
                    }]
                }
            }, true);
        }

        function process(resp) {
            let ct = 0;
            let nr = d.startTagNr || 1;
            let pc = {
                description: d.description,
                site: {id: d.site.id},
                tags: []
            };

            if (!resp.length) {
                return Promise.reject(
                    "No eligible inventory records found to create tags"
                );
            }

            // Build tag list
            resp.every(function (inv) {
                let cost = inv.item.cost.amount;
                let tag = {
                    inventory: {id: inv.id},
                    item: {id: inv.item.id, number: inv.item.number},
                    oldQuantity: inv.quantity,
                    oldValue: {currency: currCode, amount: 0},
                    newValue: {currency: currCode, amount: 0},
                    valueChange: {currency: currCode, amount: 0}
                };
                let done = false;

                function addTag(rec) {
                    let ltag = f.copy(tag);

                    if (
                        d.useLocationRange &&
                        (
                            !rec.location ||
                            rec.location.name < d.fromLocation.name ||
                            rec.location.name > d.toLocation.name
                        )
                    ) {
                        return true; // Skip and keep going
                    }

                    if (
                        !d.useLocationRange && d.fromLocation &&
                        (
                            !rec.location ||
                            rec.location.id !== d.fromLocation.id
                        )
                    ) {
                        return true; // Skip and keep going
                    }

                    ltag.oldQuantity = rec.quantity;
                    ltag.quantityChange = rec.quantity.times(-1);
                    ltag.oldValue.amount = ltag.oldQuantity.times(cost);
                    ltag.valueChange.amount = ltag.oldQuantity.times(
                        cost
                    ).times(-1);
                    if (rec.trace) {
                        ltag.traceNumber = {
                            id: rec.trace.id,
                            number: rec.trace.number
                        };
                    }
                    if (rec.location) {
                        ltag.location = {
                            id: rec.location.id,
                            name: rec.location.name
                        };
                    }
                    pc.tags.push(ltag);
                    ct += 1;
                    done = d.useMax && ct === d.max;

                    return !done;
                }

                if (inv.traced.length) {
                    inv.traced.every(addTag);
                } else if (inv.locations.length) {
                    inv.locations.every(addTag);
                } else {
                    tag.quantityChange = tag.oldQuantity.times(-1);
                    tag.oldValue.amount = tag.oldQuantity.times(cost);
                    tag.valueChange.amount = tag.oldQuantity.times(
                        cost
                    ).times(-1);
                    pc.tags.push(tag);
                    ct += 1;
                    done = d.useMax && ct === d.max;
                }

                return !done;
            });

            // Sort tages by location, item, trace
            pc.tags.sort(function (a, b) {
                if (a.location || b.location) {
                    if (a.location && !b.location) {
                        return -1;
                    }

                    if (!a.location && b.location) {
                        return 1;
                    }

                    if (a.location.name > b.location.name) {
                        return 1;
                    }

                    if (a.location.name < b.location.name) {
                        return -1;
                    }
                }

                if (a.item.number > b.item.number) {
                    return 1;
                }

                if (a.item.number < b.item.number) {
                    return -1;
                }

                if (a.tracenumber && a.traceNumber.number) {
                    if (a.traceNumber.number > b.traceNumber.number) {
                        return 1;
                    }

                    if (a.traceNumber.number < b.traceNumber.number) {
                        return -1;
                    }
                }

                return 0; // Should never get here
            });

            // Number tags
            pc.tags.forEach(function (tag) {
                tag.number = nr;
                nr += 1;
            });

            return f.datasource.request({
                method: "POST",
                name: "PhysicalCount",
                client: obj.client,
                data: pc
            }, true);
        }

        Promise.resolve().then(
            preFetch
        ).then(
            fetchInventory
        ).then(
            process
        ).then(
            resolve.bind(null, "Physical count created successfully")
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doCreatePhysicalCount",
    doCreatePhysicalCount
);