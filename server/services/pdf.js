/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint node, this, for, devel, unordered */

/**
    PDF file generator.
    @module PDF
*/
(function (exports) {
    "use strict";

    const readFileSync = "readFileSync"; // Lint dogma
    const f = require("../../common/core");
    const fs = require("fs");
    const {CRUD} = require("./crud");
    const {Feathers} = require("./feathers");
    const pdf = require("pdfjs");
    const {PDFDocument} = require("pdf-lib");
    const {createCanvas} = require("canvas");
    const defTextLabel = "Confidential";

    const fonts = {
        Barcode39: new pdf.Font(
            fs[readFileSync]("./fonts/LibreBarcode39-Regular.ttf")
        ),
        Barcode39Text: new pdf.Font(
            fs[readFileSync]("./fonts/LibreBarcode39Text-Regular.ttf")
        ),
        Barcode39Extended: new pdf.Font(
            fs[readFileSync]("./fonts/LibreBarcode39Extended-Regular.ttf")
        ),
        Barcode39ExtendedText: new pdf.Font(
            fs[readFileSync](
                "./fonts/LibreBarcode39ExtendedText-Regular.ttf"
            )
        ),
        Courier: require("pdfjs/font/Courier"),
        CourierBold: require("pdfjs/font/Courier-Bold"),
        CourierBoldOblique: require("pdfjs/font/Courier-BoldOblique"),
        CourierOblique: require("pdfjs/font/Courier-Oblique"),
        Helvetica: require("pdfjs/font/Helvetica"),
        HelveticaBold: require("pdfjs/font/Helvetica-Bold"),
        HelveticaBoldOblique: require("pdfjs/font/Helvetica-BoldOblique"),
        HelveticaOblique: require("pdfjs/font/Helvetica-Oblique"),
        Times: require("pdfjs/font/Times-Roman"),
        TimesBold: require("pdfjs/font/Times-Bold"),
        TimesBoldItalic: require("pdfjs/font/Times-BoldItalic"),
        TimesItalic: require("pdfjs/font/Times-Italic")
    };
    const crud = new CRUD();
    const feathers = new Feathers();
    const COL_WIDTH_DEFAULT = 150;
    const exclusions = [
        "id",
        "isDeleted",
        "lock",
        "created",
        "createdBy",
        "updated",
        "updatedBy",
        "objectType",
        "etag",
        "owner"
    ];
    const sizes = {
        "Letter": {
            height: 792,
            width: 612
        },
        "Letter Wide": {
            height: 612,
            width: 792
        },
        "Legal": {
            height: 1008,
            width: 612
        },
        "Legal Wide": {
            height: 612,
            width: 1008
        },
        "Statement": {
            height: 612,
            width: 396
        },
        "A4": {
            height: 841.896,
            width: 595.296
        },
        "A4 Wide": {
            height: 595.296,
            width: 841.896
        },
        "Label 4x6": {
            height: 432,
            width: 288
        },
        "Label 5x7": {
            height: 504,
            width: 360
        }
    };

    function buildForm(feather, localFeathers) {
        let props;
        let keys;
        let found;
        let theAttrs = [];

        props = f.copy(feather.properties);
        keys = Object.keys(props);

        // Make sure key attributes are first
        found = keys.find((key) => props[key].isNaturalKey);
        if (found) {
            theAttrs.push({attr: found});
            keys.splice(keys.indexOf(found), 1);
        }

        found = keys.find((key) => props[key].isLabelKey);
        if (found) {
            theAttrs.push({attr: found});
            keys.splice(keys.indexOf(found), 1);
        }

        // Build config with remaining keys
        keys.forEach(function (key) {
            let value = {attr: key};
            let p;
            let k;

            if (exclusions.indexOf(key) !== -1) {
                return;
            }

            if (
                props[key].type === "object" &&
                !props[key].format
            ) {
                return;
            }

            if (
                typeof props[key].type === "object" && (
                    props[key].type.childOf || props[key].type.parentOf
                )
            ) {
                p = localFeathers[props[key].type.relation].properties;
                k = Object.keys(p);
                k = k.filter(function (key) {
                    return (
                        exclusions.indexOf(key) === -1 &&
                        (typeof p[key] !== "object" || !p[key].type.childOf)
                    );
                });
                value.columns = k.map(function (key) {
                    return {attr: key};
                });
                value.height = "200px";
            }

            theAttrs.push(value);
        });

        theAttrs.forEach(function (a) {
            a.grid = 0;
            a.unit = 0;
            a.label = "";
            a.showLabel = true;
            a.columns = a.columns || [];
        });
        return {
            attrs: theAttrs,
            tabs: []
        };
    }

    /**
        @class PDF
        @constructor
        @namespace Services
    */
    exports.PDF = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Create pdf based on form definition. Input may be data to print,
            an array of data to print, or an id string or array of strings.
            If one or more ids are passed, the records will be queried for
            the form.

            @method printForm
            @param {Object} Database client
            @param {String} [Form] name
            @param {Object|String|Array} Input Record, id, or array of either
            @param {String} [Filename] Target filename
            @return {Promise} Filename
        */
        that.printForm = function (vClient, form, data, filename, options) {

            return new Promise(function (resolve, reject) {
                if (!Array.isArray(data)) {
                    data = [data];
                }
                let ids;
                let currId;
                let requests = [];
                let rows;
                let currs;
                let localFeathers = {};
                let dir = "./files/downloads/";

                function getForm() {
                    return new Promise(function (resolve, reject) {
                        crud.doSelect({
                            name: "Form",
                            client: vClient,
                            filter: {
                                criteria: [{
                                    property: "name",
                                    value: form
                                }]
                            }
                        }, false, true).then(resolve).catch(reject);
                    });
                }

                function getFeather(resp) {
                    return new Promise(function (resolve, reject) {
                        rows = resp[0];
                        currs = resp[1];

                        if (!rows.length) {
                            reject("Data not found");
                            return;
                        }
                        if (form) {
                            if (!resp[2][0]) {
                                reject("Form " + form + " not found");
                                return;
                            }

                            if (!resp[2][0].isActive) {
                                reject("Form " + form + " is not active");
                                return;
                            }
                            form = resp[2][0];
                        }

                        feathers.getFeathers(
                            vClient,
                            rows[0].objectType,
                            localFeathers
                        ).then(resolve).catch(reject);
                    });
                }

                function getData() {
                    return new Promise(function (resolve, reject) {
                        if (typeof data[0] === "string") {
                            ids = data;
                        } else {
                            resolve(data);
                            return;
                        }

                        function callback(resp) {
                            crud.doSelect({
                                name: resp.objectType,
                                client: vClient,
                                user: vClient.currentUser(),
                                filter: {
                                    criteria: [{
                                        property: "id",
                                        operator: "IN",
                                        value: ids
                                    }]
                                }
                            }).then(resolve).catch(reject);
                        }

                        crud.doSelect({
                            name: "Object",
                            client: vClient,
                            properties: ["id", "objectType"],
                            id: ids[0]
                        }, false, true).then(callback).catch(reject);
                    });
                }

                function getCurr() {
                    return new Promise(function (resolve, reject) {
                        crud.doSelect({
                            name: "Currency",
                            client: vClient
                        }, false, true).then(resolve).catch(reject);
                    });
                }

                function doPrint() {
                    return new Promise(function (resolve) {
                        let defFont = (
                            (form && form.font)
                            ? form.font
                            : "Helvetica"
                        );
                        let defSize = (
                            (form && form.paperSize)
                            ? form.paperSize
                            : "Letter Wide"
                        );
                        let doc = new pdf.Document({
                            width: sizes[defSize].width,
                            height: sizes[defSize].height,
                            font: fonts[defFont],
                            padding: 36,
                            paddingTop: 54,
                            properties: {
                                creator: vClient.currentUser()
                            }
                        });

                        let header;
                        let src = fs[readFileSync]("./files/logo.jpg");
                        let logo = new pdf.Image(src);
                        let n = 0;
                        let file = (filename || f.createId()) + ".pdf";
                        let path = dir + file;
                        let w = fs.createWriteStream(path);

                        form = form || buildForm(
                            localFeathers[rows[0].objectType],
                            localFeathers
                        );

                        function resolveProperty(key, fthr) {
                            let idx = key.indexOf(".");
                            let attr;
                            let rel;

                            if (idx !== -1) {
                                attr = key.slice(0, idx);
                                rel = fthr.properties[attr].type.relation;
                                fthr = localFeathers[rel];
                                key = key.slice(idx + 1, key.length);
                                return resolveProperty(key, fthr);
                            }

                            if (!fthr.properties[key]) {
                                throw (
                                    "Form \"" + form.name +
                                    "\" references property \"" + key +
                                    "\" which does not exist on feather \"" +
                                    fthr.name + "\""
                                );
                            }
                            fthr.properties[key].name = key;
                            return fthr.properties[key];
                        }

                        function getLabel(feather, attr) {
                            feather = localFeathers[feather];
                            let p = resolveProperty(attr.attr, feather);
                            return (
                                attr.label ||
                                p.alias ||
                                p.name.toName()
                            );
                        }

                        function inheritedFrom(source, target) {
                            let feather = localFeathers[source];
                            let props;

                            if (!feather) {
                                return false;
                            }

                            props = feather.properties;

                            if (feather.name === target) {
                                return true;
                            }
                            return Object.keys(props).some(function (k) {
                                return props[k].inheritedFrom === target;
                            });
                        }

                        function formatMoney(value) {
                            let style;
                            let amount = value.amount || 0;
                            let curr = currs.find(
                                (c) => c.code === value.currency
                            );
                            let hasDisplayUnit = curr.hasDisplayUnit;
                            let minorUnit = (
                                hasDisplayUnit
                                ? curr.displayUnit.minorUnit
                                : curr.minorUnit
                            );

                            style = {
                                minimumFractionDigits: minorUnit,
                                maximumFractionDigits: minorUnit
                            };

                            if (hasDisplayUnit) {
                                curr.conversions.some(function (conv) {
                                    if (
                                        conv.toUnit().id === curr.displayUnit.id
                                    ) {
                                        amount = amount.div(
                                            conv.ratio
                                        ).round(minorUnit);

                                        return true;
                                    }
                                });

                                curr = currs.find(
                                    (c) => c.code === curr.displayUnit.code
                                );
                            }
                            return (
                                curr.symbol + " " +
                                amount.toLocaleString(undefined, style)
                            );
                        }

                        function formatValue(
                            row,
                            feather,
                            attr,
                            rec,
                            showLabel,
                            style,
                            printBlank
                        ) {
                            feather = localFeathers[feather];
                            let p = resolveProperty(attr, feather);
                            let curr;
                            let parts = attr.split(".");
                            let value = rec[parts[0]];
                            let item;
                            let nkey;
                            let lkey;
                            let rel;
                            let cr = "\n";
                            let fontStr = style.font || defFont;
                            let ovrFont = fonts[fontStr];

                            function fontMod(val) {
                                if (fontStr.startsWith("Barcode")) {
                                    val = "*" + val + "*";
                                }
                                return val;
                            }

                            parts.shift();
                            while (parts.length) {
                                if (value === null) {
                                    value = "";
                                    parts = [];
                                } else {
                                    value = value[parts.shift()];
                                }
                            }

                            if (printBlank) {
                                row.cell("");
                                return;
                            }

                            if (typeof p.type === "object") {
                                if (value === null) {
                                    row.cell("");
                                    return;
                                }

                                if (inheritedFrom(p.type.relation, "Address")) {
                                    value = rec[attr].street;
                                    if (rec[attr].unit) {
                                        value += cr + rec[attr].unit;
                                    }
                                    value += cr + rec[attr].city + ", ";
                                    value += rec[attr].state + " ";
                                    value += rec[attr].postalCode;
                                    value += cr + rec[attr].country;
                                    row.cell(fontMod(value), {
                                        font: ovrFont,
                                        fontSize: style.fontSize
                                    });
                                    return;
                                }

                                if (inheritedFrom(p.type.relation, "Contact")) {
                                    rel = row.cell().text();
                                    rel.add(
                                        value.fullName
                                    );
                                    if (showLabel) {
                                        if (value.phone) {
                                            rel.br().add(
                                                value.phone,
                                                {
                                                    font: ovrFont,
                                                    fontSize: 10
                                                }
                                            );
                                        }
                                        if (value.email) {
                                            rel.br().add(
                                                value.email,
                                                {
                                                    font: ovrFont,
                                                    fontSize: 10
                                                }
                                            );
                                        }
                                        if (value.address) {
                                            rel.br().add(
                                                (
                                                    value.address.city + "," +
                                                    value.address.state
                                                ),
                                                {
                                                    font: ovrFont,
                                                    fontSize: 10
                                                }
                                            );
                                        }
                                    }
                                    return;
                                }

                                feather = localFeathers[p.type.relation];
                                nkey = Object.keys(feather.properties).find(
                                    (k) => feather.properties[k].isNaturalKey
                                );
                                if (showLabel) {
                                    lkey = Object.keys(feather.properties).find(
                                        (k) => feather.properties[k].isLabelKey
                                    );
                                }
                                if (lkey && !nkey) {
                                    nkey = lkey;
                                    lkey = undefined;
                                }
                                rel = row.cell().text();
                                if (lkey) {
                                    rel.add(
                                        fontMod(value[nkey]),
                                        {
                                            font: ovrFont,
                                            fontSize: style.fontSize
                                        }
                                    ).br().add(
                                        value[lkey],
                                        {
                                            font: ovrFont,
                                            fontSize: 10
                                        }
                                    );
                                } else {
                                    rel.add(
                                        fontMod(value[nkey]),
                                        {
                                            font: ovrFont,
                                            fontSize: style.fontSize
                                        }
                                    );
                                }
                                return;
                            }

                            switch (p.type) {
                            case "string":
                                if (!value) {
                                    row.cell("");
                                    return;
                                }
                                if (p.dataList) {
                                    item = p.dataList.find(
                                        (i) => i.value === value
                                    );
                                    value = (
                                        item
                                        ? item.label
                                        : "Invalid data list value: " + value
                                    );
                                } else if (p.format === "date") {
                                    value = f.parseDate(
                                        value
                                    ).toLocaleDateString();
                                } else if (p.format === "dateTime") {
                                    value = new Date(value).toLocaleString();
                                }

                                row.cell(fontMod(value), {
                                    font: ovrFont,
                                    fontSize: style.fontSize
                                });
                                break;
                            case "boolean":
                                if (value) {
                                    value = "True";
                                } else {
                                    value = "False";
                                }
                                row.cell(fontMod(value), {
                                    font: ovrFont,
                                    fontSize: style.fontSize
                                });
                                break;
                            case "integer":
                            case "number":
                                row.cell(fontMod(value.toLocaleString()), {
                                    font: ovrFont,
                                    fontSize: style.fontSize,
                                    textAlign: "right"
                                });
                                break;
                            case "object":
                                if (p.format === "money") {
                                    curr = currs.find(
                                        (c) => c.code === value.currency
                                    );
                                    if (curr) {
                                        value = formatMoney(value);
                                        row.cell(fontMod(value), {
                                            font: ovrFont,
                                            fontSize: style.fontSize,
                                            textAlign: "right"
                                        });
                                    } else {
                                        row.cell("Invalid currency");
                                    }
                                }
                                break;
                            default:
                                row.cell(fontMod(value), {
                                    font: ovrFont,
                                    fontSize: style.fontSize
                                });
                            }
                        }

                        function formatTable(obj) {
                            let feather = localFeathers[obj.feather];
                            let attr = obj.attribute;
                            let p = resolveProperty(attr.attr, feather);
                            let tr;
                            let maxWidth = doc.width.minus(
                                doc.paddingLeft
                            ).minus(doc.paddingRight);
                            let ttlWidth = 0;
                            let cols = attr.columns.filter(function (c) {
                                ttlWidth += c.width || COL_WIDTH_DEFAULT;
                                return ttlWidth <= maxWidth;
                            });
                            let table;

                            if (attr.showLabel) {
                                doc.cell("", {
                                    minHeight: 10
                                });
                                doc.cell(getLabel(obj.feather, attr) + ":", {
                                    padding: 5,
                                    font: fonts[defFont + "Bold"]
                                });
                            }

                            table = doc.table({
                                widths: cols.map(
                                    (c) => c.width || COL_WIDTH_DEFAULT
                                ),
                                borderHorizontalWidths: function (i) {
                                    return (
                                        i < 2
                                        ? 1
                                        : 0.1
                                    );
                                },
                                padding: 5
                            });
                            feather = localFeathers[p.type.relation];

                            tr = table.header({
                                font: fonts[defFont + "Bold"],
                                borderBottomWidth: 1.5
                            });

                            function addHeaderCol(col) {
                                let opts = {
                                    font: fonts[defFont + "Bold"]
                                };
                                let prop = resolveProperty(col.attr, feather);

                                if (
                                    prop.type === "number" ||
                                    prop.type === "integer" ||
                                    (
                                        prop.type === "object" &&
                                        prop.format === "money"
                                    )
                                ) {
                                    opts.textAlign = "right";
                                }
                                tr.cell(getLabel(feather.name, col), opts);
                            }

                            function addRow(rec) {
                                let row = table.row();

                                cols.forEach(function (col) {
                                    formatValue(
                                        row,
                                        rec.objectType,
                                        col.attr,
                                        rec,
                                        Boolean(form.showLabelKey),
                                        {
                                            font: col.font,
                                            fontSize: col.fontSize
                                        },
                                        col.printBlank
                                    );
                                });
                            }

                            cols.forEach(addHeaderCol);
                            data[attr.attr].forEach(addRow);
                        }

                        function buildSection(tab) {
                            let attrs = form.attrs.filter((a) => a.grid === n);
                            let colCnt = 0;
                            let rowCnt = 0;
                            let ary = [];
                            let tbl;
                            let units = [];
                            let c = 0;
                            let tables = [];

                            if (tab) {
                                doc.cell("", {
                                    minHeight: 10
                                });
                                doc.cell(tab.name, {
                                    font: fonts[defFont + "Bold"],
                                    backgroundColor: 0xd3d3d3,
                                    fontSize: 14,
                                    paddingLeft: 9,
                                    paddingBottom: 2
                                });
                            }

                            // Figure out how many units (columns)
                            // in form
                            attrs.forEach(function (a) {
                                if (a.unit > colCnt) {
                                    colCnt = a.unit;
                                }
                                if (!ary[a.unit]) {
                                    ary[a.unit] = [a];
                                } else {
                                    ary[a.unit].push(a);
                                }
                            });
                            colCnt += 1;
                            ary.forEach(function (i) {
                                if (i.length > rowCnt) {
                                    rowCnt = i.length;
                                }
                            });

                            // Build table
                            while (c < colCnt) {
                                units.push(100); // label
                                units.push(134); // value
                                c += 1;
                            }
                            tbl = doc.table({
                                widths: units,
                                padding: 5
                            });

                            function addRow() {
                                let row = tbl.row();
                                let i = 0;
                                let attr;
                                let label;

                                while (i < colCnt) {
                                    if (ary[i] === undefined) {
                                        i += 1;
                                        return;
                                    }
                                    attr = ary[i].shift();
                                    if (attr) {
                                        // Handle Label
                                        if (
                                            attr.showLabel &&
                                            !attr.columns.length
                                        ) {
                                            label = getLabel(
                                                data.objectType,
                                                attr
                                            );

                                            row.cell(label + ":", {
                                                textAlign: "right",
                                                font: fonts[defFont + "Bold"]
                                            });
                                        } else {
                                            row.cell("");
                                        }
                                        // Handle value
                                        if (attr.columns.length) {
                                            // Build tables after done with grid
                                            // Can't put a table in a cell
                                            tables.push({
                                                feather: data.objectType,
                                                attribute: attr
                                            });
                                        } else {
                                            formatValue(
                                                row,
                                                data.objectType,
                                                attr.attr,
                                                data,
                                                true,
                                                {
                                                    font: attr.font,
                                                    fontSize: attr.fontSize
                                                }
                                            );
                                        }
                                    }
                                    i += 1;
                                }
                            }
                            c = 0;
                            while (c < rowCnt) {
                                addRow();
                                c += 1;
                            }

                            while (tables.length) {
                                formatTable(tables.shift());
                            }

                            n += 1;
                        }

                        header = doc.header().table({
                            widths: [null, null],
                            paddingBottom: 1 * pdf.cm
                        }).row();

                        header.cell().text({
                            fontSize: 20,
                            font: fonts[defFont + "Bold"]
                        }).add(form.title || rows[0].objectType.toName());

                        header.cell().image(logo, {
                            align: "right",
                            height: 1.5 * pdf.cm
                        });

/*                      Some bug in footer fouls up alignment
                        doc.footer().pageNumber(function (curr, total) {
                            return curr + " / " + total;
                        }, {
                            textAlign: "center"
                        });
*/
                        // Loop through data to build content
                        function getRow() {
                            return rows.find((r) => r.id === currId);
                        }

                        while (ids.length) {
                            currId = ids.shift();
                            data = getRow();
                            if (data) { // In case id not found
                                buildSection();
                                form.tabs.forEach(buildSection);
                                if (ids.length) {
                                    doc.pageBreak();
                                }
                            }
                            n = 0;
                        }

                        doc.pipe(w);
                        doc.end().then(function () {
                            if (!options || !options.watermark) {
                                resolve(file);
                                return file;
                            }
                            w.on("close", function () {
                                options.watermark.width = doc.width;
                                options.watermark.height = doc.height;
                                waterMarkPdf(
                                    path,
                                    options.watermark.label,
                                    path,
                                    options.watermark
                                ).then(function () {
                                    resolve(file);
                                });
                            });

                        }).catch(reject);
                    });
                }

                requests.push(getData());
                requests.push(getCurr());
                if (form) {
                    requests.push(getForm());
                }
                Promise.all(requests).then(
                    getFeather
                ).then(
                    doPrint
                ).then(
                    resolve
                ).catch(reject);
            });
        };

        return that;
    };

    function setHypWidth(cfg) {
        cfg.hypWidth = parseInt(
            Math.sqrt(
                (cfg.width * cfg.width)
                + (cfg.height * cfg.height)
            )
        );
    }

    function newPdfConfig() {
        let cfg = {
            adoptPageDimensions: false,
            width: 595.296,
            height: 841.896,
            textAlign: "center",
            fillText: false,
            strokeText: true,
            fontColor: "#CFCFCF",
            fontStroke: "#000000",
            fontFamily: "Arial",
            fontStyle: "bold",
            fontSize: 98,
            maxTextPercent: 0.8,
            imageScale: 0.8,
            transparency: 0.25,
            canvasExportType: "image/png",
            leftAdjustment: 0.15,
            topAdjustment: 0.9,
            debugOutput: true
        };
        cfg.textLabel = defTextLabel;
        setHypWidth(cfg);
        return cfg;
    }

    function computeFontSizeToWidth(cfg, ctx) {
        let useFontSize = parseInt(cfg.fontSize);
        ctx.font = [
            cfg.fontStyle,
            useFontSize + "pt",
            cfg.fontFamily
        ].join(" ");

        let txtWidth = ctx.measureText(cfg.textLabel).width;
        let txtRatio = (txtWidth / cfg.hypWidth);

        while (txtRatio < cfg.maxTextPercent) {
            useFontSize += 1;
            ctx.font = [
                cfg.fontStyle,
                useFontSize + "pt",
                cfg.fontFamily
            ].join(" ");
            txtWidth = ctx.measureText(cfg.textLabel).width;
            txtRatio = (txtWidth / cfg.hypWidth);
        }
        return useFontSize;
    }

    function radians(degrees) {
        return (degrees * Math.PI / 180);
    }
    function degrees(radians) {
        return (radians / Math.PI * 180);
    }
    function applyCosine(a, b, c) {
        let angle = (
            Math.pow(a, 2) + Math.pow(b, 2) - Math.pow(c, 2)
        ) / (2 * a * b);
        if (angle >= -1 && angle <= 0.99) {
            return degrees(Math.acos(angle));
        } else {
            return 0;
        }
    }

    function waterMark(cfg) {
        return new Promise(function (res, rej) {
            let cvs = createCanvas(cfg.width, cfg.height);
            let ctx = cvs.getContext("2d");

            let useFontSize = computeFontSizeToWidth(cfg, ctx);
            let triangle = {
                A: Math.round(
                    applyCosine(cfg.height, cfg.hypWidth, cfg.width)
                ),
                B: Math.round(
                    applyCosine(cfg.hypWidth, cfg.width, cfg.height)
                ),
                C: Math.round(
                    applyCosine(cfg.width, cfg.height, cfg.hypWidth)
                )
            };
            let angle = triangle.B;

            ctx.textAlign = cfg.textAlign;
            ctx.fillStyle = cfg.fontColor;
            ctx.strokeStyle = cfg.fontStroke;
            ctx.font = [
                cfg.fontStyle,
                useFontSize + "pt",
                cfg.fontFamily
            ].join(" ");
            let metric = ctx.measureText(cfg.textLabel);
            let textWidth = metric.width;
            let textHeight = metric.actualBoundingBoxAscent;
            textHeight += metric.actualBoundingBoxDescent;

            let left = (cfg.width * cfg.leftAdjustment);
            let top = (cfg.height * cfg.topAdjustment);
            ctx.save();
            ctx.translate(left, top + textHeight / 2);
            ctx.rotate(radians(-1 * angle));
            ctx.globalAlpha = cfg.transparency;
            if (cfg.strokeText) {
                ctx.strokeText(cfg.textLabel, textWidth / 2, 0);
            }
            if (cfg.fillText) {
                ctx.fillText(cfg.textLabel, textWidth / 2, 0);
            }
            if (!cfg.debugOutput) {
                res(cvs);
            } else {
                let buff = cvs.toBuffer(cfg.canvasExportType);
                fs.writeFile("./debug.png", buff, function (err) {
                    if (err) {
                        rej(err);
                    } else {
                        res(cvs);
                    }
                });
            }
        });
    }

    async function waterMarkPage(cfg, pdfDoc, page, cvs) {
        let w = page.getWidth();
        let h = page.getHeight();
        if (!cvs || (
            cfg.adoptPageDimensions && (w !== cfg.width || h !== cfg.height)
        )) {
            cfg.width = w;
            cfg.height = h;
            setHypWidth(cfg);
            cvs = await waterMark(cfg);
        }

        let arrayBuff = cvs.toBuffer(cfg.canvasExportType);
        let pngBuff = Buffer.alloc(arrayBuff.length);
        pngBuff.fill(new Uint8Array(arrayBuff));
        const pngImage = await pdfDoc.embedPng(pngBuff);

        /// There is a margin on the image
        /// It is currently scaled down by 20% and on the x-axis
        ///
        const pngDims = pngImage.scale(cfg.imageScale);

        let px = 0;
        let py = page.getHeight() - (page.getHeight() * cfg.maxTextPercent);
        page.drawImage(pngImage, {
            x: px,
            y: py,
            width: pngDims.width,
            height: pngDims.height
        });
    }
    async function savePdf(path, bytes) {
        return await new Promise(function (res, rej) {
            fs.writeFile(path, bytes, function (err) {
                if (err) {
                    rej(err);
                } else {
                    res();
                }
            });
        });
    }
    async function waterMarkPdf(bytes, label, outPath, options) {
        let cfg = newPdfConfig();
        cfg.textLabel = label || defTextLabel;
        if (options) {
            if (options.width && options.height) {
                cfg.width = options.width;
                cfg.height = options.height;
                setHypWidth(cfg);
            }

            if (options.minimumSize) {
                cfg.fontSize = options.minimumSize;
            }
            if (options.leftAdjustment) {
                cfg.leftAdjustment = options.leftAdjustment;
            }
            if (options.topAdjustment) {
                cfg.topAdjustment = options.topAdjustment;
            }
            if (typeof options.opacity === "number") {
                cfg.transparency = options.opacity;
            }
            if (typeof options.strokeText === "boolean") {
                cfg.strokeText = options.strokeText;
            }
            if (typeof options.fillText === "boolean") {
                cfg.fillText = options.fillText;
            }
            if (options.fillColor) {
                cfg.fontColor = options.fillColor;
            }
            if (options.strokeColor) {
                cfg.fontStroke = options.strokeColor;
            }
            if (options.fontFamily) {
                cfg.fontFamily = options.fontFamily;
            }
        }
        if (!options || !(
            options.width && options.height
        )) {
            cfg.adoptPageDimensions = true;
        }

        let cvs;
        if (!cfg.adoptPageDimensions) {
            cvs = await waterMark(cfg);
        }
        if (typeof bytes === "string") {
            bytes = await new Promise(function (res, rej) {
                fs.readFile(bytes, function (err, resp) {
                    if (err) {
                        rej(resp);
                    } else {
                        res(resp);
                    }
                });
            });
        }
        let pdfDoc = await PDFDocument.load(bytes);

        let pages = pdfDoc.getPages();
        let i;
        for (i = 0; i < pages.length; i += 1) {
            await waterMarkPage(cfg, pdfDoc, pages[i], cvs);
        }

        let outBytes = await pdfDoc.save();
        if (outPath) {
            await savePdf(outPath, outBytes);
        }
        return outBytes;
    }

}(exports));

