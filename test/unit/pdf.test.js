/*
    PDF form printing (server/services/pdf.js) on pdfmake. The database
    services the printer calls are replaced with in-memory stubs, so this
    runs without a database. The PDF is inflated and its text runs decoded
    to check what was printed.
*/
/*jslint node, for*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");

const root = path.resolve(__dirname, "../..");
const target = path.join(root, "server/services/pdf.js");
const downloads = path.join(root, "files/downloads");

require(path.join(root, "common/string.js"));
require(path.join(root, "common/number.js"));

const feathers = {
    Order: {
        name: "Order",
        properties: {
            id: {type: "string"},
            number: {type: "string", isNaturalKey: true},
            orderDate: {type: "string", format: "date"},
            status: {
                type: "string",
                format: "enum",
                dataList: [{value: "O", label: "Open"}]
            },
            customer: {type: {relation: "Customer"}},
            total: {type: "object", format: "money"},
            isRush: {type: "boolean"},
            lines: {type: {relation: "OrderLine", parentOf: "parent"}}
        }
    },
    OrderLine: {
        name: "OrderLine",
        properties: {
            item: {type: "string"},
            quantity: {type: "number"}
        }
    },
    Customer: {
        name: "Customer",
        properties: {
            code: {type: "string", isNaturalKey: true},
            name: {type: "string", isLabelKey: true}
        }
    }
};

function form(overrides) {
    return Object.assign({
        name: "Order Form",
        isActive: true,
        paperSize: "Letter",
        title: "Sales Order",
        attrs: [
            {attr: "number", font: "Barcode39Text", fontSize: 24},
            {attr: "orderDate"},
            {attr: "status"},
            {attr: "customer", unit: 1},
            {attr: "total", unit: 1},
            {attr: "isRush", unit: 1},
            {attr: "lines", columns: [
                {attr: "item"},
                {attr: "quantity", width: 80}
            ]}
        ].map((a) => Object.assign({
            grid: 0,
            unit: 0,
            showLabel: true,
            columns: []
        }, a)),
        tabs: []
    }, overrides);
}

function order(i, lineCount) {
    let lines = [];
    let j;

    for (j = 0; j < lineCount; j += 1) {
        lines.push({
            objectType: "OrderLine",
            item: "ITEM-" + j,
            quantity: j + 1
        });
    }
    return {
        id: "ord" + i,
        objectType: "Order",
        number: "SO" + i,
        orderDate: "2026-10-13",
        status: "O",
        customer: {code: "ACME", name: "Acme Wheel Co."},
        total: {amount: 1234.5, currency: "USD"},
        isRush: true,
        lines
    };
}

let currentForm;
let currentSettings;
let fetched;

const stubs = {
    "./crud": {
        CRUD: function () {
            return {
                doSelect: function (obj) {
                    if (obj.name === "Currency") {
                        return Promise.resolve([{
                            code: "USD",
                            hasDisplayUnit: false,
                            minorUnit: 2,
                            symbol: "$"
                        }]);
                    }
                    if (obj.name === "Form") {
                        return Promise.resolve(
                            currentForm
                            ? [JSON.parse(JSON.stringify(currentForm))]
                            : []
                        );
                    }
                    return Promise.reject(
                        new Error("Unexpected select " + obj.name)
                    );
                }
            };
        }
    },
    "./settings": {
        Settings: function () {
            return {
                getSettings: function () {
                    return Promise.resolve(currentSettings);
                }
            };
        }
    },
    "./feathers": {
        Feathers: function () {
            return {
                getFeathers: function (ignore, ignore2, local) {
                    Object.assign(local, JSON.parse(JSON.stringify(feathers)));
                    return Promise.resolve();
                }
            };
        }
    },
    "node-fetch": function (url) {
        return Promise.resolve({
            buffer: function () {
                return Promise.resolve(fetched[url]);
            }
        });
    }
};

/**
    Text drawn on each page, decoded from the content streams. pdfkit
    writes text as hex strings; standard fonts use single byte codes.
*/
function pagesText(bytes) {
    let pdf = bytes.toString("latin1");
    // "stream" that is not the tail of "endstream"
    let re = /[^d]stream\r?\n/g;
    let pages = [];
    let match = re.exec(pdf);

    while (match) {
        let start = match.index + match[0].length;
        let end = pdf.indexOf("endstream", start);
        if (end === -1) {
            break;
        }
        let raw = Buffer.from(pdf.slice(start, end), "latin1");
        let text;

        try {
            text = zlib.inflateSync(raw).toString("latin1");
        } catch (ignore) {
            text = "";
        }
        if (text.indexOf(" Tf") !== -1) {
            pages.push(
                (text.match(/<([0-9a-f]*)>/g) || []).map(
                    (h) => Buffer.from(h.slice(1, -1), "hex").toString(
                        "latin1"
                    )
                ).join("")
            );
        }
        re.lastIndex = end + "endstream".length;
        match = re.exec(pdf);
    }
    return pages;
}

