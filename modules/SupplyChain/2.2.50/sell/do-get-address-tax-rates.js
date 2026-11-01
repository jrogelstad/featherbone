/*jslint devel unordered*/
const select = (
    "SELECT z.*, " +
    "  tst.id AS state_tax_id, " +
    "  tst.code AS state_tax_code, " +
    "  tst.description AS state_tax_description, " +
    "  tco.id AS county_tax_id, " +
    "  tco.code AS county_tax_code, " +
    "  tco.description AS county_tax_description, " +
    "  tci.id AS city_tax_id, " +
    "  tci.code AS city_tax_code, " +
    "  tci.description AS city_tax_description, " +
    "  tsd.id AS special_district_tax_id, " +
    "  tsd.code AS special_district_tax_code, " +
    "  tsd.description AS special_destrict_tax_description "
);
const joins = (
    "  LEFT JOIN tax_type tst " +
    "  ON tst.code = 'State: ' || z.state " +
    "  LEFT JOIN tax_type tco " +
    "  ON tco.code = 'County: ' || z.zip_code || '-' || z.county " +
    "  LEFT JOIN tax_type tci " +
    "  ON tci.code = 'City: ' || z.zip_code || '-' || z.county " +
    "  || '-' || z.city " +
    "  LEFT JOIN tax_type tsd " +
    "  ON tsd.code = 'Special District: ' || z.zip_code || '-' || " +
    "  z.county || '-' || z.city "
);
// The tax city is matched as literal text, not as a regular expression:
// the address city was used as a pattern, so punctuation in a city could
// match the wrong row or raise an error. A zip code can cover several
// cities, so prefer the row whose city is the same, then the closest
// (shortest) containing it, and break any remaining tie the same way every
// time rather than leaving it to whichever row the database returns first.
const nrm = (c) => "LOWER(REGEXP_REPLACE(" + c + ", '\\s+', '', 'g'))";
const orderBy = (c) => (
    "ORDER BY (" + nrm("z.city") + " = " + nrm(c) + ") DESC, " +
    "  LENGTH(z.city), z.county, z.city, z.id "
);
// sql2 has no address row: it used to cross join every address, which
// returned nothing at all when the address table was empty
const sql1 = select + "FROM address a, tax_rate z " + joins + (
    "WHERE a.id = $1 " +
    "  AND z.zip_code = a.postal_code " +
    "  AND POSITION(" + nrm("a.city") + " IN " + nrm("z.city") + ") > 0 " +
    "  AND z.state = trim(a.state) " +
    orderBy("a.city") +
    "LIMIT 1; "
);
const sql2 = select + "FROM tax_rate z " + joins + (
    "WHERE z.zip_code = $1 " +
    "  AND POSITION(" + nrm("$2::text") + " IN " + nrm("z.city") + ") > 0 " +
    "  AND z.state = trim($3) " +
    orderBy("$2::text") +
    "LIMIT 1; "
);

async function doGetTax(obj) {
    let pgClient = obj.client;
    let res;
    let row;
    let ret = [];

    async function processTax(str) {
        let tr = Number(row["rate_" + str]);
        let txType = {
            id: row[str + "_tax_id"],
            code: row[str + "_tax_code"],
            description: row[str + "_tax_description"]
        };

        if (tr) {
            if (!txType.id) {
                txType.code = str.toName() + ": ";

                switch (str) {
                case "state":
                    txType.code += row.state;
                    txType.description = "State tax for " + row.state;
                    break;
                case "county":
                    txType.code += (
                        row.zip_code + "-" + row.county
                    );
                    txType.description = "County tax for " + row.county;
                    break;
                case "city":
                    txType.code += (
                        row.zip_code + "-" +
                        row.county + "-" +
                        row.city
                    );
                    txType.description = "City tax for " + row.city;
                    break;
                case "special_district":
                    txType.code += (
                        row.zip_code + "-" +
                        row.county + "-" +
                        row.city
                    );
                    txType.description = (
                        "Special district tax for " + row.city + ", " +
                        row.state + " " + row.zip_code
                    );
                    break;
                }
                txType.id = f.createId();
                txType.reportingCode = row["reporting_code_" + str];

                await f.datasource.request({
                    client: obj.client,
                    method: "POST",
                    name: "TaxType",
                    data: txType
                }, true);
            }

            ret.push({
                taxType: txType,
                percent: tr,
                shippingTaxable: Boolean(row.shipping_taxable)
            });
        }
    }

    if (obj.data.id) {
        res = await pgClient.query(sql1, [obj.data.id]);
    } else {
        res = await pgClient.query(sql2, [
            obj.data.postalCode,
            obj.data.city,
            obj.data.state
        ]);
    }

    if (res.rows.length) {
        row = res.rows[0];

        await processTax("state");
        await processTax("county");
        await processTax("city");
        await processTax("special_district");
    }
    return ret;
}

f.datasource.registerFunction(
    "POST",
    "doGetAddressTaxRates",
    doGetTax
);