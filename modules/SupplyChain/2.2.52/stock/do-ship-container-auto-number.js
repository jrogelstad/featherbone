f.datasource.registerFunction(
    "POST",
    "doShipContainerAutoNumber",
    async function doBeforeInsert(obj) {
        return await f.datasource.request({
            client: obj.client,
            data: {name: "ShipmentContainer"},
            method: "POST",
            name: "autoNumber",
            user: obj.client.currentUser()
        }, true);
    }
);
