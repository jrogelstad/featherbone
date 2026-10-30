/*jslint devel browser unordered*/
const ShipEngine = f.Shipengine;
const shipEngines = {};

if (!f.isInstalling()) {
    f.shipEngine = async function (pClient) {
        if (!pClient.database) {
            throw (
                "Ship engine cannot be initialized " +
                "without specifying a database."
            );
        }
        if (shipEngines[pClient.database]) {
            return shipEngines[pClient.database];
        }

        try {
            let conf = await f.datasource.config();
            let seSettings = await f.datasource.request({
                client: pClient,
                method: "GET",
                name: "getSettings",
                user: conf.pgUser,
                data: {name: "shipEngineSettings"},
                tenant: false
            }, true);
            if (seSettings && seSettings.apiKey) {
                shipEngines[pClient.database] =
                new ShipEngine(seSettings.apiKey);
                return shipEngines[pClient.database];
            }
            return false;
        } catch (e) {
            return Promise.reject(e);
        }
    };
}

async function createLabel(obj) {
    let params = {
        shipment: {
            customs: obj.data.customs,
            serviceCode: obj.data.serviceCode,
            shipTo: obj.data.shipTo,
            shipFrom: obj.data.shipFrom,
            packages: obj.data.packages
        }
    };
    let shipEngine = await f.shipEngine(obj.client);

    return shipEngine.createLabelFromShipmentDetails(
        params
    );
}

f.datasource.registerFunction(
    "POST",
    "doCreateShipEngineLabel",
    createLabel
);

async function voidLabel(obj) {
    let shipEngine = await f.shipEngine(obj.client);
    try {
        return await shipEngine.voidLabelWithLabelId(
            obj.data.labelId
        );
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doVoidShipEngineLabel",
    voidLabel
);

f.datasource.registerFunction(
    "DELETE",
    "ShipEngineCarrier",
    function (obj) {
        obj.isHard = true;
        return Promise.resolve();
    },
    f.datasource.TRIGGER_BEFORE
);
