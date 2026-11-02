/*jslint unordered*/
function doBeforeUpsert(obj) {
    return new Promise(function (resolve, reject) {
        if (!obj.newRec.fromUnit) {
            reject("From unit is required");
            return;
        }

        if (!obj.newRec.toUnit) {
            reject("To unit is required");
            return;
        }

        function callback(resp) {
            let units = resp[0];
            if (resp[1].length || resp[2].length) {
                reject(
                    "Conversion between \"" + units.find(
                        (u) => u.id === obj.newRec.fromUnit.id
                    ).code + "\" and \"" +
                    units.find(
                        (u) => u.id === obj.newRec.toUnit.id
                    ).code + "\" already exists"
                );
                return;
            }
            resolve();
        }

        Promise.all([
            f.datasource.request({
                method: "GET",
                name: "ItemUnit",
                client: obj.client,
                filter: {criteria: [{
                    property: "id",
                    operator: "IN",
                    value: [obj.newRec.fromUnit.id, obj.newRec.toUnit.id]
                }]}
            }, true),
            f.datasource.request({
                method: "GET",
                name: "ItemUnitConversion",
                client: obj.client,
                filter: {criteria: [{
                    property: "fromUnit.id",
                    value: obj.newRec.fromUnit.id
                }, {
                    property: "toUnit.id",
                    value: obj.newRec.toUnit.id
                }, {
                    property: "id",
                    operator: "!=",
                    value: obj.newRec.id
                }]}
            }, true),
            f.datasource.request({
                method: "GET",
                name: "ItemUnitConversion",
                client: obj.client,
                filter: {criteria: [{
                    property: "fromUnit.id",
                    value: obj.newRec.toUnit.id
                }, {
                    property: "toUnit.id",
                    value: obj.newRec.fromUnit.id
                }, {
                    property: "id",
                    operator: "!=",
                    value: obj.newRec.id
                }]}
            }, true)
        ]).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "ItemUnitConversion",
    doBeforeUpsert,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "ItemUnitConversion",
    doBeforeUpsert,
    f.datasource.TRIGGER_BEFORE
);