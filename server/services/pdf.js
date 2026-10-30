/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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

    Forms are laid out with pdfmake (which renders through pdfkit). The
    layout mirrors the earlier pdfjs implementation: same paper sizes,
    padding, default font size and line height, a header repeated on every
    page (title, company address and logo) and a "page / pages" footer.
    @module PDF
*/

(function (exports) {
    "use strict";

    const readFileSync = "readFileSync"; // Lint dogma
    const writeFileSync = "writeFileSync";
    const f = require("../../common/core");
    const fs = require("fs");
    const path_ = require("path");
    const {CRUD} = require("./crud");
    const {Tools} = require("./tools");
    const {Feathers} = require("./feathers");
    const {Settings} = require("./settings");
    const fetch = require("node-fetch");
    const pdfmake = require("pdfmake");
    //const {degrees, rgb, StandardFonts, PDFDocument} = require("pdf-lib");
    //const {registerFont, createCanvas} = require("canvas");
    //const defTextLabel = "Confidential";
    const formats = new Tools().formats;
    const settings = new Settings();

    // Points per centimeter
    const CM = 72 / 2.54;
    // Defaults carried over from pdfjs so printed forms keep their density
    const DEFAULT_FONT_SIZE = 11;
    const LINE_HEIGHT = 1.15;
    // Ascender and descender (per 1000 units of em) of each font family.
    // pdfjs advanced each line by (ascender - 2 * descender) * 1.15, while
    // pdfmake advances by (ascender - descender) * lineHeight, so the
    // pdfmake lineHeight is scaled per family to keep the same spacing.
    // Values are the fonts' own metrics as pdfkit reads them; the unit
    // test checks them against pdfkit.
    const METRICS = {
        Barcode39: [600, -400],
        Barcode39Text: [600, -400],
        Barcode39Extended: [600, -400],
        Barcode39ExtendedText: [600, -400],
        Courier: [629, -157],
        Helvetica: [718, -207],
        Times: [683, -217]
    };
    // Cell padding pdfjs counted inside column widths; pdfmake adds it
    const CELL_PADDING = 5;
    const PAGE_PADDING = 36;
    const PAGE_PADDING_TOP = 54;
    // Largest page height PDF viewers accept, used to measure header height
    const MEASURE_HEIGHT = 14400;
    const MEASURE_ID = "fb-measure-";

    // The 14 standard PDF fonts are built into pdfkit and referenced by
    // name. The barcode fonts are TrueType files loaded into pdfmake's
    // virtual file system once at start up.
    const STANDARD_FONTS = [
        "Courier",
        "Courier-Bold",
        "Courier-BoldOblique",
        "Courier-Oblique",
        "Helvetica",
        "Helvetica-Bold",
        "Helvetica-BoldOblique",
        "Helvetica-Oblique",
        "Times-Roman",
        "Times-Bold",
        "Times-BoldItalic",
        "Times-Italic"
    ];
    const BARCODE_FILES = {
        Barcode39: "LibreBarcode39-Regular.ttf",
        Barcode39Text: "LibreBarcode39Text-Regular.ttf",
        Barcode39Extended: "LibreBarcode39Extended-Regular.ttf",
        Barcode39ExtendedText: "LibreBarcode39ExtendedText-Regular.ttf"
    };
    const families = {
        Courier: {
            normal: "Courier",
            bold: "Courier-Bold",
            italics: "Courier-Oblique",
            bolditalics: "Courier-BoldOblique"
        },
        Helvetica: {
            normal: "Helvetica",
            bold: "Helvetica-Bold",
            italics: "Helvetica-Oblique",
            bolditalics: "Helvetica-BoldOblique"
        },
        Times: {
            normal: "Times-Roman",
            bold: "Times-Bold",
            italics: "Times-Italic",
            bolditalics: "Times-BoldItalic"
        }
    };

    Object.keys(BARCODE_FILES).forEach(function (family) {
        let file = BARCODE_FILES[family];

        pdfmake.virtualfs[writeFileSync](
            file,
            fs[readFileSync]("./fonts/" + file)
        );
        families[family] = {
            normal: file,
            bold: file,
            italics: file,
            bolditalics: file
        };
    });
    pdfmake.setFonts(families);
    // Everything a form needs is handed to pdfmake in memory, so refuse
    // any attempt to fetch a URL or read the local disk while rendering.
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.includes(path));

    /**
        Font names a form may use (see the `font` property on forms and
        form attributes) mapped to pdfmake font family and style.

        @property fonts
        @private
    */
    const fonts = {
        Barcode39: {font: "Barcode39"},
        Barcode39Text: {font: "Barcode39Text"},
        Barcode39Extended: {font: "Barcode39Extended"},
        Barcode39ExtendedText: {font: "Barcode39ExtendedText"},
        Courier: {font: "Courier"},
        CourierBold: {font: "Courier", bold: true},
        CourierBoldOblique: {font: "Courier", bold: true, italics: true},
        CourierOblique: {font: "Courier", italics: true},
        Helvetica: {font: "Helvetica"},
        HelveticaBold: {font: "Helvetica", bold: true},
        HelveticaBoldOblique: {font: "Helvetica", bold: true, italics: true},
        HelveticaOblique: {font: "Helvetica", italics: true},
        Times: {font: "Times"},
        TimesBold: {font: "Times", bold: true},
        TimesBoldItalic: {font: "Times", bold: true, italics: true},
        TimesItalic: {font: "Times", italics: true}
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
        "owner",
        "meta"
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

    /**
        Text style for a font name. Unknown names (for example the bold
        variant of a font that has none, such as "Barcode39Bold") return
        an empty style so the text inherits the document font, which is
        what pdfjs did with an undefined font.

        @method fontStyle
        @param {String} name Font name
        @return {Object}
        @private
    */
    function lineHeightOf(family) {
        let metrics = METRICS[family];

        return LINE_HEIGHT * (
            (metrics[0] - 2 * metrics[1]) / (metrics[0] - metrics[1])
        );
    }

    function fontStyle(name) {
        let style = fonts[name];

        if (!style) {
            return {};
        }
        return {
            font: style.font,
            bold: Boolean(style.bold),
            italics: Boolean(style.italics),
            lineHeight: lineHeightOf(style.font)
        };
    }

    function str(value) {
        if (value === undefined || value === null) {
            return "";
        }
        return String(value);
    }

    /**
        Build a pdfmake text node.

        @method textNode
        @param {Any} value Text
        @param {Object} [opts] Options
        @param {String} [opts.font] Font name
        @param {Number} [opts.fontSize] Font size
        @param {String} [opts.textAlign] Alignment
        @return {Object}
        @private
    */
    function textNode(value, opts) {
        let text = str(value);
        // An empty run list takes no height, as empty text did in pdfjs
        let node = {
            text: text || []
        };

        opts = opts || {};
        Object.assign(node, fontStyle(opts.font));
        // A barcode split over two lines cannot be scanned. pdfjs wrapped
        // only at spaces and let a long word run past the cell; pdfmake
        // would break the word, so make each word an unbreakable run.
        if (text && BARCODE_FILES[node.font]) {
            node.text = text.split(/(\s+)/).filter(Boolean).map(
                (word) => (
                    /^\s+$/.test(word)
                    ? word
                    : {text: word, noWrap: true}
                )
            );
        }
        if (opts.fontSize) {
            node.fontSize = opts.fontSize;
        }
        if (opts.textAlign) {
            node.alignment = opts.textAlign;
        }
        return node;
    }

    /**
        Text made of several runs separated by line breaks, the
        equivalent of pdfjs `cell().text().add().br().add()`.

        @method richText
        @return {Object}
        @private
    */
    function richText() {
        let runs = [];
        let that = {node: {text: runs}};

        that.add = function (value, opts) {
            runs.push(textNode(value, opts));
            return that;
        };

        that.br = function () {
            runs.push("\n");
            return that;
        };

        return that;
    }

    /**
        Whether bytes are an image pdfkit can embed (JPEG or PNG).

        @method isImage
        @param {Buffer} bytes
        @return {Boolean}
        @private
    */
    function isImage(bytes) {
        return Boolean(bytes) && bytes.length > 4 && (
            (bytes[0] === 0xff && bytes[1] === 0xd8) ||
            (bytes.toString("latin1", 1, 4) === "PNG")
        );
    }

    function spacer(height) {
        return {canvas: [], margin: [0, height, 0, 0]};
    }

    /**
        Table layout with no rules and fixed cell padding.

        @method plainLayout
        @param {Object} padding Padding in points for left, right, top
        and bottom
        @param {Function} [hLineWidth] Horizontal rule width by index
        @return {Object}
        @private
    */
    function noLine() {
        return 0;
    }

    function plainLayout(padding, hLineWidth) {
        return {
            hLineWidth: hLineWidth || noLine,
            vLineWidth: noLine,
            paddingLeft: () => padding.left,
            paddingRight: () => padding.right,
            paddingTop: () => padding.top,
            paddingBottom: () => padding.bottom
        };
    }

    function evenPadding(n) {
        return {left: n, right: n, top: n, bottom: n};
    }

    /**
        pdfmake places headers and footers inside the page margins, so the
        margins must be large enough to hold them. Lay out each node on its
        own tall page with a marker after it and read where the marker
        landed.

        @method measureHeights
        @param {Array} nodes Functions that each return a fresh node
        (pdfmake annotates the nodes it lays out, so they are not reused)
        @param {Object} def Document definition the nodes belong to
        @return {Promise} Array of heights in points
        @private
    */
    async function measureHeights(nodes, def) {
        let tops = {};
        let content = [];

        nodes.forEach(function (node, i) {
            content.push({
                stack: [node()],
                pageBreak: (
                    i
                    ? "before"
                    : undefined
                )
            });
            content.push({text: ".", id: MEASURE_ID + i});
        });

        await pdfmake.createPdf({
            pageSize: {width: def.pageSize.width, height: MEASURE_HEIGHT},
            pageMargins: [0, 0, 0, 0],
            defaultStyle: def.defaultStyle,
            images: Object.assign({}, def.images),
            content,
            pageBreakBefore: function (node) {
                if (node.id && node.id.startsWith(MEASURE_ID)) {
                    tops[node.id] = node.startPosition.top;
                }
                return false;
            }
        }).getBuffer();

        // Round up so floating point error cannot push the last line of
        // a header out of its margin
        return nodes.map(
            (ignore, i) => Math.ceil(tops[MEASURE_ID + i] || 0) + 1
        );
    }

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
            let page = sizes[defSize];
            let content = [];
            let doc = {
                pageSize: {
                    width: page.width,
                    height: page.height
                },
                pageMargins: [
                    PAGE_PADDING,
                    PAGE_PADDING_TOP,
                    PAGE_PADDING,
                    PAGE_PADDING
                ],
                defaultStyle: Object.assign(
                    fontStyle("Helvetica"),
                    fontStyle(defFont),
                    {fontSize: DEFAULT_FONT_SIZE}
                ),
                info: {
                    creator: vClient.currentUser()
                },
                images: {},
                content
            };
            let section = content;

            let header;
            let headerCells;
            let footer;
            let heights;
            let src;
            let res;
            /*
                The logo is a pointer the customer supplies: a URL,
                or the name of a file they have uploaded to this
                server (John, 2026-10-18: "Let people simply upload
                their own logo and point to that. Any request on
                reports for the logo need to request it from there").

                It used to relate to a `ResourceLink` row, which tied
                it to one instance and kept it out of the settings
                that belong to the organization. An object with a
                `resource` is still read, so an installation that
                already had one keeps printing it.
            */
            let configured = globalSettings || {};
            let logo = configured.logo;

            if (logo && typeof logo === "object") {
                logo = logo.resource;
            }

            let where = String(logo || "");

            if (logo) {
                if (where.startsWith("http")) {
                    res = await fetch(logo);
                    src = await res.buffer();
                } else {
                    /*
                        A name, not a path: the uploaded file is
                        taken from the upload directory and nowhere
                        else, so a setting cannot read its way across
                        the file system.
                    */
                    src = fs[readFileSync](
                        "./files/upload/" + path_.basename(where)
                    );
                }
            } else {
                src = fs[readFileSync]("./files/logo.jpg");
            }
            if (isImage(src)) {
                doc.images.logo = (
                    "data:application/octet-stream;base64," +
                    src.toString("base64")
                );
            } else {
                console.error(
                    "Logo is not a JPEG or PNG image; printing without it"
                );
            }
            let n = 0;
            let file = (filename || f.createId()) + ".pdf";
            let path = dir + file;

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

            // Cells are appended to `row` (an array) in order. Some
            // branches add no cell at all, exactly as before; rows are
            // padded to the table width when the table is built.
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
                let ovrFont = fontStr;

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
                    row.push(textNode(""));
                    return;
                }

                if (typeof p.type === "object") {
                    if (value === null) {
                        row.push(textNode(""));
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
                        row.push(textNode(fontMod(value), {
                            font: ovrFont,
                            fontSize: style.fontSize
                        }));
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
                            row.push(textNode(figure));
                        }
                        return;
                    }

                    if (inheritedFrom(p.type.relation, "Contact")) {
                        rel = richText();
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
                        row.push(rel.node);
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
                    rel = richText();
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
                    row.push(rel.node);
                    return;
                }

                switch (p.type || typeof value) {
                case "string":
                    if (!value) {
                        row.push(textNode(""));
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

                    row.push(textNode(fontMod(value), {
                        font: ovrFont,
                        fontSize: style.fontSize
                    }));
                    break;
                case "boolean":
                    if (value) {
                        value = "X";
                    } else {
                        value = "";
                    }
                    row.push(textNode(fontMod(value), {
                        font: ovrFont,
                        fontSize: style.fontSize
                    }));
                    break;
                case "integer":
                case "number":
                    row.push(textNode(fontMod(value.toLocaleString()), {
                        font: ovrFont,
                        fontSize: style.fontSize,
                        textAlign: "right"
                    }));
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
                            row.push(textNode(fontMod(value), {
                                font: ovrFont,
                                fontSize: style.fontSize,
                                textAlign: "right"
                            }));
                        } else {
                            row.push(textNode("Invalid currency"));
                        }
                    }
                    break;
                default:
                    row.push(textNode(fontMod(value), {
                        font: ovrFont,
                        fontSize: style.fontSize
                    }));
                }
            }

            function padRow(row, length) {
                while (row.length < length) {
                    row.push(textNode(""));
                }
                return row.slice(0, length);
            }

            function formatTable(obj) {
                let feather = localFeathers[obj.feather];
                let attr = obj.attribute;
                let p = resolveProperty(attr.attr, feather);

                let tr = [];
                let body = [tr];
                let lines;
                let maxWidth = page.width - PAGE_PADDING - PAGE_PADDING;
                let ttlWidth = 0;
                let cols = attr.columns.filter(function (c) {
                    ttlWidth += c.width || COL_WIDTH_DEFAULT;
                    return ttlWidth <= maxWidth;
                });

                if (attr.showLabel) {
                    section.push(spacer(10));
                    section.push(Object.assign(
                        textNode(getLabel(obj.feather, attr) + ":", {
                            font: defFont + "Bold"
                        }),
                        {margin: CELL_PADDING}
                    ));
                }

                if (!p.type) {
                    throw (
                        "Attribute '" +
                        p.name + "' does not have a relation"
                    );
                }
                feather = localFeathers[p.type.relation];

                function addHeaderCol(col) {
                    let opts = {
                        font: defFont + "Bold"
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
                    tr.push(textNode(getLabel(feather.name, col), opts));
                }

                function addRow(rec) {
                    let row = [];

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
                    body.push(padRow(row, cols.length));
                }

                cols.forEach(addHeaderCol);
                lines = data[attr.attr] || [];
                lines.forEach(addRow);

                if (!cols.length) {
                    return;
                }

                section.push({
                    table: {
                        headerRows: 1,
                        widths: cols.map(
                            (c) => (
                                (c.width || COL_WIDTH_DEFAULT) -
                                2 * CELL_PADDING
                            )
                        ),
                        body
                    },
                    // Heavy rule above and below the column headings,
                    // hairlines between rows
                    layout: plainLayout(
                        evenPadding(CELL_PADDING),
                        function (i) {
                            if (i === 1) {
                                return 1.5;
                            }
                            return (
                                i < 2
                                ? 1
                                : 0.1
                            );
                        }
                    )
                });
            }

            function buildSection(tab) {
                let attrs = form.attrs.filter((a) => a.grid === n);
                let colCnt = 0;
                let rowCnt = 0;
                let ary = [];
                let body = [];
                let units = [];
                let c = 0;
                let tables = [];

                if (tab) {
                    section.push(spacer(10));
                    section.push({
                        table: {
                            widths: ["*"],
                            body: [[Object.assign(
                                textNode(tab.name, {
                                    font: defFont + "Bold",
                                    fontSize: 14
                                }),
                                {fillColor: "#d3d3d3"}
                            )]]
                        },
                        layout: plainLayout({
                            left: 9,
                            right: 0,
                            top: 0,
                            bottom: 2
                        })
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
                    units.push(100 - 2 * CELL_PADDING); // label
                    units.push(134 - 2 * CELL_PADDING); // value
                    c += 1;
                }

                function addRow() {
                    let row = [];
                    let i = 0;
                    let attr;
                    let label;

                    body.push(row);
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

                                row.push(textNode(label + ":", {
                                    textAlign: "right",
                                    font: defFont + "Bold"
                                }));
                            } else {
                                row.push(textNode(""));
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

                if (body.length) {
                    section.push({
                        table: {
                            widths: units,
                            body: body.map((r) => padRow(r, units.length))
                        },
                        layout: plainLayout(evenPadding(CELL_PADDING))
                    });
                }

                while (tables.length) {
                    formatTable(tables.shift());
                }

                n += 1;
            }

            if (form.hideLogo !== true || form.hideTitle !== true) {
                header = [
                    textNode(
                        (
                            form.hideTitle
                            ? ""
                            : form.title || rows[0].objectType.toName()
                        ),
                        {
                            fontSize: 20,
                            font: defFont + "Bold"
                        }
                    )
                ];

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
                    header.push(textNode(addr));
                    if (doc.images.logo) {
                        header.push({
                            image: "logo",
                            fit: [2.5 * CM, 2.5 * CM],
                            alignment: "right"
                        });
                    }
                }

                headerCells = header;
                header = function () {
                    return {
                        margin: [
                            PAGE_PADDING,
                            PAGE_PADDING_TOP,
                            PAGE_PADDING,
                            0
                        ],
                        table: {
                            widths: ["*", 5 * CM, 2.5 * CM],
                            body: [padRow(f.copy(headerCells), 3)]
                        },
                        layout: plainLayout({
                            left: 0,
                            right: 0,
                            top: 0,
                            bottom: 1 * CM
                        })
                    };
                };
            }

            footer = function (curr, total) {
                return {
                    text: curr + " / " + total,
                    alignment: "center",
                    margin: [PAGE_PADDING, 0, PAGE_PADDING, 0]
                };
            };

            // Make room for the header and footer, which pdfmake draws
            // inside the page margins
            heights = await measureHeights(
                (
                    header
                    ? [header, footer.bind(null, 1, 1)]
                    : [footer.bind(null, 1, 1)]
                ),
                doc
            );
            if (header) {
                doc.pageMargins[1] = heights.shift();
                doc.header = header;
            }
            doc.pageMargins[3] = PAGE_PADDING + heights.shift();
            doc.footer = footer;

            content.push(spacer(0.1 * CM));

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
                    // Each record after the first starts a new page
                    section = [];
                    content.push({
                        stack: section,
                        pageBreak: (
                            content.length > 1
                            ? "before"
                            : undefined
                        )
                    });
                    buildSection();
                    form.tabs.forEach(buildSection);
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

            await pdfmake.createPdf(doc).write(path);
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