function pageCount(bytes) {
    return (bytes.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
}

describe("pdf printForm", function () {
    let pdf;
    let origLoad;
    let created = [];
    const client = {currentUser: () => "admin"};

    before(function () {
        origLoad = Module._load;
        Module._load = function (request, parent) {
            if (parent && parent.filename === target && stubs[request]) {
                return stubs[request];
            }
            return origLoad.apply(this, arguments);
        };
        fs.mkdirSync(downloads, {recursive: true});
        process.chdir(root);
        const {PDF} = require(target);
        pdf = new PDF();
    });

    after(function () {
        Module._load = origLoad;
        created.forEach(function (file) {
            fs.rmSync(path.join(downloads, file), {force: true});
        });
    });

    async function print(theForm, data, settings) {
        let file;
        let name = "fbtest-pdf-" + created.length;

        currentForm = theForm;
        currentSettings = settings || {
            name: "Featherbone LLC",
            city: "Virginia Beach",
            state: "VA"
        };
        file = await pdf.printForm(
            client,
            theForm && theForm.name,
            data,
            name
        );
        created.push(file);
        assert.equal(file, name + ".pdf");
        return fs.readFileSync(path.join(downloads, file));
    }

    it("writes the complete file before resolving", async function () {
        let bytes = await print(form(), [order(1, 3)]);

        assert.equal(bytes.toString("latin1", 0, 5), "%PDF-");
        assert.match(bytes.toString("latin1", bytes.length - 6), /%%EOF/);
        assert.equal(pageCount(bytes), 1);
    });

    it("uses the form's paper size", async function () {
        let bytes = await print(
            form({paperSize: "Legal Wide"}),
            [order(1, 0)]
        );

        assert.match(
            bytes.toString("latin1"),
            /\/MediaBox \[0 0 1008 612\]/
        );
    });

    it("prints header, values, child table and page footer",
            async function () {
        let text = pagesText(await print(form(), [order(1, 2)]))[0];

        [
            "Sales Order",
            "Featherbone LLC",
            "Virginia Beach, VA",
            "Order Date:",
            "Open",
            "ACME",
            "Acme Wheel Co.",
            "$ 1,234.50",
            "Lines:",
            "Quantity",
            "ITEM-1",
            "1 / 1"
        ].forEach(function (s) {
            assert.ok(text.includes(s), "missing " + JSON.stringify(s));
        });
    });

    it("starts each record on a new page", async function () {
        let bytes = await print(form(), [order(1, 0), order(2, 0)]);
        let pages = pagesText(bytes);

        assert.equal(pageCount(bytes), 2);
        assert.ok(pages[0].includes("1 / 2"));
        assert.ok(pages[1].includes("2 / 2"));
    });

    it("repeats the header on every page of a long table",
            async function () {
        let bytes = await print(form(), [order(1, 80)]);
        let pages = pagesText(bytes);

        assert.ok(pageCount(bytes) > 1);
        pages.forEach(function (text, i) {
            assert.ok(text.includes("Sales Order"), "page " + (i + 1));
            assert.ok(text.includes("Quantity"), "page " + (i + 1));
        });
        assert.ok(pages[pages.length - 1].includes("ITEM-79"));
    });

    it("keeps every line of a row taller than a page", async function () {
        let data = order(1, 1);
        let text;

        data.lines[0].item = Array(120).fill("tall row").join("\n");
        text = pagesText(await print(form(), [data])).join("");
        assert.equal(text.split("tall row").length - 1, 120);
    });

    it("leaves title and logo out when hidden", async function () {
        let text = pagesText(await print(
            form({hideLogo: true, hideTitle: true}),
            [order(1, 0)]
        ))[0];

        assert.ok(!text.includes("Sales Order"));
        assert.ok(!text.includes("Featherbone LLC"));
        assert.ok(text.includes("Order Date:"));
    });

    it("builds a default form when none is named", async function () {
        let text = pagesText(await print(undefined, [order(1, 1)]))[0];

        assert.ok(text.includes("Order"));
        assert.ok(text.includes("Number:"));
    });

    it("prints without a logo that is not JPEG or PNG", async function () {
        let bytes;

        fetched = {"http://x/logo.pdf": Buffer.from("%PDF-1.4 not an image")};
        bytes = await print(form(), [order(1, 0)], {
            name: "Featherbone LLC",
            logo: {resource: "http://x/logo.pdf"}
        });
        assert.ok(!bytes.toString("latin1").includes("/Subtype /Image"));
        assert.ok(pagesText(bytes)[0].includes("Featherbone LLC"));
    });

    it("embeds the default logo", async function () {
        let bytes = await print(form(), [order(1, 0)]);

        assert.ok(bytes.toString("latin1").includes("/Subtype /Image"));
    });

    it("rejects unknown and inactive forms", async function () {
        currentForm = undefined;
        await assert.rejects(
            pdf.printForm(client, "Nope", [order(1, 0)]),
            /Form Nope not found/
        );
        currentForm = form({isActive: false});
        await assert.rejects(
            pdf.printForm(client, "Order Form", [order(1, 0)]),
            /is not active/
        );
    });
});

describe("pdf font metrics", function () {
    // pdf.js keeps each family's ascender and descender to reproduce
    // pdfjs line spacing; they must match what pdfkit reads.
    it("match pdfkit", function (t) {
        let PDFKit;
        let src = fs.readFileSync(target, "utf8");
        let doc;

        try {
            PDFKit = require("pdfkit");
        } catch (ignore) {
            t.skip("pdfkit not resolvable");
            return;
        }
        doc = new PDFKit({autoFirstPage: false});
        [
            ["Courier", "Courier"],
            ["Courier", "Courier-BoldOblique"],
            ["Helvetica", "Helvetica"],
            ["Helvetica", "Helvetica-Bold"],
            ["Times", "Times-Roman"],
            ["Times", "Times-BoldItalic"],
            ["Barcode39", "fonts/LibreBarcode39-Regular.ttf"],
            ["Barcode39Text", "fonts/LibreBarcode39Text-Regular.ttf"],
            ["Barcode39Extended", "fonts/LibreBarcode39Extended-Regular.ttf"],
            [
                "Barcode39ExtendedText",
                "fonts/LibreBarcode39ExtendedText-Regular.ttf"
            ]
        ].forEach(function (pair) {
            let family = pair[0];
            let font = pair[1];
            let re = new RegExp(
                "\\n\\s+" + family + ": \\[(-?\\d+), (-?\\d+)\\]"
            );
            let found = src.match(re);

            doc.font(
                font.endsWith(".ttf")
                ? path.join(root, font)
                : font
            );
            assert.ok(found, family);
            assert.deepEqual(
                [Number(found[1]), Number(found[2])],
                [doc._font.ascender, doc._font.descender],
                font
            );
        });
    });
});
