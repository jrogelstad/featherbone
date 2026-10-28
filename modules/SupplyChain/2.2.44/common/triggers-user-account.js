/*jslint*/
async function doUserAccountUpsert(obj) {
    await f.datasource.request({
        client: obj.client,
        data: [{
            op: "replace",
            path: "/userAccount",
            value: obj.newRec.name
        }],
        id: obj.newRec.contact.id,
        method: "PATCH",
        name: "Employee"
    });
}

f.datasource.registerFunction(
    "POST",
    "UserAccount",
    doUserAccountUpsert,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "UserAccount",
    doUserAccountUpsert,
    f.datasource.TRIGGER_AFTER
);
