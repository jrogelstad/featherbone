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
        Helvetica: require("pdfjs/font/Helvetica"),
        HelveticaBold: require("pdfjs/font/Helvetica-Bold"),
        TimesRoman: require("pdfjs/font/Times-Roman")
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

                function getForm() {
                    return new Promise(function (resolve, reject) {
                        crud.doSelect({
                            name: "Form",
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
                            if (!resp[1]) {
                                reject("Form " + form + " not found");
                                return;
                            }

                            if (!resp[1].isActive) {
                                reject("Form" + form + " is not active");
                                return;
                            }
                        }
                        form = resp[1];

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

                function doPrint() {
                    return new Promise(function (resolve) {
                        let fn = "readFileSync"; // Lint dogma
                        //let feather = resp;
                        let doc = new pdf.Document({
                            font: fonts.Helvetica,
                            padding: 10
                        });

                        let header = doc.header().table({
                            widths: [null, null],
                            paddingBottom: 1 * pdf.cm
                        }).row();

                        let cell;
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

                        header.cell().image(logo, {
                            height: 2 * pdf.cm
                        });
                        header.cell().text({
                            textAlign: "right"
                        }).add(
                            "A Portable Document Format (PDF)" +
                            "generation library targeting both the server- " +
                            "and client-side."
                        ).add("https://github.com/rkusa/pdfjs", {
                            link: "https://github.com/rkusa/pdfjs",
                            underline: true,
                            color: 0x569cd6
                        });

                        doc.footer().pageNumber(function (curr, total) {
                            return curr + " / " + total;
                        }, {
                            textAlign: "center"
                        });

                        cell = doc.cell({
                            paddingBottom: 0.5 * pdf.cm
                        });
                        cell.text("Features:", {
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

