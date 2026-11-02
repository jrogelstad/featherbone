/*jslint unordered devel*/

const fs = f.Fs;
const pdfLib = () => f.PdfLib || missingLibrary();
const readFileSync = "readFileSync"; // Lint tyranny
const writeFileSync = "writeFileSync";
const dir = "./files/downloads/";

// Everything is written over the pre-printed form at fixed positions, so
// the numbers below are the form's. Positions are in points from the
// bottom left of the page, and a block of text hangs from the y it is
// given. If a test print lands a little high or low on the form, change
// OFFSET_Y (points, positive moves everything up) rather than each field.
const CM = 72 / 2.54;
const PAGE_HEIGHT = 792;
const PAGE_WIDTH = 612;
const TABLE_TOP = 11.7 * CM; // Down from the top of the page
const TABLE_LEFT = 1.05 * CM;
const OFFSET_Y = 0;
// Helvetica's own metrics, per em. The earlier layout advanced each line
// by (ascender - 2 * descender) * lineHeight, which is kept so wrapped
// text sits where it used to.
const ASCENDER = 0.718;
const DESCENDER = -0.207;
const LINE_HEIGHT = 1.15;
const ROW_HEIGHT = 0.45 * CM;
const INFO_ROWS = 17;
const COLUMNS = [
    1.0 * CM,
    1.1 * CM,
    0.95 * CM,
    0.95 * CM,
    1.90 * CM,
    1.90 * CM,
    8.45 * CM,
    1.9 * CM,
    1.3 * CM
];

// Raised when a print is asked for and pdf-lib was not loaded, rather than
// when the server starts, so the rest of the module still loads
function missingLibrary() {
    throw (
        "The pdf-lib library is not loaded. Install the SupplyChain " +
        "package so it can install its libraries, or run npm install " +
        "pdf-lib in the Featherbone folder, then restart the server."
    );
}

function formatAddress(addr) {
    let ret = (
        addr.name + "\n" +
        addr.street + "\n"
    );
    if (addr.unit) {
        ret += addr.unit + "\n";
    }
    ret += (
        addr.city + ", " +
        addr.state + " " +
        addr.postalCode + " " +
        addr.country
    );
    return ret;
}

// Text the font cannot draw is shown as "?" rather than failing the print
function printable(font, text) {
    return Array.from(String(text).replace(/\r/g, "")).map(function (ch) {
        if (ch === "\n") {
            return ch;
        }
        try {
            font.encodeText(ch);
            return ch;
        } catch (ignore) {
            return "?";
        }
    }).join("");
}

function lineAdvance(size, lineHeight) {
    return size * (ASCENDER - 2 * DESCENDER) * (lineHeight || LINE_HEIGHT);
}

// Break text into lines no wider than width, at spaces and at line feeds
function wrap(font, size, text, width) {
    let lines = [];

    printable(font, text).split("\n").forEach(function (para) {
        let line = "";

        para.split(" ").forEach(function (word) {
            let tryLine = (
                line
                ? line + " " + word
                : word
            );

            if (
                line &&
                font.widthOfTextAtSize(tryLine, size) > width
            ) {
                lines.push(line);
                line = word;
            } else {
                line = tryLine;
            }
        });
        lines.push(line);
    });

    return lines;
}

