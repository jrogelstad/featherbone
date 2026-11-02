/*jslint*/
/**
  Service handler
*/
function doPolicyCheck(obj) {
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
        invalidsites.forEach(function (s) {
            s.planningPolicy = "L";
        });
    }
}

f.datasource.registerFunction(
    "POST",
    "Service",
    doPolicyCheck,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Service",
    doPolicyCheck,
    f.datasource.TRIGGER_BEFORE
);
