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
/*jslint node devel*/
/**
    @module Email
*/
(function (exports) {
    "use strict";

    const fs = require("fs");
    const {PDF} = require("./pdf");
    const {Config} = require("../config");
    const {google} = require("googleapis");
    const gmail = google.gmail({version: "v1"});

    const config = new Config();
    const pdf = new PDF();
    const nodemailer = require("nodemailer");
    const path = require("path");
    let smtp;
    let credentials = {};
    let googleOauth2ClientId;
    let googleOauth2ClientSecret;

    // Function to send the email using Gmail API
    async function sendMimeMessageViaService(mimeMessage) {
        const jwtClient = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ["https://www.googleapis.com/auth/gmail.send"],
            // Specify the email address of the user the service
            // account is impersonating.
            // Ensure the service account has domain-wide authority
            // to impersonate this user.
            credentials.userEmail
        );
        // Authorize the JWT client and get a token to make API calls
        await jwtClient.authorize();
        // Send the email using the Gmail API
        await gmail.users.messages.send({
            auth: jwtClient,
            resource: {raw: mimeMessage},
            userId: credentials.userEmail
        });
        //console.log("Email sent:", response.data);
    }

    function sendGmailViaService(message) {
        return new Promise(function (resolve, reject) {
            let transporter = nodemailer.createTransport({
                buffer: true,
                newline: "unix",
                streamTransport: true
            });

            function mimeMethod(err, info) {
                if (err) {
                    return console.error("Failed to send mail:", err);
                }
                const mimeMessage = info.message.toString("base64");
                sendMimeMessageViaService(mimeMessage).then(function () {
                    //console.log("Email sent successfully.");
                    resolve();
                }).catch(function (error) {
                    console.error("Error sending email:", error);
                    reject(error);
                });
            }

            transporter.sendMail(message, mimeMethod);
        });
    }

    function readGoogleKeys(name) {
        return new Promise(function (resolve, reject) {
            let filename = path.format(
                {base: "/keys/" + name, root: "./"}
            );

            fs.readFile(filename, "utf8", function (err, data) {
                if (err) {
                    console.error(err);
                    return reject(err);
                }
                data = JSON.parse(data);

                resolve(data);
            });
        });
    }

    config.read().then(function (resp) {
        smtp = {
            auth: {
                pass: resp.smtpAuthPass,
                user: resp.smtpAuthUser
            },
            host: resp.smtpHost,
            port: resp.smtpPort,
            secure: resp.smtpSecure,
            type: "SMTP"
        };

        credentials.userEmail = resp.googleEmailUserAccount;

        if (resp.googleOauth2ClientId) {
            googleOauth2ClientId = resp.googleOauth2ClientId;
            googleOauth2ClientSecret = resp.googleOauth2ClientSecret;
        }

        if (resp.googleEmailClientFile) {
            readGoogleKeys(resp.googleEmailClientFile).then(function (data) {
                credentials = data;
                credentials.userEmail = resp.googleEmailUserAccount;
            });
        }
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

        /*
            The mail account the organization entered under Settings,
            for a message sent from inside an instance -- a package's
            trigger, say. Those used to go out through `config.json`
            alone, which on a hosted server is a second place to set
            the same account up and, when unset, a mail server on
            localhost: Tracker's notice of a new issue failed on
            "connect ECONNREFUSED 127.0.0.1:465" and took the save
            with it (John, Oct 2026).

            The instance is named by `data.tenant`, or is the one the
            request came from. A message with neither (the system's own
            mail, which reads the organization's account itself and
            says so by passing it) falls through to `config.json`, as
            does an organization with no account.
        */
        async function organizationSmtp(obj) {
            let client = obj.client;
            let tenant = obj.data.tenant || obj.tenant;
            let user = obj.user;

            if (client && typeof client.tenant === "function") {
                tenant = tenant || client.tenant();
            }
            if (client && typeof client.currentUser === "function") {
                user = user || client.currentUser();
            }

            if (!tenant || !tenant.pgDatabase) {
                return;
            }

            try {
                // Loaded here: notify needs the datasource, which
                // needs this file
                let {Notify} = require("./notify");

                return await new Notify().smtpFor(tenant, user);
            } catch (e) {
                console.error(
                    "Could not read the organization's mail settings: " +
                    (e.message || e)
                );
            }
        }

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
            let theSmtp = obj.data.smtp || await organizationSmtp(obj) || smtp;
            let thePath = false;
            message.from = message.from || theSmtp.auth.user;

            function attachPdf(resp) {
                return new Promise(function (resolve) {
                    message.attachments = {
                        path: "./files/downloads/" + resp
                    };
                    thePath = message.attachments.path;
                    resolve();
                });
            }

            async function sendMail() {
                let transporter;

                try {
                    switch (theSmtp.type) {
                    case "Gmail":
                        transporter = nodemailer.createTransport({
                            auth: {
                                accessToken: theSmtp.auth.accessToken,
                                clientId: googleOauth2ClientId,
                                clientSecret: googleOauth2ClientSecret,
                                refreshToken: theSmtp.auth.refreshToken,
                                type: "OAuth2",
                                user: theSmtp.auth.user
                            },
                            service: "gmail"
                        });
                        await transporter.sendMail(message);
                        break;
                    case "SMTP":
                        transporter = nodemailer.createTransport(theSmtp);
                        await transporter.sendMail(message);
                        break;
                    default:
                        await sendGmailViaService(message);
                    }
                } catch (e) {
                    console.error(e);
                    return Promise.reject(e);
                }
            }

            function sendMailWithOptions() {
                return new Promise(function (resolve, reject) {
                    if (!opts.ids && !opts.data) {
                        attachPdf(opts.filename).then(
                            sendMail
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
            } finally {
                if (thePath) {
                    fs.unlink(thePath, function (err) {
                        if (err) {
                            console.error(err);
                        }
                    });
                }
            }
        };

        return that;
    };

}(exports));

