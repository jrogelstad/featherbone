/*jslint*/
/*
    The money formats this module adds to the ones the framework knows:
    unitCost, salesPrice and purchasePrice, each a `mono` column whose
    scale the installation chooses, plus `money` itself.

    They are registered as this script loads and the scales filled in
    afterwards, rather than the whole thing waiting on a settings read.
    `feathers.js` builds a column from the format its property declares,
    and an install reaches that as soon as the services are loaded: with
    the registration behind an await, a format that was not there yet
    made the installer fall back to the property's type and write `json`
    where `mono` was meant (framework item 0.11, and the money columns
    of a command line install). Only `type` decides the column, so
    registering first and refining the scale after is safe; the scale is
    used when an amount is rounded, which is later than any install.
*/
function registerMoneyFormats(settings) {
    let chosen = settings || {};

    if (!f.formats) {
        return;
    }

    f.formats.money = {
        default: null,
        isMoney: true,
        type: "mono"
    };

    f.formats.unitCost = {
        default: null,
        isMoney: true,
        scale: chosen.costDecimals || 2,
        type: "mono"
    };

    f.formats.salesPrice = {
        default: null,
        isMoney: true,
        scale: chosen.salesPriceDecimals || 2,
        type: "mono"
    };

    f.formats.purchasePrice = {
        default: null,
        isMoney: true,
        scale: chosen.purchasePriceDecimals || 2,
        type: "mono"
    };
}

async function formatMoney() {
    let config = await f.datasource.config();
    let settings = await f.datasource.request({
        data: {name: "commonSettings"},
        method: "GET",
        name: "getSettings",
        tenant: false,
        user: config.pgUser
    }, true) || {};

    registerMoneyFormats(settings);
}

registerMoneyFormats();

/*
    The scales, once the settings can be read. A database being built
    has no commonSettings row to read yet and the defaults above stand,
    so this says so rather than floating a rejection nobody handles.
*/
formatMoney().catch(function (err) {
    console.error(
        "Money formats keep their default scales for now: " +
        (err.message || err)
    );
});
