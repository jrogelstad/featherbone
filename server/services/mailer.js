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
            Send an email message with a Pdf attached.

            @method sendPdf
            @param {Object} Request payload
            @param {Object} [payload.data] Payload data
            @param {String} [payload.data.from] From address
            @param {String} [payload.data.to] To address
            @param {String} [payload.data.cc] Cc address
            @param {String} [payload.data.bcc] Bcc address
            @param {String} [payload.data.subject] Subject
            @param {String} [payload.data.text] Message text
            @param {String} [payload.data.html] Message html
            @param {String} [payload.data.form] Form name
            @param {String|Array} [payload.data.ids] Record id or ids
            @param {Object} [payload.client] Database client
            @return {Object} Promise
        */
        that.sendPdf = function (obj) {
            return new Promise(function (resolve, reject) {
                let message = obj.data.message;
                let opts = obj.data.pdf;

                function cleanup() {
                    fs.unlink(message.attachements.path, function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    });
                }

                function sendMail(resp) {
                    let transporter;
                    /*
                    message.attachments = {
                        path: "./files/downloads/" + resp
                    };
                    */
                    transporter = nodemailer.createTransport(smtp);
                    transporter.sendMail(message).then(function (info) {
                        console.log("Message sent: %s", info.messageId);
                        console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
                        cleanup();
                    }).catch(reject);
                }

                pdf.printForm(obj.client, opts.form, opts.ids).then(
                    sendMail
                ).catch(
                    reject
                );
            });
        };

        return that;
    };

}(exports));

