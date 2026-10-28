/*jslint unordered*/
/*global*/
const fs = f.Fs;
const pdfmake = f.Pdfmake;
const fetch = f.NodeFetch;
const readFileSync = "readFileSync"; // Lint dogma

// pdfmake is the server's own, set up with its fonts (Helvetica and the
// Libre Barcode 39 families) and its refusal to fetch URLs or read files
// while rendering, so everything here is handed over in memory.
const CM = 72 / 2.54;
const PAGE_SIZE = 288; // 4 x 4 inch label
// Left and right, so text and the logo do not run to the edge of the label
const SIDE_MARGIN = 0.5 * CM;
// The earlier layout advanced each line by (ascender - 2 * descender) times
// 1.15 where pdfmake advances by (ascender - descender) times lineHeight,
// so lineHeight is scaled to keep the same spacing. Helvetica, per em.
const ASCENDER = 0.718;
const DESCENDER = -0.207;
const LINE_HEIGHT = 1.15 * (
    (ASCENDER - 2 * DESCENDER) / (ASCENDER - DESCENDER)
);
const DEFAULT_SIZE = 11;
const HEADER_SIZE = 6;

// Height of lines of text as laid out, in points
function textHeight(lines, size) {
    return lines * size * (ASCENDER - DESCENDER) * LINE_HEIGHT;
}

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

async function doPrintProductLabel(obj) {
    if (!obj.data.id) {
        throw ("A product ID must be provided");
    }

    let copies = obj.data.copies || 1;
    let product = await f.datasource.request({
        method: "GET",
        name: "Product",
        client: obj.client,
        id: obj.data.id,
        properties: [
            "number",
            "description",
            "longDescription",
            "revision"
        ]
    }, true);
    let globalSettings = await f.datasource.request({
        method: "GET",
        name: "getSettings",
        client: obj.client,
        data: {name: "globalSettings"}
    }, true);
    let src = await logoSource(globalSettings);
    let dir = "./files/downloads/";
    let file = product.number + ".pdf";
    let path = dir + file;
    const cr = "\n";

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

    // The header sits in the top margin, so the margin is made as tall as
    // the header: the logo or the address, whichever is taller, and the
    // 1 cm above and half a cm below it
    let headerHeight = Math.max(
        1 * CM,
        textHeight(addr.split(cr).length, HEADER_SIZE)
    );
    let footerText = "Date: " + new Date().toDateString();
    if (product.revision) {
        footerText += "\nRevision: " + product.revision;
    }
    let footerHeight = textHeight(footerText.split(cr).length, DEFAULT_SIZE);
    let content = [];

    while (copies) {
        copies -= 1;

        content.push({
            text: product.number,
            bold: true,
            fontSize: 16,
            pageBreak: (
                content.length
                ? "before"
                : undefined
            )
        });

        // A barcode split over two lines cannot be scanned
        content.push({
            text: "*" + product.number + "*",
            font: "Barcode39Extended",
            fontSize: 20,
            noWrap: true
        });

        content.push({
            table: {
                widths: ["*"],
                heights: [1 * CM],
                body: [[{text: product.description || "", fontSize: 10}]]
            },
            layout: "noBorders"
        });

        content.push({
            text: product.longDescription || "",
            fontSize: 10
        });
    }

    await pdfmake.createPdf({
        pageSize: {width: PAGE_SIZE, height: PAGE_SIZE},
        pageMargins: [
            SIDE_MARGIN,
            1 * CM + headerHeight + 0.5 * CM,
            SIDE_MARGIN,
            footerHeight + 4
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
            margin: [SIDE_MARGIN, 1 * CM, SIDE_MARGIN, 0],
            table: {
                widths: ["*", 3 * CM, 1 * CM],
                body: [[
                    {text: ""},
                    {text: addr, fontSize: HEADER_SIZE},
                    {image: "logo", fit: [1 * CM, 1 * CM], alignment: "right"}
                ]]
            },
            layout: "noBorders"
        },
        footer: {
            text: footerText,
            margin: [SIDE_MARGIN, 2, SIDE_MARGIN, 0]
        },
        content
    }).write(path);

    return file;
}

f.datasource.registerFunction(
    "POST",
    "doPrintProductLabel",
    doPrintProductLabel
);
