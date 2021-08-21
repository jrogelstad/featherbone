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
/*jslint node devel*/
/**
    @module Email
*/
(function (exports) {
    "use strict";

    const fs = require("fs");
    const {PDF} = require("./pdf");
    const {Config} = require("../config");

    const config = new Config();
    const pdf = new PDF();
    const nodemailer = require("nodemailer");
    let smtp;

    config.read().then(function (resp) {
        smtp = resp.smtp;
    });

    /**
        @class Email
        @constructor
        @namespace Services
    */
    exports.Mail = function () {
        // ..........................................................
        // PRIVATE
        //

        let that = {};

        // ..........................................................
        // PUBLIC
        //

        /**
            Send an email message with an optional Pdf attached.

            @method send
            @param {Object} Request payload
            @param {Object} payload.data Payload data
            @param {Object} payload.data.message Message data
            @param {String} payload.data.message.from From address
            @param {String} payload.data.message.to To address
            @param {String} [payload.data.message.cc] Cc address
            @param {String} [payload.data.message.bcc] Bcc address
            @param {String} payload.data.message.subject Subject
            @param {String} [payload.data.message.text] Message text
            @param {String} [payload.data.message.html] Message html
            @param {Object} [payload.data.pdf] PDF Generation data (optional)
            @param {String} [payload.data.pdf.form] Form name
            @param {String|Array} [payload.data.pdf.ids] Record id or ids
            @param {filename} [payload.data.pdf.filename] Name of attachement
            @param {Object} payload.client Database client
            @return {Object} Promise
        */
        that.sendMail = function (obj) {
            return new Promise(function (resolve, reject) {
                let message = obj.data.message;
                let opts = obj.data.pdf;

                function cleanup() {
                    fs.unlink(message.attachments.path, function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    });
                }

                function attachPdf(resp) {
                    return new Promise(function (resolve) {
                        message.attachments = {
                            path: "./files/downloads/" + resp
                        };

                        resolve();
                    });
                }

                function sendMail() {
                    return new Promise(function (resolve, reject) {
                        let transporter = nodemailer.createTransport(smtp);

                        transporter.sendMail(
                            message
                        ).then(
                            resolve
                        ).catch(
                            reject
                        );
                    });
                }

                if (opts) {
                    pdf.printForm(
                        obj.client,
                        opts.form,
                        opts.ids,
                        opts.filename
                    ).then(
                        attachPdf
                    ).then(
                        sendMail
                    ).then(
                        cleanup
                    ).catch(
                        reject
                    );
                } else {
                    sendMail().then(resolve).catch(reject);
                }
            });
        };

        return that;
    };

}(exports));

