/*jslint devel*/
/**
  Product handler
*/
async function doPolicyCheck(obj) {
    let newRec = obj.newRec;
    let oldRec = obj.oldRec;
    let oldSiteId;
    let newSiteId;
    let found;

    newRec.sites = (
        Array.isArray(newRec.sites)
        ? newRec.sites
        : []
    );

    if (oldRec && oldRec.site) {
        oldSiteId = oldRec.site.id;
    }

    if (newRec && newRec.site && newRec.site.id) {
        newSiteId = newRec.site.id;
    }

    if (!oldRec || oldSiteId !== newSiteId) {
        newRec.sites.forEach(function (row) {
            row.isPrimary = false;
        });

        if (newRec.site) {
            found = newRec.sites.find(
                (row) => row.site.id === newRec.site.id
            );

            if (found) {
                found.isPrimary = true;
            } else {
                newRec.sites.push({
                    id: f.createId(),
                    isPrimary: true,
                    site: {
                        id: newRec.site.id
                    }
                });
            }
        }
    }

    let invalidsites = obj.newRec.sites.filter((s) => s && !s.planningPolicy);

    if (invalidsites.length) {
        let settings = await f.datasource.request({
            client: obj.client,
            data: {name: "designSettings"},
            method: "GET",
            name: "getSettings"
        }, true);
        let defplnpol;

        if (obj.newRec.source === "P") {
            defplnpol = (
                (settings && settings.defaultPurchasePlanningPolicy)
                ? settings.defaultPurchasePlanningPolicy
                : "L"
            );
        } else {
            defplnpol = (
                (settings && settings.defaultManufacturePlanningPolicy)
                ? settings.defaultManufacturePlanningPolicy
                : "M"
            );
        }

        invalidsites.forEach(function (s) {
            s.planningPolicy = defplnpol;
        });
    }

    // Resequence if needed
    let cnt = 1;
    obj.newRec.billOfMaterialItems.filter(
        (m) => m
    ).sort(
        (a, b) => a.sequence - b.sequence
    ).forEach(function (m) {
        m.sequence = cnt;
        cnt += 1;
    });
}

f.datasource.registerFunction(
    "POST",
    "Product",
    doPolicyCheck,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Product",
    doPolicyCheck,
    f.datasource.TRIGGER_BEFORE
);


async function doBomCheck(obj) {
    let ibom = await f.datasource.request({
        client: obj.client,
        data: {itemId: obj.newRec.id},
        method: "POST",
        name: "doIndentedBillOfMaterial"
    }, true);

    ibom = ibom.filter((i) => i.cycle);
    if (ibom.length) {
        throw (
            "Self-referencing cycle detected on " +
            ibom.map((i) => i.product.number).join()
        );
    }
}

f.datasource.registerFunction(
    "POST",
    "Product",
    doBomCheck,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "Product",
    doBomCheck,
    f.datasource.TRIGGER_AFTER
);
