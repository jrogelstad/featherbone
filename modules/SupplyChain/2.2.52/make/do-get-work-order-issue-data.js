/*jslint unordered devel*/
async function getWO(obj) {
    let wo = await f.datasource.request({
        method: "GET",
        name: "WorkOrder",
        properties: [
            "id",
            "site",
            "number",
            "status",
            "onHold",
            "materials",
            "operations"
        ],
        client: obj.client,
        id: obj.data.id
    }, true);
    let is = await f.datasource.request({
        method: "GET",
        name: "ItemSite",
        properties: [
            "id",
            "item",
            "site",
            "issueMethod"
        ],
        client: obj.client,
        filter: {
            criteria: [{
                property: "site.id",
                value: wo.site.id
            }, {
                operator: "IN",
                property: "item.id",
                value: wo.materials.map((m) => m.item.id)
            }]
        }
    }, true);
    let site = await f.datasource.request({
        method: "GET",
        name: "Site",
        client: obj.client,
        id: wo.site.id,
        properties: [
            "id",
            "code",
            "defaultLocation",
            "defaultWipLocation",
            "locationControlled"
        ]
    }, true);
    wo.site = site;

    wo.materials = wo.materials.filter(function (m) {
        let mis = is.find((i) => (
            i.site.id === m.site.id &&
            i.item.id === m.item.id
        ));
        return mis && mis.issueMethod === "M";
    });

    return wo;
}

f.datasource.registerFunction(
    "POST",
    "doGetWorkOrderIssueData",
    getWO
);