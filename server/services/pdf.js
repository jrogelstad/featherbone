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
/*jslint node, this, for*/

/**
    PDF file generator.
    @module PDF
*/
(function (exports) {
    "use strict";

    const f = require("../../common/core");
    const {CRUD} = require("./crud");
    const {Feathers} = require("./feathers");
    const pdf = require("pdfjs");
    const fonts = {
        Courier: require("pdfjs/font/Courier"),
        CourierBold: require("pdfjs/font/Courier-Bold"),
        CourierBoldOblique: require("pdfjs/font/Courier-BoldOblique"),
        CourierOblique: require("pdfjs/font/Courier-Oblique"),
        Helvetica: require("pdfjs/font/Helvetica"),
        HelveticaBold: require("pdfjs/font/Helvetica-Bold"),
        HelveticaBoldOblique: require("pdfjs/font/Helvetica-BoldOblique"),
        HelveticaOblique: require("pdfjs/font/Helvetica-Oblique"),
        Symbol: require("pdfjs/font/Symbol"),
        TimesBold: require("pdfjs/font/Times-Bold"),
        TimesBoldItalic: require("pdfjs/font/Times-BoldItalic"),
        TimesItalic: require("pdfjs/font/Times-Italic"),
        TimesRoman: require("pdfjs/font/Times-Roman"),
        ZapfDingbats: require("pdfjs/font/ZapfDingbats")
    };
    const fs = require("fs");
    const crud = new CRUD();
    const feathers = new Feathers();

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
            Create pdf based on form definition.

            @method printForm
            @param {Object} Database client
            @param {String} Form name
            @param {String | Array} Record Id or Id array
            @param {String} Target file directory
            @return {String} Filename
        */
        that.printForm = function (vClient, form, ids, dir) {
            return new Promise(function (resolve, reject) {
                if (!Array.isArray(ids)) {
                    ids = [ids];
                }
                let requests = [];
                let rows;
                console.log("FORM->", form);
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

                        if (!rows.length) {
                            reject("Data not found");
                            return;
                        }
                        if (form) {
                            if (!resp[1][0]) {
                                reject("Form " + form + " not found");
                                return;
                            }

                            if (!resp[1][0].isActive) {
                                reject("Form " + form + " is not active");
                                return;
                            }
                        }
                        form = resp[1][0];

                        feathers.getFeather({
                            client: vClient,
                            data: {
                                name: rows[0].objectType
                            }
                        }).then(resolve).catch(reject);
                    });
                }

                function getData() {
                    return new Promise(function (resolve, reject) {
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

                function doPrint(resp) {
                    return new Promise(function (resolve) {
                        console.log(JSON.stringify(form, null, 2));
                        let fn = "readFileSync"; // Lint dogma
                        let feather = resp;
                        let doc = new pdf.Document({
                            width: 612,
                            height: 792,
                            font: fonts.Helvetica,
                            padding: 10,
                            properties: {
                                creator: vClient.currentUser(),
                                subject: form.description
                            }
                        });
                        //console.log(
                        //"FEATHER->", JSON.stringify(feather, null, 2));
                        let header = doc.header().table({
                            widths: [null, null],
                            paddingBottom: 1 * pdf.cm
                        }).row();

                        //let cell;
                        let table;
                        let tr;
                        let src = fs[fn]("featherbone.jpg");
                        let logo = new pdf.Image(src);
                        let lorem = (
                            "Lorem ipsum dolor sit amet, consectetur " +
                            "adipiscing elit. Cum id fugiunt, re eadem " +
                            " quae Peripatetici, verba. Tenesne igitur, " +
                            "inquam, Hieronymus Rhodius quid dicat esse " +
                            "summum bonum, quo putet omnia referri oportere?" +
                            " Quia nec honesto quic quam honestius nec turpi" +
                            "turpius."
                        );
                        let n = 0;
                        let row = rows[0]; // Need to loop thru this

                        function getLabel(name) {
                            return (
                                feather.properties[name].alias ||
                                name.toName()
                            );
                        }

                        header.cell().text({
                            fontSize: 20,
                            font: fonts.HelveticaBold
                        }).add(feather.name.toName());

                        header.cell().image(logo, {
                            align: "right",
                            height: 1.5 * pdf.cm
                        });

                        function buildSection() {
                            let attrs = form.attrs.filter((a) => a.grid === n);
                            let colCnt = 0;
                            let rowCnt = 0;
                            let ary = [];
                            let tbl;
                            let units = [];
                            let c = 0;

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
                                units.push(null); // label
                                units.push(null); // value
                                c += 1;
                            }
                            tbl = doc.table({
                                widths: units,
                                padding: 5
                            });

                            function addRow() {
                                let atr = tbl.row();
                                let i = 0;
                                let attr;
                                let label;
                                let value;

                                while (i < colCnt) {
                                    attr = ary[i].shift();
                                    if (attr) {
                                        if (attr.showLabel) {
                                            label = (
                                                attr.label ||
                                                getLabel(attr.attr)
                                            );
                                            atr.cell(label + ":", {
                                                textAlign: "right"
                                            });
                                        } else {
                                            atr.cell("");
                                        }
                                        if (attr.columns.length) {
                                            value = "Array";
                                        } else {
                                            value = row[attr.attr];
                                            if (typeof value === "number") {
                                                value = value.toString();
                                            }
                                        }
                                        atr.cell(value);
                                    }
                                    i += 1;
                                }
                            }
                            c = 0;
                            while (c < rowCnt) {
                                addRow();
                                c += 1;
                            }

                            n += 1;
                        }

                        buildSection();
                        form.tabs.forEach(buildSection);

                        doc.footer().pageNumber(function (curr, total) {
                            return curr + " / " + total;
                        }, {
                            textAlign: "center"
                        });
                        /*
                        cell = doc.cell({
                            paddingBottom: 0.5 * pdf.cm
                        });

                        cell.text(feather.name.toName(), {
                            fontSize: 16,
                            font: fonts.HelveticaBold
                        });

                        cell.text({
                            fontSize: 14,
                            lineHeight: 1.35
                        }).add("-").add("different", {
                            color: 0xf8dc3f
                        }).add("font", {
                            font: fonts.TimesRoman
                        }).add("styling", {
                            underline: true
                        }).add("options", {
                            fontSize: 9
                        });
                        cell.text("- Images (JPEGs, other PDFs)");
                        cell.text("- Tables (fixed layout, header row)");
                        cell.text("- AFM fonts and");
                        cell.text((
                            "- OTF font embedding (as CID fonts, i.e., " +
                            "support for fonts with large character sets)"
                        ), {
                            font: fonts.OpenSans
                        });
                        cell.text(
                            "- Add existing PDFs (merge them or add them" +
                            " as page templates)"
                        );

                        doc.cell({
                            paddingBottom: 0.5 * pdf.cm
                        }).text().add(
                            "For more information visit the "
                        ).add("Documentation", {
                            link: (
                                "https://github.com/rkusa/pdfjs/" +
                                "tree/master/docs"
                            ),
                            underline: true,
                            color: 0x569cd6
                        });
                        */
                        table = doc.table({
                            widths: [
                                1.5 * pdf.cm,
                                1.5 * pdf.cm,
                                null,
                                2 * pdf.cm,
                                2.5 * pdf.cm
                            ],
                            borderHorizontalWidths: function (i) {
                                return (
                                    i < 2
                                    ? 1
                                    : 0.1
                                );
                            },
                            padding: 5
                        });

                        tr = table.header({
                            font: fonts.HelveticaBold,
                            borderBottomWidth: 1.5
                        });
                        tr.cell("#");
                        tr.cell("Unit");
                        tr.cell("Subject");
                        tr.cell("Price", {
                            textAlign: "right"
                        });
                        tr.cell("Total", {
                            textAlign: "right"
                        });

                        function addRow(qty, name, desc, price) {
                            let atr = table.row();
                            let amt = (price * qty);
                            atr.cell(qty.toString());
                            atr.cell("pc.");

                            let article = atr.cell().text();
                            article.add(name, {
                                font: fonts.HelveticaBold
                            }).br().add(desc, {
                                fontSize: 11,
                                textAlign: "justify"
                            });

                            atr.cell(price.toFixed(2) + " €", {
                                textAlign: "right"
                            });
                            atr.cell(amt.toFixed(2) + " €", {
                                textAlign: "right"
                            });
                        }

                        addRow(2, "Article A", lorem, 500);
                        addRow(1, "Article B", lorem, 250);
                        addRow(2, "Article C", lorem, 330);
                        addRow(3, "Article D", lorem, 1220);
                        addRow(2, "Article E", lorem, 120);
                        addRow(5, "Article F", lorem, 50);
                        addRow(2, "Article G", lorem, 500);
                        addRow(1, "Article H", lorem, 250);
                        addRow(2, "Article I", lorem, 330);
                        addRow(3, "Article J", lorem, 1220);
                        addRow(2, "Article K", lorem, 120);
                        addRow(5, "Article L", lorem, 50);

                        let id = f.createId();
                        let path = dir + id + ".pdf";
                        let w = fs.createWriteStream(path);
                        doc.pipe(w);
                        w.on("close", function () {
                            resolve(id);
                        });
                        doc.end();
                    });
                }

                requests.push(getData());
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

}(exports));

