/*jslint unordered*/
/*global*/

/**
  Bill of material handler
*/

function doBeforeUpsertBom(obj) {
    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;

        if (newRec.batchSize <= 0) {
            reject("Batch size must be positive");
            return;
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "BillOfMaterial",
    doBeforeUpsertBom,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "BillOfMaterial",
    doBeforeUpsertBom,
    f.datasource.TRIGGER_BEFORE
);
