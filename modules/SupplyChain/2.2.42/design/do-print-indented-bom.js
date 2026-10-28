/*jslint unordered*/

const fs = f.Fs;
const pdfmake = f.Pdfmake;
const readFileSync = "readFileSync";
const fetch = f.NodeFetch;

// pdfmake is the server's own, set up with its fonts and its refusal to
// fetch URLs or read files while rendering, so the logo is handed over in
// memory.
const CM = 72 / 2.54;
const MARGIN = 0.5 * CM;
const DEFAULT_SIZE = 11;
// The earlier layout advanced each line by (ascender - 2 * descender) times
// 1.15 where pdfmake advances by (ascender - descender) times lineHeight,
// so lineHeight is scaled to keep the same spacing. Helvetica, per em.
const ASCENDER = 0.718;
const DESCENDER = -0.207;
const LINE_HEIGHT = 1.15 * (
    (ASCENDER - 2 * DESCENDER) / (ASCENDER - DESCENDER)
);
const HEADER_HEIGHT = 3.6 * CM;
const HEADER_TOP = 1 * CM;
const CELL_PAD = 3; // Either side of a cell's text
const INDENT = 8; // Per level of the bill

// The logo setting is a pointer: a URL, or the name of a file uploaded to
// this server, read from the upload folder and nowhere else. An older
// ResourceLink object is still read for its `resource`.
async function logoSource(globalSettings) {
    let logo = (globalSettings || {}).logo;
    let where;
    let res;

    if (logo && typeof logo === "object") {
        logo = logo.resource;
    }
    where = String(logo || "");

    if (!where) {
        return fs[readFileSync]("./files/logo.jpg");
    }
    if (where.startsWith("http")) {
        res = await fetch(where);
        return await res.buffer();
    }
    return fs[readFileSync](
        "./files/upload/" + where.split(/[\\/]/).pop()
    );
}

