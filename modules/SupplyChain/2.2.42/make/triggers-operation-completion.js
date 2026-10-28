/*jslint*/
async function doBeforeInsert(obj) {
    let oc = obj.newRec;
    let emp;

    if (!obj.newRec.operation) {
        throw "Operation is required";
    }

    if (!obj.newRec.quantity || obj.newRec.quantity < 0) {
        throw "Quantity must be greater than zero";
    }

    let op = await f.datasource.request({
        client: obj.client,
        id: obj.newRec.operation.id,
        method: "GET",
        name: "WorkOrderOperation",
        properties: ["id"]
    }, true);

    if (!op) {
        throw "Operation not found";
    }

    if (!oc.employee) {
        emp = await f.datasource.request({
            client: obj.client,
            filter: {criteria: [{
                property: "userAccount",
                value: obj.client.currentUser()
            }]},
            method: "GET",
            name: "Employee",
            properties: ["id"]
        }, true);

        if (!emp.length) {
            throw (
                "No employee record found for account " +
                obj.client.currentUser()
            );
        }

        oc.employee = emp[0];
    }

    obj.newRec.isPosted = false;
}

f.datasource.registerFunction(
    "POST",
    "OperationCompletion",
    doBeforeInsert,
    f.datasource.TRIGGER_BEFORE
);

function doAfterInsert(obj) {
    let username = obj.client.currentUser();
    let theTenant = obj.client.tenant();
    let theid = obj.newRec.id;
    obj.client.onCommit(function () {
        return f.datasource.request({
            data: {id: theid},
            method: "POST",
            name: "doPostOperationCompletion",
            tenant: theTenant,
            user: username
        }, true);
    });
    return Promise.resolve();
}

f.datasource.registerFunction(
    "POST",
    "OperationCompletion",
    doAfterInsert,
    f.datasource.TRIGGER_AFTER
);