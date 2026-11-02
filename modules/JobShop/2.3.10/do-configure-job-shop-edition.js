/*jslint devel*/
async function doConfig(obj) {
    let theEdition = obj.data.edition || "";
    let execwb;
    let phycwb;
    let mksettings;
    let forms = [];
    let formId;
    const adminAuth = {
        canRead: true,
        canUpdate: true,
        id: f.createId(),
        isDeleted: false,
        objectType: "",
        role: "administrator"
    };

    if (
        theEdition !== "Standard" &&
        theEdition !== "Professional" &&
        theEdition !== "Enterprise"
    ) {
        return Promise.reject(
            "Edition must be 'Standard', 'Professional' or 'Enterprise'"
        );
    }

    try {
        execwb = await f.datasource.request({
            client: obj.client,
            data: {name: "Execute"},
            method: "GET",
            name: "getWorkbook"
        }, true);

        phycwb = await f.datasource.request({
            client: obj.client,
            data: {name: "Count"},
            method: "GET",
            name: "getWorkbook"
        }, true);

        mksettings = await f.datasource.request({
            client: obj.client,
            data: {name: "makeSettings"},
            method: "GET",
            name: "getSettings"
        }, true);

        // Forms with operations
        if (theEdition !== "Standard") {
            forms = [
                "hr96x9xr7efd", // Pro product form with operations
                "cld4cgergzup", // Pro work order form with operations
                "xbm2x8o8cx06", // Pro purchase order form with outside process
                "k8mvojz4pqaj", // Pro purchase order line child form with OP
                "8u67f8ab5x52" // Pro work order issue form with operation
            ];

            // Authorize Execute workbook
            if (!execwb.authorizations.find(
                (a) => a.role === "administrator"
            )) {
                execwb.authorizations.push(adminAuth);
            }

            // Set traveler type
            mksettings.traveler = {
                description: "Work order print form with operations",
                id: "5mgc0t9e26ij",
                name: "Print Work Order Traveller (Pro)"
            };
        } else {
            forms = [
                "zi42j43ii6lo", // Standard product form
                "3bvqtm8bshxp", // Standard work order form
                "y0nh46c1IIHR", // Standard purchase order form
                "e4l1cxmlknj",  // Standard purchase order line child form
                "tfw8cwfox4cs" // Standard work order issue form
            ];

            // Unauthorize Execute workbook
            execwb.authorizations.length = 0;

            // Set traveler type
            mksettings.traveler = {
                description: "Work order print form",
                id: "s1jbklvf514f",
                name: "Print Work Order Traveller"
            };
        }

        if (theEdition === "Enterprise") {
            // Authorize Count workbook
            if (!phycwb.authorizations.find(
                (a) => a.role === "administrator"
            )) {
                phycwb.authorizations.push(adminAuth);
            }

            // Enterprise forms
            forms = forms.concat([
                "nhexjsm66o8j", // Site form
                "bio7dq3ccgl5", // Inventory adjustment form
                "3lfxlgeetz7g", // Purchase receipt line form
                "sngexvfg6qfz", // Work order receipt form
                "yn7oaou1or0s", // Sales order shipment line
                "3tebzk86v5hh", // Item site form
                "z6rnm4au8cb6" // Work order issue material with locations
            ]);
        } else {
            // Unauthorize Count workbook
            phycwb.authorizations.length = 0;

            // Standard forms
            forms = forms.concat([
                "rztyy4m7csw7", // Site form
                "wgbl91hntwu",  // Inventory adjustment form
                "e0ma01pc0px2", // Purchase receipt line form
                "e01d45xnb9he", // Work order receipt form
                "a9kwgt2myc0p", // Sales order shipment line
                "80aum7kj6fv",  // Item site form
                "sph3qxax90fw" // Standard work order issue material
            ]);

            // Turn of location control
            let sites = await f.datasource.request({
                client: obj.client,
                filter: {criteria: [{
                    property: "locationControlled",
                    value: true
                }]},
                method: "GET",
                name: "Site"
            }, true);
            let site;

            while (sites.length) {
                site = sites.pop();
                await f.datasource.request({
                    client: obj.client,
                    data: [{
                        op: "replace",
                        path: "/locationControlled",
                        value: false
                    }, {
                        op: "replace",
                        path: "/defaultLocation",
                        value: null
                    }, {
                        op: "replace",
                        path: "/defaultShipLocation",
                        value: null
                    }, {
                        op: "replace",
                        path: "/defaultWipLocation",
                        value: null
                    }, {
                        op: "replace",
                        path: "/defaultReceiveLocation",
                        value: null
                    }],
                    id: site.id,
                    method: "PATCH",
                    name: "Site"
                }, true);
            }
        }

        while (forms.length) {
            formId = forms.pop();

            await f.datasource.request({
                client: obj.client,
                data: [{
                    op: "replace",
                    path: "/isDefault",
                    value: true
                }],
                id: formId,
                method: "PATCH",
                name: "Form"
            }, true);
        }

        // Update workbook authorizations
        await f.datasource.request({
            client: obj.client,
            data: {specs: execwb},
            method: "PUT",
            name: "saveWorkbook"
        }, true);

        await f.datasource.request({
            client: obj.client,
            data: {specs: phycwb},
            method: "PUT",
            name: "saveWorkbook"
        }, true);

        // Update make module settings
        await f.datasource.request({
            client: obj.client,
            data: {
                data: mksettings,
                name: "makeSettings"
            },
            method: "PUT",
            name: "saveSettings"
        }, true);

        // Update job shop module settings
        await f.datasource.request({
            client: obj.client,
            data: {
                data: {edition: theEdition},
                name: "jobShopSettings"
            },
            method: "PUT",
            name: "saveSettings"
        }, true);

    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doConfigureJobShop",
    doConfig
);