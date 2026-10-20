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
    Mail the system sends on its own account: a new user's invitation, a
    password reset, a confirmation code.

    These used to go out through the installation's `config.json` SMTP
    settings alone, so the mail account an administrator entered under
    Settings (which belongs to the organization) was never used for
    them -- only for mail a person sent by hand. The organization's
    account now comes first, and `config.json` stays as the fallback
    for an installation that has no organization account.

    @module Notify
*/
(function (exports) {
    "use strict";

    const {Config} = require("../config");
    const datasource = require("../datasource");

    const config = new Config();

    /**
        @class Notify
        @constructor
        @namespace Services
    */
    exports.Notify = function () {
        let that = {};

        /**
            The SMTP account to send from, or undefined when the
            organization has none and the installation's own should be
            used.

            @method smtpFor
            @param {Object} [tenant] Instance whose settings to read
            @param {String} user User to read the settings as
            @return {Promise} SMTP definition or undefined
        */
        that.smtpFor = async function (tenant, user) {
            let settings;

            if (!tenant) {
                return;
            }

            settings = await datasource.request({
                data: {name: "globalSettings"},
                method: "GET",
                name: "getSettings",
                tenant,
                user
            }, true);

            if (
                !settings ||
                settings.smtpType !== "SMTP" ||
                !settings.smtpHost
            ) {
                return;
            }

            return {
                auth: {
                    pass: settings.smtpPassword,
                    user: settings.smtpUser
                },
                host: settings.smtpHost,
                port: settings.smtpPort,
                secure: settings.smtpSecure,
                type: "SMTP"
            };
        };

        /**
            Send one message. Rejects, with a message an administrator
            can act on, when nothing is configured or the server
            refuses; callers decide whether that is fatal.

            @method send
            @param {Object} [tenant] Instance whose organization settings
            apply
            @param {String} user User to read the settings as
            @param {Object} message Mail message (to, subject, html, text)
            @return {Promise}
        */
        that.send = async function (tenant, user, message) {
            let smtp;
            let conf;

            try {
                smtp = await that.smtpFor(tenant, user);
            } catch (e) {
                console.error(
                    "Could not read the organization's mail settings: " +
                    (e.message || e)
                );
            }

            if (!smtp) {
                conf = await config.read();

                if (!conf.smtpHost) {
                    return Promise.reject(new Error(
                        "No mail server is set up. Enter SMTP " +
                        "credentials under Settings, or smtpHost in " +
                        "config.json."
                    ));
                }
            }

            try {
                await datasource.request({
                    data: {
                        message,
                        smtp
                    },
                    method: "POST",
                    name: "sendMail",
                    tenant: false,
                    user
                }, true);
            } catch (e) {
                console.error("Mail to " + message.to + " failed: " + (
                    e.message || e
                ));
                return Promise.reject(e);
            }
        };

        return that;
    };

}(exports));
