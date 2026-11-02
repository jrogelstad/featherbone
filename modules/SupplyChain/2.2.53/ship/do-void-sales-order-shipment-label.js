/*jslint unordered*/
function voidShipLabel(obj) {
    return new Promise(function (resolve, reject) {
        let shipment = obj.data.shipment;
        let eKey = f.createId();

        if (!obj.data.shipmentId) {
            reject("No shipmentId passed");
            return;
        }

        function getShipment() {
            return f.datasource.request({
                method: "GET",
                name: "SalesOrderShipment",
                properties: ["id", "labelId", "labelVoid"],
                client: obj.client,
                id: obj.data.shipmentId
            }, true);
        }

        async function lockShipment(resp) {
            shipment = resp;

            if (!shipment) {
                return Promise.reject("Shipment not found");
            }

            if (!shipment.labelId) {
                return Promise.reject("Shipment has no label");
            }

            if (shipment.labelVoid) {
                return Promise.reject("Label is already void");
            }

            await f.datasource.lock(
                shipment.id,
                obj.client.currentUser(),
                eKey,
                "Voiding ship label",
                obj.client
            );
        }

        function voidLabel() {
            return f.datasource.request({
                method: "POST",
                name: "doVoidShipEngineLabel",
                client: obj.client,
                data: {labelId: shipment.labelId}
            }, true);
        }

        function updateShipment() {
            return new Promise(function (resolve, reject) {
                f.datasource.request({
                    method: "PATCH",
                    name: "Shipment",
                    client: obj.client,
                    eventKey: eKey,
                    id: obj.data.shipmentId,
                    data: [{
                        op: "replace",
                        path: "/labelVoid",
                        value: true
                    }]
                }, true).then(resolve).catch(reject);
            });
        }
        Promise.resolve().then(
            getShipment
        ).then(
            lockShipment
        ).then(
            voidLabel
        ).then(
            updateShipment
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doVoidSalesOrderShipmentLabel",
    voidShipLabel
);