async function printForm(obj) {
    let filename = obj.filename;

    let dir = "./files/downloads/";
    let globalSettings = await f.datasource.request({
        method: "GET",
        name: "getSettings",
        client: obj.client,
        data: {name: "globalSettings"}
    }, true);
    let src = await logoSource(globalSettings);
    let file = (filename || f.createId()) + ".pdf";
    let path = dir + file;
    let settings = await f.datasource.request({
        method: "GET",
        name: "getSettings",
        client: obj.client,
        data: {name: "commonSettings"}
    }, true);

    let money = {
        minimumFractionDigits: settings.costDecimals || 2,
        maximumFractionDigits: settings.costDecimals || 2
    };
    let data = obj.data.data;
    let cr = "\n";
    let addr = "";

    if (globalSettings) {
        addr += globalSettings.name;
        if (globalSettings.street) {
            if (addr.length) {
                addr += cr;
            }
            addr += globalSettings.street;
        }
        if (globalSettings.unit) {
            if (addr.length) {
                addr += cr;
            }
            addr += globalSettings.unit;
        }
        if (globalSettings.city) {
            if (addr.length) {
                addr += cr;
            }
            addr += globalSettings.city;
        }
        if (globalSettings.state) {
            if (addr.length && globalSettings.city) {
                addr += ", ";
            } else if (addr.length) {
                addr += cr;
            }
            addr += globalSettings.state;
        }
        if (globalSettings.postalCode) {
            if (addr.length && (
                globalSettings.city ||
                globalSettings.state
            )) {
                addr += " ";
            } else if (addr.length) {
                addr += cr;
            }
            addr += globalSettings.postalCode;
        }
        if (globalSettings.country) {
            if (addr.length) {
                addr += cr;
            }
            addr += globalSettings.country;
        }
        if (globalSettings.phone) {
            if (addr.length) {
                addr += cr;
            }
            addr += "Ph: " + globalSettings.phone;
        }
    }

    // Table of the bill: one row to a component, the heading repeated on
    // every page
    let curr;
    let hasCost = Boolean(
        data.bom && data.bom.length && data.bom[0].totalCost
    );
    let widths = [200, "*"];
    let head = [{
        text: "Product",
        bold: true,
        margin: [CELL_PAD, 0, CELL_PAD, 0]
    }, {
        text: "Description",
        bold: true,
        margin: [CELL_PAD, 0, CELL_PAD, 0]
    }];
    let body = [head];
    let right = (text, bold) => ({
        text,
        bold,
        alignment: "right",
        margin: [CELL_PAD, 0, CELL_PAD, 0]
    });

    if (!obj.data.noQty) {
        widths.push(50);
        head.push(right("Qty Per", true));
    }
    widths.push(50);
    head.push({
        text: "Unit",
        bold: true,
        margin: [CELL_PAD, 0, CELL_PAD, 0]
    });
    if (hasCost) {
        widths.push(100);
        head.push(right("Cost", true));
        curr = await f.datasource.request({
            method: "GET",
            name: "Currency",
            client: obj.client,
            properties: ["id", "symbol"],
            filter: {criteria: [{
                property: "code",
                value: data.bom[0].totalCost.currency
            }]}
        }, true);
        if (!curr.length) {
            throw "Currency " + data.bom[0].totalCost.currency + " not found";
        }
        curr = curr[0];
    }

    data.bom.forEach(function (item) {
        let lvl = item.level || 0;
        let row = [{
            text: item.product.number,
            margin: [CELL_PAD + lvl * INDENT, 0, CELL_PAD, 0]
        }, {
            text: item.product.description || "",
            margin: [CELL_PAD, 0, CELL_PAD, 0]
        }];

        if (!obj.data.noQty) {
            row.push(right(item.quantityPer.toLocaleString()));
        }
        row.push({
            text: item.unit.code,
            margin: [CELL_PAD, 0, CELL_PAD, 0]
        });
        if (hasCost) {
            row.push(right(
                item.totalCost
                ? curr.symbol + item.totalCost.amount.toLocaleString(
                    undefined,
                    money
                )
                : ""
            ));
        }
        body.push(row);
    });

    let now = new Date();

    await pdfmake.createPdf({
        pageSize: {width: 612, height: 792},
        pageMargins: [
            MARGIN,
            HEADER_TOP + HEADER_HEIGHT + MARGIN,
            MARGIN,
            MARGIN + DEFAULT_SIZE * (ASCENDER - DESCENDER) * LINE_HEIGHT + 4
        ],
        defaultStyle: {
            font: "Helvetica",
            fontSize: DEFAULT_SIZE,
            lineHeight: LINE_HEIGHT
        },
        images: {
            logo: (
                "data:application/octet-stream;base64," +
                src.toString("base64")
            )
        },
        header: {
            margin: [MARGIN, HEADER_TOP, MARGIN, 0],
            table: {
                widths: ["*", 5 * CM, 2.5 * CM],
                heights: [HEADER_HEIGHT],
                body: [[{
                    stack: [{
                        text: obj.data.title || "Indented Bill Of Material",
                        bold: true,
                        fontSize: 20
                    }, {
                        text: (
                            "Product: " + data.product.number + "\n" +
                            "Description: " + data.product.description + "\n"
                        ),
                        bold: true,
                        fontSize: 12
                    }]
                }, {
                    text: addr
                }, {
                    image: "logo",
                    fit: [2.5 * CM, 2.5 * CM]
                }]]
            },
            layout: "noBorders"
        },
        footer: function (curPage, pages) {
            return {
                margin: [MARGIN, 4, MARGIN, 0],
                columns: [{
                    text: "Printed on: " + now.toLocaleString()
                }, {
                    text: "Page " + curPage + " of " + pages,
                    alignment: "right"
                }]
            };
        },
        content: [{
            table: {
                headerRows: 1,
                widths,
                body
            },
            layout: {
                // Heavy rules above and below the heading, light between
                hLineWidth: (i) => (
                    i < 2
                    ? 1
                    : 0.1
                ),
                vLineWidth: () => 0,
                paddingLeft: () => 0,
                paddingRight: () => 0,
                paddingTop: () => 5,
                paddingBottom: () => 5
            }
        }]
    }).write(path);

    return file;
}

f.datasource.registerFunction(
    "POST",
    "doPrintIndentedBomForm",
    printForm
);
