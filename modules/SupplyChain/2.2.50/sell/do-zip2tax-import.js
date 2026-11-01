/*jslint devel unordered*/
const sql = (
    "INSERT INTO tax_rate " +
    "(_pk, id, created, created_by, updated, updated_by, " +
    " is_deleted, lock, " +
    "z2t_id, zip_code, sales_tax_rate, rate_state, rate_county, " +
    "rate_city, rate_special_district, city, post_office, state, county, " +
    "shipping_taxable, primary_record, reporting_code_city," +
    "reporting_code_state, reporting_code_county, " +
    "reporting_code_special_district, owner, etag) " +
    "VALUES " +
    "((SELECT nextval('object__pk_seq')), $1, $2, $3, $4, $5, $6, $7, " +
    "$8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, " +
    "$21, $22, $23, $24, $25, $26);"
);

const qs = f.Qs;
const fs = f.Fs;
const XLSX = f.Xlsx;

async function doImport(obj) {
    let filename = "./files/upload/" + obj.data.filename;
    let wb = XLSX.readFile(filename);
    let dat = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let d;
    let theUser = obj.client.currentUser();
    let subscr = obj.data.subscription;

    try {
        //dat = dat.filter(isActive);
        let process = f.datasource.createProcess({
            client: obj.client,
            count: dat.length,
            name: "Import tax rates",
            subscription: subscr
        });
        await process.start();
        await f.datasource.request({
            method: "POST",
            name: "Alert",
            user: obj.client.currentUser(),
            data: {
                category: "Import",
                message: "Starting Zip To Tax import"
            },
            tenant: obj.client.tenant()
        }, true);
        // Stay inside the request's transaction: a COMMIT here would
        // end it early, and the unawaited deletes would race the inserts.
        await obj.client.query(
            "DELETE FROM \"$subscription\" " +
            "WHERE objectid = 'tax_rate';"
        );
        await obj.client.query("DELETE FROM tax_rate;");
        while (dat.length) {
            d = dat.shift();

            await obj.client.query(sql, [
                f.createId(),
                f.now(),
                theUser,
                f.now(),
                theUser,
                false,
                null,
                d.z2t_ID,
                d.ZipCode,
                d.SalesTaxRate,
                d.RateState,
                d.RateCounty,
                d.RateCity,
                d.RateSpecialDistrict,
                d.City,
                d.PostOffice,
                d.State,
                d.County,
                d.ShippingTaxable,
                d.PrimaryRecord,
                d.ReportingCodeCity || "",
                d.ReportingCodeState || "",
                d.ReportingCodeCounty || "",
                d.ReportingCodeSpecialDistrict || "",
                theUser,
                f.createId()
            ]);

            //}
            await process.next();
        }
        await f.datasource.request({
            method: "POST",
            name: "Alert",
            user: theUser,
            data: {
                category: "Import",
                message: "Finished Zip To Tax import"
            },
            tenant: obj.client.tenant()
        }, true);
        await process.complete();
    } catch (err) {
        await f.datasource.request({
            method: "POST",
            name: "Alert",
            user: theUser,
            data: {
                category: "Import",
                message: "Zip To Tax import Failed: " + err.message,
                severity: "Critical"
            },
            tenant: obj.client.tenant()
        }, true);
        return Promise.reject(err);
    }

    return new Promise(function (resolve) {
        fs.unlink(filename, resolve);
    });
}

f.datasource.registerFunction(
    "POST",
    "doZip2TaxImport",
    doImport
);