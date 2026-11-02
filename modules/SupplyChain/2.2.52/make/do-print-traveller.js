/*jslint unordered*/
/*global console*/

// This traveller function adds ship to name to form
// which is calculated since no support for dot notation yet
function doPrintTraveller(obj) {
    return new Promise(function (resolve, reject) {
        if (!obj.data.ids) {
            reject("A work order Id or Ids must be provided");
            return;
        }

        function fetch() {
            return f.datasource.request({
                method: "GET",
                name: "WorkOrder",
                client: obj.client,
                filter: {criteria: [{
                    property: "id",
                    operator: "IN",
                    value: obj.data.ids
                }]}
            }, true);
        }

        function process(wos) {
            if (!wos.length) {
                return Promise.reject("Work Orders not found");
            }

            wos.forEach(function (wo) {
                wo.shipToName = (
                    (wo.salesOrder && wo.salesOrder.shipTo)
                    ? wo.salesOrder.shipTo.name
                    : ""
                );
            });

            return f.datasource.printPdfForm(
                obj.data.form,
                wos,
                wos.map((wo) => wo.number).toString(),
                obj.client.currentUser(),
                {},
                obj.client.tenant()
            );
        }

        Promise.resolve().then(
            fetch
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
    "doPrintTraveller",
    doPrintTraveller
);