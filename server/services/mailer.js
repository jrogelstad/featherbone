/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
        smtp = {
            auth: {
                pass: resp.smtpAuthPass,
                user: resp.smtpAuthUser
            },
            host: resp.smtpHost,
            port: resp.smtpPort,
            secure: resp.smtpSecure
        };
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

            Note: if data ids are not provided for pdf, assume file has
            already been generated at the filename.

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
            @param {String} [payload.data.pdf.filename] Name of attachement
            @param {Object} [payload.data.tenant] Use SMTP credentials from
            tenant's database global settings
            @param {Object} payload.client Database client
            @return {Object} Promise
        */
        that.sendMail = async function (obj) {
            let message = obj.data.message;
            let opts = obj.data.pdf;
            let theSmtp = obj.data.smtp || smtp;

            function cleanup() {
                return new Promise(function (resolve, reject) {
                    fs.unlink(message.attachments.path, function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    });
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
                    let transporter = nodemailer.createTransport(theSmtp);

                    transporter.sendMail(
                        message
                    ).then(
                        resolve
                    ).catch(
                        reject
                    );
                });
            }

            function sendMailWithOptions() {
                return new Promise(function (resolve, reject) {
                    if (!opts.ids && !opts.data) {
                        attachPdf(opts.filename).then(
                            sendMail
                        ).then(
                            cleanup
                        ).then(
                            resolve
                        ).catch(
                            reject
                        );
                    } else {
                        pdf.printForm(
                            obj.client,
                            opts.form,
                            opts.data || opts.ids,
                            opts.filename
                        ).then(
                            attachPdf
                        ).then(
                            sendMail
                        ).then(
                            cleanup
                        ).then(
                            resolve
                        ).catch(
                            reject
                        );
                    }
                });
            }

            try {
                if (opts) {
                    return await sendMailWithOptions();
                } else {
                    return await sendMail();
                }
            } catch (e) {
                return Promise.reject(e);
            }
        };

        return that;
    };

}(exports));

