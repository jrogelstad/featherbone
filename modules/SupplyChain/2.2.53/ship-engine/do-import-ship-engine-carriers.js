/*jslint devel unordered*/
async function importCarriers(obj) {
    let alert = {
        method: "POST",
        name: "Alert",
        user: obj.client.currentUser(),
        data: {
            category: "ShipEngine",
            message: "Starting ship engine carrier import"
        },
        tenant: obj.client.tenant()
    };
    let resp;
    let subscr = obj.data.subscription;
    let process;
    f.datasource.request(f.copy(alert), true);

    try {
        let shipEngine = await f.shipEngine(obj.client);
        resp = await shipEngine.listCarriers();
        // Start committing changes
        process = f.datasource.createProcess({
            client: obj.client,
            count: resp.length,
            name: "Import Ship Engine carriers",
            subscription: subscr
        });
        await process.start();

        let carrier;
        let payload;
        while (resp.length) {
            carrier = resp.shift();
            payload = {
                method: "POST",
                name: "ShipEngineCarrier",
                client: obj.client,
                id: carrier.carrierId,
                user: obj.client.currentUser(),
                data: {
                    id: carrier.carrierId,
                    code: carrier.friendlyName,
                    description: carrier.nickname,
                    carrierCode: carrier.carrierCode,
                    services: carrier.services.map(function (s) {
                        return {
                            owner: obj.client.currentUser(),
                            code: s.name,
                            description: s.name,
                            serviceCode: s.serviceCode,
                            international: s.international,
                            domestic: s.domestic,
                            isMultiPackageSupported:
                            s.isMultiPackageSupported
                        };
                    }),
                    packages: carrier.packages.map(function (p) {
                        return {
                            owner: obj.client.currentUser(),
                            name: p.name,
                            description: p.description,
                            packageCode: p.packageCode
                        };
                    })
                }
            };
            await f.datasource.request(payload, true);
            await process.next();
        }
        await process.complete();
        alert.data.message = "Ship engine carriers imported";
        f.datasource.request(f.copy(alert), true);
        return alert.data.message;
    } catch (e) {
        alert.data.severity = "Critical";
        alert.data.message = "Ship engine carriers failed";
        f.datasource.request(f.copy(alert), true);
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doImportShipEngineCarriers",
    importCarriers
);