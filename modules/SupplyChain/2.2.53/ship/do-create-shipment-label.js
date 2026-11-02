/*jslint devel unordered*/
const weightUnitMap = {
    g: "gram",
    oz: "ounce",
    lb: "pound",
    kg: "kilogram"
};

function createShipLabel(obj) {
    return new Promise(function (resolve, reject) {
        let label;
        let isVoided = false;
        let shipment = obj.data.shipment;
        let countries;
        let shipEngineSettings;
        let stockSettings;
        let weightUnit = "gram";

        if (
            !obj.data.shipmentId &&
            !obj.data.shipment
        ) {
            reject("No shipmentId or shipment passed");
            return;
        }

        // A purchased label is paid for outside the database, so a
        // rollback of the request that bought it cannot take it back.
        // Whoever calls this shares the request's client, so a failure
        // anywhere later in that request (shipping, printing, ...) rolls
        // back after the label is already bought. Void it once the
        // rollback is done, from a separate request since the original
        // transaction is gone. If ShipEngine will not void it, say so,
        // because the label is then paid for and unaccounted for.
        function voidOnRollback(purchased) {
            let theUser = obj.client.currentUser();
            let theTenant = obj.client.tenant();

            obj.client.onRollback(async function () {
                let msg;

                if (isVoided) {
                    return;
                }

                try {
                    await f.datasource.request({
                        method: "POST",
                        name: "doVoidShipEngineLabel",
                        user: theUser,
                        data: {labelId: purchased.labelId},
                        tenant: theTenant
                    }, true);
                    isVoided = true;
                } catch (e) {
                    msg = (
                        typeof e === "object" && e !== null
                        ? e.message
                        : e
                    );
                    await f.datasource.request({
                        method: "POST",
                        name: "Alert",
                        user: theUser,
                        data: {
                            category: "Shipping",
                            severity: "Critical",
                            message: (
                                "ShipEngine label " + purchased.labelId +
                                " was purchased but could not be voided " +
                                "after the request that bought it failed. " +
                                "Void it in ShipEngine to avoid being " +
                                "charged for it. Error: " + msg
                            )
                        },
                        tenant: theTenant
                    }, true);
                }
            });
        }

        function doReject(e) {
            if (label) {
                f.datasource.request({
                    method: "Post",
                    name: "doVoidShipEngineLabel",
                    client: obj.client,
                    data: {labelId: label.labelId}
                }, true).then(function () {
                    isVoided = true;
                    reject(e);
                }).catch(function () {
                    reject(e);
                });
                return;
            }
            reject(e);
        }
        async function getShipment() {
            let requests = [];
            let shp;
            if (shipment) {
                requests.push(Promise.resolve(shipment));
            } else {
                shp = await f.datasource.request({
                    method: "GET",
                    name: "Shipment",
                    client: obj.client,
                    id: obj.data.shipmentId,
                    properties: ["id", "objectType"]
                }, true);
                requests.push(f.datasource.request({
                    method: "GET",
                    name: shp.objectType,
                    client: obj.client,
                    id: obj.data.shipmentId
                }, true));
            }
            requests.push(f.datasource.request({
                method: "GET",
                name: "Country",
                properties: ["code", "name"],
                client: obj.client
            }, true));
            requests.push(f.datasource.request({
                method: "GET",
                name: "getSettings",
                client: obj.client,
                user: obj.client.currentUser(),
                data: {name: "shipEngineSettings"}
            }, true));
            requests.push(f.datasource.request({
                method: "GET",
                name: "getSettings",
                client: obj.client,
                user: obj.client.currentUser(),
                data: {name: "stockSettings"}
            }, true));
            return Promise.all(requests);
        }

        function getShipEngineDocs(resp) {
            shipment = resp[0];
            countries = resp[1];
            shipEngineSettings = resp[2];
            stockSettings = resp[3];

            if (stockSettings && stockSettings.weightUnit) {
                weightUnit = weightUnitMap[stockSettings.weightUnit];
            }

            let err;
            let requests = [];

            if (!shipment) {
                return Promise.reject("Shipment not found");
            }

            if (!shipment.lines.some((ln) => ln.quantity > 0)) {
                return Promise.reject("No quantities have been set to ship");
            }

            if (!shipEngineSettings || !shipEngineSettings.shipWeightUnit) {
                return Promise.reject(
                    "Ship weight unit must be set in ship settings"
                );
            }

            if (!shipment.containers.length) {
                shipment.lines.every(function (ln) {
                    let item = ln.item;
                    if (item.weight <= 0) {
                        err = (
                            "Item number " + item.number +
                            " must have a positve weight defined"
                        );
                        return false;
                    }
                });
            }

            if (err) {
                return Promise.reject(err);
            }

            if (!shipment.shipTo) {
                return Promise.reject(
                    "Shipment " + shipment.number +
                    " requires a ship to address"
                );
            }

            if (!shipment.site.address) {
                return Promise.reject(
                    "Site " + shipment.site.code +
                    " requires a ship from address"
                );
            }

            if (!shipment.shipMethod) {
                return Promise.reject(
                    "Shipment " + shipment.number +
                    " requires a ship engine ship method to create a label"
                );
            }

            requests.push(
                f.datasource.request({
                    method: "GET",
                    name: "ShipEngineService",
                    client: obj.client,
                    id: shipment.shipMethod.id
                }, true)
            );
            if (shipment.packageType) {
                requests.push(
                    f.datasource.request({
                        method: "GET",
                        name: "ShipEnginePackage",
                        client: obj.client,
                        id: shipment.packageType.id
                    }, true)
                );
            }
            return Promise.all(requests);
        }
        function createLabel(resp) {
            let shipMethod = resp[0];
            let packageType = resp[1];
            let pc = (
                packageType
                ? packageType.packageCode
                : "package"
            );

            if (!shipMethod) {
                return Promise.reject(
                    "Ship method " + shipment.shipMethod.code +
                    " is not a ShipEngine service"
                );
            }

            if (shipment.labelId && !shipment.labelVoid) { // Already exists
                return Promise.resolve(false);
            }

            let toAddr = shipment.shipTo;
            let frAddr = shipment.site.address;
            let weight = 0;
            let pkgs = [];
            let toCountry = countries.find((c) => toAddr.country === c.name);
            let frCountry = countries.find((c) => frAddr.country === c.name);
            let cstms;

            if (!toCountry) {
                return Promise.reject("Ship to country required");
            }

            if (!frCountry) {
                return Promise.reject("Ship from country required");
            }

            if (!shipment.containers.length) {
                shipment.lines.forEach(function (ln) {
                    if (ln.quantity > 0) {
                        weight = weight.plus(
                            ln.item.weight.times(
                                ln.quantity
                            )
                        );
                    }
                });
                pkgs = [{
                    packageCode: pc,
                    weight: {
                        value: weight,
                        unit: weightUnit
                    },
                    dimensions: {
                        length: 0,
                        width: 0,
                        height: 0,
                        unit: "inch"
                    }
                }];
            } else {
                shipment.containers.forEach(function (cnt) {
                    pkgs.push({
                        packageCode: pc,
                        weight: {
                            value: cnt.weight,
                            unit: shipEngineSettings.shipWeightUnit
                        },
                        dimensions: {
                            length: cnt.container.length,
                            width: cnt.container.width,
                            height: cnt.container.height,
                            unit: "inch"
                        }
                    });
                });
            }

            if (shipment.shipMethod.international) {
                cstms = {
                    contents: shipment.contents,
                    customsItems: shipment.customsItems.map(function (ci) {
                        return {
                            countryOfOrigin: ci.countryOfOrigin,
                            description: ci.description,
                            harmonizedTariffCode: ci.harmonizedTariffCode,
                            quantity: ci.quantity,
                            sku: ci.sku,
                            skuDescription: ci.skuDescription,
                            value: {
                                amount: ci.value.amount,
                                currency: ci.value.currency.toLowerCase()
                            }
                        };
                    }),
                    nonDelivery: shipment.nonDelivery
                };
            }

            return f.datasource.request({
                method: "POST",
                name: "doCreateShipEngineLabel",
                client: obj.client,
                data: {
                    customs: cstms,
                    serviceCode: shipMethod.serviceCode,
                    externalOrderId: (
                        shipment.reference || shipment.purchaseOrder
                    ),
                    externalShipmentId: shipment.number,
                    shipTo: {
                        name: toAddr.name,
                        addressLine1: toAddr.street,
                        addressLine2: toAddr.unit,
                        cityLocality: toAddr.city,
                        stateProvince: toAddr.state,
                        postalCode: toAddr.postalCode,
                        countryCode: toCountry.code,
                        addressResidentialIndicator: (
                            toAddr.type === "H"
                            ? "yes"
                            : "no"
                        )
                    },
                    shipFrom: {
                        name: shipment.site.description,
                        phone: shipment.site.address.phone,
                        addressLine1: frAddr.street,
                        addressLine2: frAddr.unit,
                        cityLocality: frAddr.city,
                        stateProvince: frAddr.state,
                        postalCode: frAddr.postalCode,
                        countryCode: frCountry.code,
                        addressResidentialIndicator: (
                            frAddr.type === "H"
                            ? "yes"
                            : "no"
                        )
                    },
                    packages: pkgs
                }
            });
        }

        function updateShipment(resp) {
            return new Promise(function (resolve, reject) {
                label = resp;

                if (label !== false) {
                    voidOnRollback(label);
                }

                if (obj.data.shipment || label === false) {
                    resolve(label);
                    return;
                }

                f.datasource.request({
                    method: "PATCH",
                    name: "Shipment",
                    client: obj.client,
                    eventKey: obj.eventKey,
                    id: shipment.id,
                    data: [{
                        op: "replace",
                        path: "/labelId",
                        value: label.labelId
                    }, {
                        op: "replace",
                        path: "/labelUrl",
                        value: label.labelDownload.pdf
                    }, {
                        op: "replace",
                        path: "/trackingNumber",
                        value: label.trackingNumber
                    }, {
                        op: "replace",
                        path: "/freightCharges",
                        value: {
                            amount: label.shipmentCost.amount,
                            currency: label.shipmentCost.currency.toUpperCase()
                        }
                    }, {
                        op: "replace",
                        path: "/labelVoid",
                        value: false
                    }]
                }, true).then(resolve).catch(reject);
            });
        }

        function doResolve() {
            resolve(label);
        }

        Promise.resolve().then(
            getShipment
        ).then(
            getShipEngineDocs
        ).then(
            createLabel
        ).then(
            updateShipment
        ).then(
            doResolve
        ).catch(
            doReject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doCreateShipmentLabel",
    createShipLabel
);