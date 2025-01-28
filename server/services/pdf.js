/*
    Framework for building object relational database apps
    Copyright (C) 2025 Featherbone LLC

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
    const {Tools} = require("./tools");
    const {Feathers} = require("./feathers");
    const {Settings} = require("./settings");
    const fetch = require("node-fetch");
    const pdf = require("pdfjs");
    //const {degrees, rgb, StandardFonts, PDFDocument} = require("pdf-lib");
    //const {registerFont, createCanvas} = require("canvas");
    //const defTextLabel = "Confidential";
    const formats = new Tools().formats;
    const settings = new Settings();

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
        "Label 4x4": {
            height: 288,
            width: 288
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
            @params {Object} Options
            @return {Promise} Filename
        */
        that.printForm = async function (
            vClient,
            form,
            data,
            filename,
            options
        ) {
            if (!Array.isArray(data)) {
                data = [data];
            }
            let ids;
            let theObj;
            let currId;
            let rows;
            let currs;
            let localFeathers = {};
            let dir = "./files/downloads/";
            let attachments = [];
            let annotation;
            let resp;
            let globalSettings = await settings.getSettings({
                client: vClient,
                data: {name: "globalSettings"}
            });
            const cr = "\n";

            if (options && options.annotation) {
                annotation = options.annotation;
            }

            if (typeof data[0] === "string") {
                ids = data;

                theObj = await crud.doSelect({
                    name: "Object",
                    client: vClient,
                    properties: ["id", "objectType"],
                    id: ids[0]
                }, false, true);

                rows = await crud.doSelect({
                    name: theObj.objectType,
                    client: vClient,
                    user: vClient.currentUser(),
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: ids
                        }]
                    }
                });

                if (!rows.length) {
                    throw new Error("Data not found");
                }
            } else {
                ids = data.map((d) => d.id);
                rows = data;
            }

            currs = await crud.doSelect({
                name: "Currency",
                client: vClient
            }, false, true);

            if (form) {
                resp = await crud.doSelect({
                    name: "Form",
                    client: vClient,
                    filter: {
                        criteria: [{
                            property: "name",
                            value: form
                        }]
                    }
                }, false, true);

                if (!resp[0]) {
                    throw new Error("Form " + form + " not found");
                }

                if (!resp[0].isActive) {
                    throw new Error("Form " + form + " is not active");
                }

                form = resp[0];
            }

            await feathers.getFeathers(
                vClient,
                rows[0].objectType,
                localFeathers
            );

            // Do Print
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
            let src;
            let res;
            if (globalSettings && globalSettings.logo) {
                res = await fetch(globalSettings.logo.resource);
                src = await res.buffer();
            } else {
                src = fs[readFileSync]("./files/logo.jpg");
            }
            let logo = new pdf.Image(src);
            let n = 0;
            let file = (filename || f.createId()) + ".pdf";
            let path = dir + file;
            let w = fs.createWriteStream(path);

            w.on("error", function () {
                return;
            });

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
                    return {name: key};
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

            function formatMoney(value, scale) {
                let style;
                let amount = value.amount || 0;
                let curr = currs.find(
                    (c) => c.code === value.currency
                );
                let hasDisplayUnit = curr.hasDisplayUnit;
                let minorUnit = scale || (
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
                        if (rec[attr].name) {
                            value = rec[attr].name + cr + value;
                        }
                        if (rec[attr].unit) {
                            value += cr + rec[attr].unit;
                        }
                        value += cr + rec[attr].city + ", ";
                        value += rec[attr].state + " ";
                        value += rec[attr].postalCode;
                        value += cr + rec[attr].country;
                        if (rec[attr].phone) {
                            value += cr + "Ph: " + rec[attr].phone;
                        }
                        row.cell(fontMod(value), {
                            font: ovrFont,
                            fontSize: style.fontSize
                        });
                        return;
                    }

                    if (inheritedFrom(
                        p.type.relation,
                        "ResourceLink"
                    )) {
                        if (options && options.attach) {
                            let figure = "Figure "
                            + (attachments.length + 1);
                            attachments.push({
                                attachmentLabel: figure,
                                label: rec[attr].label,
                                source: rec[attr].resource
                            });
                            row.cell(figure);
                        }
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

                switch (p.type || typeof value) {
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
                        value = "X";
                    } else {
                        value = "";
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
                    if (
                        formats[p.format] &&
                        formats[p.format].isMoney
                    ) {
                        curr = currs.find(
                            (c) => c.code === value.currency
                        );
                        if (curr) {
                            value = formatMoney(
                                value,
                                formats[p.format].scale
                            );
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

                if (!p.type) {
                    throw (
                        "Attribute '" +
                        p.name + "' does not have a relation"
                    );
                }
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
                            formats[prop.format] &&
                            formats[prop.format].isMoney
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

            if (form.hideLogo !== true || form.hideTitle !== true) {
                header = doc.header().table({
                    widths: [null, 5 * pdf.cm, 2.5 * pdf.cm],
                    paddingBottom: 1 * pdf.cm
                }).row();

                header.cell().text({
                    fontSize: 20,
                    font: fonts[defFont + "Bold"]
                }).add(
                    form.hideTitle
                    ? ""
                    : form.title || rows[0].objectType.toName()
                );

                if (!form.hideLogo) {
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
                    header.cell().text().add(addr);
                    header.cell().image(logo, {
                        align: "right",
                        height: 2.5 * pdf.cm
                    });
                }
            }

            doc.footer().pageNumber(function (curr, total) {
                return curr + " / " + total;
            }, {textAlign: "center"});
            doc.cell("", {minHeight: 0.1 * pdf.cm});

            // Loop through data to build content
            function getRow() {
                return rows.find((r) => r.id === currId);
            }

            while (ids.length) {
                currId = ids.shift();
                data = getRow();
                if (data) { // In case id not found
                    if (
                        annotation &&
                        data[annotation.dataSource]
                    ) {
                        annotation.dataIn = data[
                            annotation.dataSource
                        ];
                    }
                    buildSection();
                    form.tabs.forEach(buildSection);
                    if (ids.length) {
                        doc.pageBreak();
                    }
                }
                n = 0;
            }

            /*
            await new Promise(function (resolve) {
                if (!attachments.length) {
                    resolve();
                } else {
                    addAttachments(
                        doc,
                        attachments,
                        annotation
                    ).then(resolve);
                }
            });
            */

            doc.pipe(w);
            await doc.end();
            /*
            if (!options || !options.watermark) {
                return file;
            }

            await new Promise(function (resolve) {
                w.on("close", async function () {
                    options.watermark.width = doc.width;
                    options.watermark.height = doc.height;
                    await waterMarkPdf(
                        path,
                        options.watermark.label,
                        path,
                        options.watermark
                    );
                    resolve();
                });
            });
            */

            return file;
        };

        return that;
    };

    /*
    function fetchBytes(url) {
        return new Promise(function (res2) {
            readFile(
                "./files/upload/" + url.slice(url.lastIndexOf("/") + 1)
            ).then(function (bytes) {
                res2(bytes);
            });
        });
    }

    function addAttachments(doc, attachments, options) {
        let aP = [];
        attachments.forEach(function (attach) {
            let prom = new Promise(function (res, rej) {

                fetchBytes(attach.source).then(function (src) {
                    if (attach.source.match(/(jpg|jpeg|png)$/i)) {
                        doc.pageBreak();
                        let table = doc.table({widths: [200, 0]});
                        let row = table.row();
                        row.cell().text({
                            fontSize: 16
                        }).add(attach.label);
                        let imgSrc = new pdf.Image(src);
                        row.cell().image(imgSrc);
                        res();
                    } else if (attach.source.match(/(\.pdf)$/i)) {
                        if (!options || !options.annotate) {
                            let doc2 = new pdf.ExternalDocument(src);
                            doc.addPagesOf(doc2);
                            res();
                        } else {
                            annotatePDF(
                                src,
                                options
                            ).then(function (src2) {
                                let doc3 = new pdf.ExternalDocument(src2);
                                doc.addPagesOf(doc3);
                                res();
                            });
                        }
                    } else {
                        rej("Error: " + attach.source);
                    }
                });
            });
            aP.push(prom);
        });
        return Promise.all(aP);
    }

    /// Derived from:
    /// https://github.com/Hopding/pdf-lib/issues/65#issuecomment-468064410
    function compensateRotation(page, x, y, size) {
        let scale = 1;
        let pageSize = page.getSize();
        let rotation = page.getRotation().angle;
        let rads = toRadians(rotation);
        let draw = {
            x: null,
            y: null
        };
        let coords = {
            x: (x / scale),
            y: (y / scale)
        };
        if (rotation === 90 || rotation === 270) {
            coords.y = pageSize.width - ((y + size) / scale);
        } else if (rotation === 180) {
            coords.y = pageSize.height - ((y + size) / scale);
        }
        let sinRad = Math.sin(rads);
        let cosRad = Math.cos(rads);

        let sinX = coords.x * sinRad;
        let sinY = coords.y * sinRad;
        let cosX = coords.x * cosRad;
        let cosY = coords.y * cosRad;

        if (rotation === 90) {
            draw.x = cosX - sinY + pageSize.width;
            draw.y = sinX + cosY;
        } else if (rotation === 180) {
            draw.x = cosX - sinY + pageSize.width;
            draw.y = sinX + cosY + pageSize.height;
        } else if (rotation === 270) {
            draw.x = cosX - sinY;
            draw.y = sinX + cosY + pageSize.height;
        } else {
            draw.x = coords.x;
            draw.y = coords.y;
        }
        return draw;
    }
    function lineOpts(page, x1, y1, x2, y2) {

        let compStart = compensateRotation(page, x1, y1, 1);
        let compEnd = compensateRotation(page, x2, y2, 1);
        return {
            thickness: 1,
            color: rgb(0, 0, 0),
            start: {
                x: compStart.x,
                y: compStart.y
            },
            end: {
                x: compEnd.x,
                y: compEnd.y
            }
        };
    }

    function drawText(page, text, fontFamily, fontSize, x, y) {

        let compStart = compensateRotation(page, x, y, fontSize);
        page.moveTo(compStart.x, compStart.y);
        page.drawText(text, {
            font: fontFamily,
            size: fontSize,
            rotate: degrees(page.getRotation().angle)
        });
    }

    function rotationModifier(page) {
        let rotDeg = page.getRotation().angle;
        return (
            (rotDeg === 90 || rotDeg === 270)
            ? -1
            : 1
        );
    }

    function psuedoCell(
        page,
        rowNumber,
        cellLeft,
        header,
        data,
        opts,
        altStyle
    ) {
        let rowTop = page.getSize().height - (
            opts.top + (
                rowNumber * opts.rowHeight * rotationModifier(page)
            )
        );
        let rowBottom = rowTop + opts.rowHeight;
        let fontStyle = (
            (altStyle)
            ? opts.fontBold
            : opts.font
        );
        drawText(
            page,
            data,
            fontStyle,
            opts.fontSize,
            opts.left + cellLeft + 1,
            rowTop + 2
        );

        let rightPos = opts.left + cellLeft + header.width;
        page.drawLine(
            lineOpts(page, rightPos, rowTop, rightPos, rowBottom)
        );
    }
    function psuedoRow(page, rowNumber, rowData, opts, altStyle) {
        let rowTop = page.getSize().height - (
            opts.top + (
                rowNumber * opts.rowHeight * rotationModifier(page)
            )
        );
        let rowBottom = rowTop + opts.rowHeight;

        page.drawLine(
            lineOpts(page, opts.left, rowTop, opts.left + opts.width, rowTop)
        );
        page.drawLine(
            lineOpts(
                page,
                opts.left,
                rowBottom,
                opts.left + opts.width,
                rowBottom
            )
        );
        page.drawLine(
            lineOpts(page, opts.left, rowTop, opts.left, rowBottom)
        );
        let cellLeft = 0;
        opts.fields.forEach(function (head, i) {
            let data;
            if (!rowData.length) {
                data = head.label;
            } else if (!rowData[i]) {
                data = "";
            } else {
                data = rowData[i];
            }
            psuedoCell(page, rowNumber, cellLeft, head, data, opts, altStyle);
            cellLeft += head.width;
        });

    }
    function psuedoTable(page, rows, opts) {
        page.resetPosition();

        if (opts.header) {
            psuedoRow(page, 0, [], opts, true);
        }

        rows.forEach(function (row, i) {
            psuedoRow(page, i + 1, row, opts, false);
        });

        let top = page.getSize().height - opts.top;

        page.drawLine(
            lineOpts(page, opts.left, top, opts.left + opts.width, top)
        );
    }

    async function annotatePDF(bytes, opts) {

        opts.padding = opts.padding || 1;
        opts.borderWidth = opts.borderWidth || 1;

        let pdfDoc = await PDFDocument.load(bytes);
        let pages = pdfDoc.getPages();

        let page = pages[0];
        if (!page) {
            console.error("No page found in PDF bytestream");
            return;
        }

        if (opts.dataIn && opts.fieldSource) {
            opts.data = [];
            opts.dataIn.forEach(function (dat) {
                let rowData = [];
                opts.fieldSource.forEach(function (attr) {
                    let attrs = attr.split(".");
                    let dv1 = dat[attrs[0]];
                    if (attrs.length > 1) {
                        dv1 = dv1[attrs[1]];
                    }
                    if (dv1 === undefined || dv1 === null) {
                        dv1 = "";
                    }
                    rowData.push(dv1.toString());
                });
                opts.data.push(rowData);
            });
        }

        let rowWidth = opts.fields.reduce(function (sum, curr) {
            return (
                (
                    (typeof sum === "number")
                    ? sum
                    : sum.width
                )
                + curr.width
            );
        });

        let font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        let fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        let textHeight = parseInt(font.heightAtSize(opts.fontSize));
        let rowHeight = textHeight + (opts.padding * 2) + opts.borderWidth;
        let totalHeight = rowHeight * (opts.data.length + 1);

        if (opts.fitText) {
            opts.data.forEach(function (dat) {
                opts.fields.forEach(function (f, i) {
                    let maxWid = f.width - opts.padding * 2;
                    if (dat && dat[i]) {
                        let txt = dat[i];
                        let wid = parseInt(
                            font.widthOfTextAtSize(txt, opts.fontSize)
                        );
                        let suff = "…";
                        while (wid > maxWid) {
                            txt = txt.slice(0, txt.length - 2);
                            wid = parseInt(
                                font.widthOfTextAtSize(
                                    txt + suff,
                                    opts.fontSize
                                )
                            );
                        }
                        if (txt.length !== dat[i].length) {
                            dat[i] = txt + suff;
                        }
                    }
                });
            });
        }

        opts.width = rowWidth;
        opts.top -= (totalHeight * rotationModifier(page));
        opts.font = font;
        opts.fontBold = fontBold;
        opts.rowHeight = rowHeight;

        psuedoTable(page, opts.data, opts);

        let outBytes = await pdfDoc.save();
        return outBytes;
    }


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

    function toRadians(degrees) {
        return (degrees * Math.PI / 180);
    }
    function toDegrees(radians) {
        return (radians / Math.PI * 180);
    }
    function applyCosine(a, b, c) {
        let angle = (
            Math.pow(a, 2) + Math.pow(b, 2) - Math.pow(c, 2)
        ) / (2 * a * b);
        if (angle >= -1 && angle <= 0.99) {
            return toDegrees(Math.acos(angle));
        } else {
            return 0;
        }
    }

    function waterMark(cfg) {
        return new Promise(function (res, rej) {
            let cvs = createCanvas(cfg.width, cfg.height);
            registerFont("./fonts/Helvetica.otf", {family: "Helvetica"});

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
            ctx.rotate(toRadians(-1 * angle));
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
    async function readFile(path) {
        return await new Promise(function (res, rej) {
            fs.readFile(path, function (err, resp) {
                if (err) {
                    rej(resp);
                } else {
                    res(resp);
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
            bytes = await readFile(bytes);
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
    exports.readFile = readFile;
    exports.fetchBytes = fetchBytes;
    exports.annotate = async function (bytes, options) {
        if (!options) {
            return bytes;
        }
        if (options.annotation && options.annotation.annotate) {
            bytes = await annotatePDF(bytes, options.annotation);
        }
        if (options.watermark) {
            bytes = await waterMarkPdf(
                bytes,
                options.watermark.label || "Confidential",
                null,
                options.watermark
            );
        }
        return bytes;
    };
    */

}(exports));