async function printForm(obj) {
    let filename = obj.filename;
    let doc;
    let font;
    let page;
    let file = (filename || f.createId()) + ".pdf";
    let bol;
    let ids = obj.data.ids || [obj.data.id];

    // The form is the template: its first page is written on
    doc = await pdfLib().PDFDocument.load(
        fs[readFileSync]("./files/upload/Straight Bill of Lading.pdf")
    );
    font = await doc.embedFont(pdfLib().StandardFonts.HelveticaBold);
    page = doc.getPage(0);

    if (ids[0]) {
        let bols = await f.datasource.request({
            method: "GET",
            name: "BillOfLading",
            client: obj.client,
            filter: {criteria: [{
                property: "id",
                operator: "IN",
                value: ids
            }]}
        });

        bol = bols[0]; // TO DO Implement multiple
    } else {
        bol = obj.data.billOfLading;
    }

    // Draw lines of text hanging from top (points from the bottom edge)
    function drawLines(lines, x, top, size, lineHeight) {
        let advance = lineAdvance(size, lineHeight);

        lines.forEach(function (line, i) {
            if (line) {
                page.drawText(line, {
                    font,
                    size,
                    x,
                    y: (
                        top + OFFSET_Y - ASCENDER * size - i * advance
                    )
                });
            }
        });
    }

    // One field written at a position on the form
    function field(text, opts) {
        if (text === undefined || text === null || text === "") {
            return;
        }
        let size = opts.fontSize || 10;
        let x = opts.x * CM;

        drawLines(
            wrap(
                font,
                size,
                text,
                (opts.width || PAGE_WIDTH - x)
            ),
            x,
            opts.y * CM,
            size,
            opts.lineHeight
        );
    }

    // An X in the box the terms name, if there is one
    function mark(terms, boxes, y) {
        if (boxes[terms] !== undefined) {
            field("X", {x: boxes[terms], y, fontSize: 8});
        }
    }

    // A row of the information table; returns its height. Cells with no
    // text are left blank, and the row is as tall as its tallest cell.
    function tableRow(cells, top) {
        let x = TABLE_LEFT;
        let height = ROW_HEIGHT;
        let drawn = [];

        cells.forEach(function (cell, i) {
            let size = cell.fontSize || 8;
            let padL = cell.paddingLeft || 0;
            let padR = cell.paddingRight || 0;
            let padT = cell.paddingTop || 0;
            let lines;

            if (cell.text !== undefined && cell.text !== null) {
                lines = wrap(font, size, cell.text, COLUMNS[i] - padL - padR);
                height = Math.max(
                    height,
                    padT + lines.length * lineAdvance(size)
                );
                drawn.push({
                    align: cell.textAlign,
                    lines,
                    padL,
                    padR,
                    padT,
                    size,
                    width: COLUMNS[i],
                    x
                });
            }
            x += COLUMNS[i];
        });

        drawn.forEach(function (one) {
            let advance = lineAdvance(one.size);

            one.lines.forEach(function (line, n) {
                let w = font.widthOfTextAtSize(line, one.size);
                let tx = one.x + one.padL;

                if (one.align === "right") {
                    tx = one.x + one.width - one.padR - w;
                } else if (one.align === "center") {
                    tx = one.x + one.padL + (
                        one.width - one.padL - one.padR - w
                    ) / 2;
                }
                if (line) {
                    page.drawText(line, {
                        font,
                        size: one.size,
                        x: tx,
                        y: (
                            top + OFFSET_Y - one.padT -
                            ASCENDER * one.size - n * advance
                        )
                    });
                }
            });
        });

        return height;
    }

    function num(value) {
        return (
            value
            ? value.toLocaleString()
            : ""
        );
    }

    // Ensure information has exactly the rows the form has
    let i = 0;
    while (i < INFO_ROWS) {
        if (!bol.information[i]) {
            bol.information.push(null);
        }
        i += 1;
    }

    let top = PAGE_HEIGHT - TABLE_TOP;
    bol.information.forEach(function (si) {
        si = si || {};
        top -= tableRow([{
            text: num(si.handlingQuantity),
            textAlign: "right",
            paddingRight: 5
        }, {
            text: si.handlingType,
            paddingLeft: 5
        }, {
            text: num(si.packageQuantity),
            textAlign: "right",
            paddingRight: 5
        }, {
            text: si.packageType,
            paddingLeft: 5
        }, {
            text: num(si.weight),
            textAlign: "right",
            paddingRight: 5
        }, {
            text: si.dimensions,
            textAlign: "center"
        }, {
            text: si.commodityDescription,
            paddingTop: 1,
            paddingLeft: 5,
            fontSize: 7
        }, {
            text: si.nmfcNumber,
            textAlign: "center"
        }, {
            text: si.class,
            textAlign: "center"
        }], top);
    });

    function total(prop) {
        return bol.information.filter((info) => info).reduce(
            (prv, nxt) => prv.plus(nxt[prop] || 0),
            0
        ).toLocaleString();
    }

    tableRow([{
        text: total("handlingQuantity"),
        textAlign: "right",
        paddingRight: 5
    }, {
        text: ""
    }, {
        text: total("packageQuantity"),
        textAlign: "right",
        paddingRight: 5
    }, {
        text: ""
    }, {
        text: total("weight"),
        textAlign: "right",
        paddingRight: 5
    }], top);

    field(f.parseDate(bol.date).toLocaleDateString(), {
        y: 26.65,
        x: 12
    });

    field(bol.number, {
        y: 26.14,
        x: 13.5
    });

    if (bol.shipFrom) {
        field(formatAddress(bol.shipFrom), {
            x: 1.5,
            y: 25.7,
            fontSize: 8,
            width: 140,
            lineHeight: 1
        });
    }

    field(bol.shipFromInfo, {
        x: 7.5,
        y: 25.7,
        fontSize: 8,
        width: 110
    });

    if (bol.shipTo) {
        field(formatAddress(bol.shipTo), {
            x: 1.55,
            y: 23,
            fontSize: 8,
            width: 150,
            lineHeight: 1
        });
    }

    field(bol.shipToContact, {
        x: 1.55,
        y: 21.3,
        fontSize: 8,
        width: 140,
        lineHeight: 1
    });

    field(bol.shipToPo, {
        x: 7.5,
        y: 21.7,
        fontSize: 10,
        width: 140,
        lineHeight: 1
    });

    field(bol.shipToInfo, {
        x: 6.8,
        y: 23,
        fontSize: 8,
        width: 110,
        lineHeight: 1
    });

    if (bol.carrier) {
        field(bol.carrier.code, {
            x: 13.5,
            y: 24.95
        });

        field(bol.carrier.scac, {
            x: 13.5,
            y: 24.5
        });
    }

    field(bol.trailerNumber, {
        x: 13.5,
        y: 23.43,
        fontSize: 8
    });

    field(bol.serialNumbers, {
        x: 13.5,
        y: 23.67,
        fontSize: 8,
        width: 200
    });

    if (bol.billTo) {
        field(formatAddress(bol.billTo), {
            x: 1.5,
            y: 19.35,
            fontSize: 8,
            lineHeight: 1
        });
    }

    field(bol.specialInstructions, {
        x: 11,
        y: 21.25,
        fontSize: 8,
        width: 265
    });

    field(bol.quoteNumber, {
        x: 11,
        y: 22.5
    });

    field(bol.proNumber, {
        x: 12.3,
        y: 19.75
    });

    // Freight Charge Terms
    mark(bol.freightChargeTerms, {
        "Prepaid": 1.35,
        "Collect": 4.6,
        "3rd Party": 7.85
    }, 20.125);

    if (bol.codAmount && bol.codAmount.amount) {
        field(bol.codAmount.amount.toLocaleString(), {
            x: 14.25,
            y: 7.35
        });
    }

    if (bol.declaredValueLimit && bol.declaredValueLimit.amount) {
        field("$" + bol.declaredValueLimit.amount.toLocaleString(), {
            x: 6,
            y: 6.77,
            fontSize: 7
        });
    }

    if (bol.declaredValueUnit) {
        field(bol.declaredValueUnit.code, {
            x: 8,
            y: 6.77,
            fontSize: 7
        });
    }

    // Fee Terms
    mark(bol.feeTerms, {
        "Prepaid": 15.8,
        "Collect": 14.1,
        "Check": 20
    }, 6.8);

    fs[writeFileSync](dir + file, await doc.save());
    return file;
}

f.datasource.registerFunction(
    "POST",
    "doPrintBillOfLading",
    printForm
);
