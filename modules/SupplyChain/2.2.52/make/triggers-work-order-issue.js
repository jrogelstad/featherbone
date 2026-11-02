/*jslint unordered*/
function doInsertWorkOrderIssueAfter(obj) {
    let theUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();

    // Auto post on save
    obj.client.onCommit(function () {
        return f.datasource.request({
            method: "POST",
            name: "doPostWorkOrderIssues",
            // Asynchronous call
            user: theUser,
            data: {ids: [obj.newRec.id]},
            tenant: theTenant
        }, true);
    });
}

f.datasource.registerFunction(
    "POST",
    "WorkOrderIssue",
    doInsertWorkOrderIssueAfter,
    f.datasource.TRIGGER_AFTER
);