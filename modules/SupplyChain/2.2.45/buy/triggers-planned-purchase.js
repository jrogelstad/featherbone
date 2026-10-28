/*jslint*/
function doPOUpsert(obj) {
    return new Promise(function (resolve, reject) {
        if (!obj.newRec.price) {
            reject("Price is required");
            return;
        }
        if (!obj.newRec.price.currency) {
            reject("Price currency is required");
            return;
        }
        if (!obj.newRec.orderQuantity) {
            reject("Order quantity must be greater than zero");
            return;
        }
        obj.newRec.amount = {
            amount: obj.newRec.price.amount.times(obj.newRec.orderQuantity),
            currency: obj.newRec.price.currency
        };
        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "PlannedPurchase",
    doPOUpsert,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "PlannedPurchase",
    doPOUpsert,
    f.datasource.TRIGGER_BEFORE
);
