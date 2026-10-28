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
/*jslint node, this, eval, unordered */
(function () {
    "use strict";
    require("./common/string.js");

    const datasource = require("./server/datasource");
    const express = require("express");
    const session = require("express-session");
    const PgSession = require("connect-pg-simple")(session);
    const expressFileUpload = require("express-fileupload");
    const fs = require("fs");
    const os = require("os");
    const bodyParser = require("body-parser");
    const f = require("./common/core");
    const qs = require("qs");
    const AdmZip = require("adm-zip");
    const path = require("path");
    const passport = require("passport");
    const LocalStrategy = require("passport-local").Strategy;
    const MagicLoginStrategy = require("passport-magic-login").default;
    const {Config} = require("./server/config");
    const config = new Config();
    const {Admin} = require("./server/services/admin");
    const {Notify} = require("./server/services/notify");
    const {SignInLink} = require("./server/services/sign-in-link");
    const {serialize} = require("./server/services/serialize");
    const admin = new Admin();
    const notify = new Notify();
    const {Platform} = require("./server/services/platform");
    const {Federation} = require("./server/services/federation");
    const {Manager} = require("./server/services/manager");
    const {Oidc} = require("./server/services/oidc");
    const {Upgrade} = require("./server/services/upgrade");
    const upgrade = new Upgrade();
    const platform = new Platform();
    const federation = new Federation();
    const manager = new Manager();
    const oidc = new Oidc();
    const WebSocket = require("ws");
    const wss = new WebSocket.Server({noServer: true});
    const pdf = require("./server/services/pdf.js");
    const {webauthn} = require("./server/services/webauthn");
    const dbRouter = new express.Router();
    const GoogleStrategy = require("passport-google-oauth20").Strategy;
    const jsn = "_json"; // Lint tyranny
    const crypto = require("crypto");

    async function googleVerify(req, ignore, refreshToken, profile, cb) {
        const pool = req.sessionStore.pool;
        const theProfile = profile; // Lint tyranny
        const theRefreshToken = refreshToken; // Lint tyranny

        try {
            let sql = (
                "INSERT INTO \"$session\" " +
                "  (sid, sess, expire) " +
                "VALUES ($1, $2, " +
                "  (select now() + interval '100 years')) " +
                "ON CONFLICT (sid) DO UPDATE " +
                "SET sess=EXCLUDED.sess, expire=EXCLUDED.expire;"
            );
            let params = [req.user.id, {
                database: req.database,
                profile: theProfile,
                provider: "google",
                refreshToken: theRefreshToken
            }];
            await pool.query(sql, params);
            return cb(null, req.user);
        } catch (err) {
            return cb(err);
        }
    }

    const check = [
        "about",
        "admin",
        "api",
        "currency",
        "dashboard",
        "dashboard-target",
        "dashboard-targets",
        "dashboards",
        "data",
        "do",
        "feather",
        "help",
        "help-topic",
        "module",
        "modules",
        "navigation-categories",
        "openapi.json",
        "profile",
        "sessions",
        "settings",
        "settings-definition",
        "workbook",
        "workbooks"
    ];
    const winston = require("winston");
    require("winston-daily-rotate-file");
    const argv = process.argv;
    let loglevel;
    let consolelog;
    let debug;

    argv.forEach(function (arg) {
        switch (arg) {
        case "--loglevel":
            loglevel = argv[argv.indexOf("--loglevel") + 1];
            break;
        case "-L":
            loglevel = argv[argv.indexOf("-L") + 1];
            break;
        case "--consolelog":
        case "-C":
            consolelog = true;
            break;
        }
    });

    /**
        @property datasource
        @type Datasource
        @for f
        @final
    */
    f.datasource = datasource;
    /**
        Fast json patch library per API documented here:
        https://github.com/Starcounter-Jack/JSON-Patch#api
        @property jsonpatch
        @type Object
        @for f
        @final
    */
    f.jsonpatch = require("fast-json-patch");

    /**
        The formats are hung on `f` by server/datasource.js, which
        install.js loads as well, so that a module's code can register
        its own however the install was started (item 0.11).

        @property formats
        @type Object
        @for f
        @final
    */

    let app = express();
    let eventSessions = {};
    let eventKeys = {};
    let sessions = {};
    let fileUpload = false;
    let port;
    let mode;
    let settings = datasource.settings();
    let dir = "./files";
    let pgPool;
    let sessionTimeout;
    let thesecret;
    let logger;
    let tenants = false;
    let systemUser;
    let magicLogin;
    let twoFactorAuth = false;
    let authenticateLocal;
    let googleOauth2ClientId;
    let googleOauth2ClientSecret;
    let googleOauth2CallbackUrl;
    let ssoCallbackUrl;
    let splashUrl;
    let splashTitle;
    let webhookSecret;
    let webhookHeader;

    // Work around linter dogma
    let existssync = "existsSync";
    let lstatsync = "lstatSync";
    let unlinksync = "unlinkSync";
    let readdirsync = "readdirSync";
    let mkdirsync = "mkdirSync";
    let rmdirsync = "rmdirSync";

    // Make sure file directories exist
    dir = "./files/import";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./files/upload";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./files/downloads";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./logs";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    /**
        Remove directory recursively.
        https://stackoverflow.com/a/42505874/3027390

        @method rimraf
        @param {string} dir_path
    */
    function rimraf(dir_path) {
        // Linter really hates "sync" methods
        if (fs[existssync](dir_path)) {
            fs[readdirsync](dir_path).forEach(function (entry) {
                let entry_path = path.join(dir_path, entry);

                if (fs[lstatsync](entry_path).isDirectory()) {
                    rimraf(entry_path);
                } else {
                    fs[unlinksync](entry_path);
                }
            });
            fs[rmdirsync](dir_path);
        }
    }

    // Handle response
    function respond(resp) {
        if (resp === undefined) {
            this.statusCode = 204;
        }

        // No caching... ever
        this.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        this.setHeader("Pragma", "no-cache"); // HTTP 1.0.
        this.setHeader("Expires", "0");

        // Send back a JSON response
        this.json(resp);
    }

    // Handle datasource error
    function error(err) {
        if (typeof err === "string") {
            err = new Error(err);
        }
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        logger.error(err.message);
        // Debugging aid: FB_LOG_STACK=1 prints where a datasource error
        // came from; the client only ever gets the message.
        if (process.env.FB_LOG_STACK) {
            console.error(err.stack || err.message);
        }
        this.status(err.statusCode).json(err.message);
        datasource.getCatalog().catch(function (e) {
            console.log(e);
        });
    }

    /*
        Refuse to start when the database configured as the control plane
        is not one (tenant plan A.1 and section 9). The marker is
        written by the bootstrap; a database installed before it existed
        has none, and is taken at its word so an upgrade is not blocked.
    */
    async function checkManager(conf) {
        let managerDb = config.managerDatabase(conf);
        let conn = await datasource.getPool();
        let resp = await conn.query(
            "SELECT kind FROM pg_tables, \"$db\" " +
            "WHERE tablename = '$db' AND schemaname = 'public'"
        ).catch(function () {
            return {rows: []};
        });
        let kind = (
            resp.rows.length
            ? resp.rows[0].kind
            : undefined
        );

        logger.info("Manager database \"" + managerDb + "\"");

        if (kind === undefined) {
            logger.warn(
                "Database \"" + managerDb + "\" carries no \"$db\" " +
                "marker. Install it to record what it is for."
            );
            return;
        }

        if (kind !== "manager") {
            console.error(
                "Featherbone will not start: \"" + managerDb +
                "\" is installed as a \"" + kind + "\" database. Point " +
                "managerDatabase at the management database, and install " +
                "it with `node install --manager` if it does not exist."
            );
            process.exit(1);
        }
    }

    /*
        What banner the database a user signed into should show. It is
        recorded in that database's own "$db" row, so one server serving
        a test and a production database says the right thing for each
        (John, Oct 2026). A database installed before the mode moved
        there has none, and the `mode` setting stands in.
    */
    async function modeOf(tenant) {
        let conn;
        let resp;

        try {
            conn = await datasource.getPool(tenant);
            resp = await conn.query(
                "SELECT mode FROM pg_tables, \"$db\" " +
                "WHERE tablename = '$db' AND schemaname = 'public'"
            );
        } catch (ignore) {
            return mode;
        }

        return (
            resp.rows.length && resp.rows[0].mode
            ? resp.rows[0].mode
            : mode
        );
    }

    async function init() {
        try {
            // Configure logger
            let resp = await config.read();
            let missing = config.missingSecrets(resp);
            if (missing.length) {
                // Logger isn't configured yet
                console.error(
                    "Featherbone will not start: set " + missing.join(", ") +
                    " in server/config.json (or the environment). " +
                    "pgCryptoKey cannot be changed on an existing database " +
                    "without re-encrypting its data."
                );
                process.exit(1);
            }
            let placeholders = config.placeholderSecrets(resp);
            if (placeholders.length) {
                console.warn(
                    "WARNING: " + placeholders.join(", ") + " in " +
                    "server/config.json still hold the template " +
                    "placeholder text. Anyone can forge sessions or decrypt " +
                    "data. Change them (an existing database's pgCryptoKey " +
                    "must be re-encrypted, not just edited)."
                );
            }
            let log = {
                level: resp.logLevel,
                zippedArchive: resp.logZippedArchive,
                maxSize: resp.logMaxSize,
                maxFiles: resp.logMaxFiles,
                silent: resp.logSilent
            };
            let fmt = winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            );

            logger = winston.createLogger({
                format: fmt,
                level: loglevel || log.level || "info",
                transports: [],
                silent: Boolean(log.silent)
            });

            if (consolelog) {
                logger.add(new winston.transports.Console({
                    format: winston.format.prettyPrint()
                }));
            }

            logger.add(
                new(winston.transports.DailyRotateFile)({
                    format: fmt,
                    filename: "./logs/featherbone-%DATE%.log",
                    datePattern: "YYYY-MM-DD-HH",
                    zippedArchive: Boolean(log.zippedArchive),
                    maxSize: log.maxSize || "20m",
                    maxFiles: log.maxFiles || "7d"
                })
            );

            logger.info("Featherbone server starting");

            /*
                One floating rejection must not take down a server that
                is serving every instance (improvement plan 6.1): on
                Node 15+ the default is to kill the process. Log it --
                with the stack, since these are exactly the defects that
                need finding -- and keep serving. uncaughtException is
                deliberately left alone: after a synchronous throw the
                process state is unknown and restarting is correct.
            */
            process.on("unhandledRejection", function (reason) {
                let msg = (
                    reason instanceof Error
                    ? (reason.stack || reason.message)
                    : String(reason)
                );

                logger.error("Unhandled rejection: " + msg);
                console.error("Unhandled rejection: " + msg);
            });

            // Other config
            debug = Boolean(resp.debug);

            // Default 1 day.
            sessionTimeout = resp.sessionTimeout || 86400000;
            thesecret = resp.secret;
            systemUser = resp.pgUser;
            mode = resp.mode || "prod";
            port = process.env.PORT || resp.clientPort || 80;
            fileUpload = Boolean(resp.fileUpload);
            twoFactorAuth = Boolean(resp.twoFactorAuth);
            /*
                The password alone never makes a session: whether a
                second factor is wanted is only known once the user is
                (installation config, or their organization's policy),
                so doSignIn opens the session itself when none is.
            */
            authenticateLocal = passport.authenticate("local", {
                failureFlash: true,
                failWithError: true,
                session: false
            });

            /*
                Bring the installation current before anything reads
                it (John, Oct 2026). This has to run ahead of the
                datasource: the manager it would connect to is one of
                the things a first upgrade creates. Off unless
                `selfUpgradeManager` or `selfUpgradeInstances` say
                otherwise, and a no-op when everything is current.
            */
            let upgraded = await upgrade.run(resp, logger).catch(
                function (err) {
                    /*
                        This runs on every boot, so it does not get to
                        be the reason a server that would otherwise
                        start does not. Whatever it could not do, the
                        steps below will meet on their own and say so
                        in their own terms.
                    */
                    logger.error("Self upgrade failed: " + err.message);
                    return {failed: [], fatal: false, ran: []};
                }
            );

            if (upgraded.fatal) {
                console.error(
                    "Featherbone will not start: the manager database " +
                    "could not be built. The log above says why."
                );
                process.exit(1);
            }

            await datasource.loadCryptoKey();
            await datasource.getCatalog();
            pgPool = await datasource.getPool();
            await datasource.loadNpmModules();
            await datasource.loadServices();
            await checkManager(resp);
            tenants = await datasource.loadTenants();
            await datasource.cleanupNodes();
            await datasource.cleanupProcesses();

            googleOauth2ClientId = resp.googleOauth2ClientId;
            googleOauth2ClientSecret = resp.googleOauth2ClientSecret;
            googleOauth2CallbackUrl = resp.googleOauth2CallbackUrl;
            ssoCallbackUrl = resp.ssoCallbackUrl;

            webauthn.loadCipher(process.env.CIPHER || resp.cipher);
            webauthn.init(
                (process.env.RPID || resp.rpId || "localhost"),
                (process.env.ORIGIN || resp.origin || "http://localhost")
            );
            splashUrl = resp.splashUrl;
            splashTitle = resp.splashTitle;
            webhookHeader = resp.webhookHeader || "";
            webhookSecret = resp.webhookSecret || "";

        } catch (err) {
            logger.error(err.message);
            console.log(err);
        }
    }

    // What a failed sign in may tell the caller. Account states the user can
    // act on pass through; anything else (raw Postgres errors, "no such
    // user ... on database x") is logged and replaced, so the response
    // doesn't reveal which users or databases exist.
    const SIGN_IN_MESSAGES = [
        "Too many sign in attempts.",
        "Invalid sign in credentials. One more attempt",
        "User account is locked",
        "Maximum allowed sessions",
        /*
            A held instance says so (ADR-002 question 7). Unlike the
            others this is not about the account, and unlike a closed
            instance it is a state that ends, so telling the person is
            the point: the alternative is a generic refusal while
            everything looks fine.
        */
        "Down for maintenance",
        /*
            An organization that has moved to single sign-on (ADR-001
            C.3). Also not about the account, and also a refusal that
            is useless unless it says what to do instead.
        */
        "Sign in with single sign-on."
    ];

    function signInMessage(err) {
        let msg = String((err && err.message) || "");

        if (SIGN_IN_MESSAGES.some((m) => msg.startsWith(m))) {
            return msg;
        }

        return "Invalid sign in credentials.";
    }

    function resolveName(apiPath, tenant) {
        //  Remove database from path
        apiPath = apiPath.slice(1);
        apiPath = apiPath.slice(apiPath.indexOf("/"));
        // Also remove verb
        apiPath = apiPath.slice(1);
        apiPath = apiPath.slice(apiPath.indexOf("/"));

        let name;
        let keys;
        let found;
        /*
            The catalog of the database the request is for (ADR-002).
            `doRequest` primes it before resolving, so the fallback to
            the union of loaded catalogs is only for callers that could
            not prime first; the request itself is still validated
            against the single right catalog inside the datasource.
        */
        let catalog = (
            (tenant && settings.cachedCatalog(tenant.pgDatabase)) ||
            settings.unionCatalog()
        );

        if (apiPath.lastIndexOf("/") > 0) {
            name = apiPath.match("[/](.*)[/]")[1].toCamelCase(true);
        } else {
            name = apiPath.slice(1).toCamelCase(true);
        }

        if (catalog) {
            // Look for feather with same name
            if (catalog[name]) {
                return name;
            }

            // Look for plural version
            keys = Object.keys(catalog);
            found = keys.filter(function (key) {
                return catalog[key].plural === name;
            });

            if (found.length) {
                return found[0];
            }

            return;
        }
    }

    // Copy of a request payload that is safe to write to the log: the tenant
    // is reduced to its database name and anything that looks like a
    // credential is masked.
    const SECRET_KEY = /pass|pwd|secret|token|credential|api.?key/i;

    function redact(value, key) {
        if (key && SECRET_KEY.test(key) && typeof value !== "object") {
            return "****";
        }
        if (Array.isArray(value)) {
            return value.map(function (item) {
                // JSON patch operation on a secret property
                if (
                    item && typeof item === "object" &&
                    SECRET_KEY.test(String(item.path || ""))
                ) {
                    return Object.assign({}, item, {value: "****"});
                }
                return redact(item);
            });
        }
        if (value && typeof value === "object") {
            let ret = {};
            Object.keys(value).forEach(function (k) {
                ret[k] = redact(value[k], k);
            });
            return ret;
        }
        return value;
    }

    function loggable(payload) {
        let log = Object.assign({}, payload);
        if (log.tenant) {
            log.tenant = log.tenant.pgDatabase;
        }
        if (log.data !== undefined) {
            log.data = redact(log.data);
        }
        return log;
    }

    function postify(req, res) {
        let payload = {
            method: "POST",
            name: this,
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.info(loggable(payload));
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    /*
        Module routes. A route is declared by the module version a
        database deployed (its package's routes.json), so the path alone
        says nothing: which function a path calls, or whether it exists
        at all, is decided per database. One handler therefore answers
        every /:db/<module>/<path> and asks the requesting database,
        and a path the database's version does not declare falls
        through to whatever else is mounted (ADR-002).
    */
    async function doModuleRoute(req, res, next) {
        if (!req.tenant) {
            next();
            return;
        }

        try {
            await primeTenant(req);
            let fn = await datasource.request({
                method: "GET",
                name: "getRouteFunction",
                user: systemUser,
                data: {
                    key: req.params.module + "/" + req.params[0]
                },
                tenant: req.tenant
            }, true);

            if (!fn) {
                next();
                return;
            }

            postify.call(fn, req, res);
        } catch (err) {
            error.bind(res)(err);
        }
    }

    /*
        First request for a database this process has not touched yet:
        read its catalog so names resolve against it rather than against
        some other database's (ADR-002).
    */
    async function primeTenant(req) {
        if (
            req.tenant &&
            settings.cachedCatalog(req.tenant.pgDatabase) === undefined
        ) {
            await datasource.primeCatalog(req.tenant);
        }
    }

    async function doRequest(req, res) {
        try {
            await primeTenant(req);
        } catch (err) {
            error.bind(res)(err);
            return;
        }

        let payload = {
            name: resolveName(req.url, req.tenant),
            method: req.method,
            user: req.user.name,
            eventKey: req.query.eventKey,
            id: req.params.id,
            data: req.body || {},
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doPostUserAccount(req, res) {
        let payload = {
            name: "UserAccount",
            method: "POST",
            user: req.user.name,
            eventKey: req.eventKey,
            id: req.params.id,
            data: req.body || {},
            tenant: req.tenant
        };
        let log = f.copy(payload);
        log.data.password = "****";

        logger.verbose(loggable(log));
        datasource.request(payload, req.user.isSuper).then(
            async function (data) {
                // A system lookup, like the other systemUser requests:
                // without the super user flag the service account's own
                // authorization applied, which for a Contact that is an
                // Employee answered nothing, and the account that had
                // just been created came back as a 500.
                let cntct = await datasource.request({
                    id: req.body.contact.id,
                    name: "Contact",
                    method: "GET",
                    properties: ["id", "email"],
                    user: systemUser,
                    tenant: req.tenant
                }, true);
                if (!cntct) {
                    throw new Error("Contact not found");
                }
                await magicLogin.send(linkRequest(req, {
                    accountType: req.body.accountType,
                    destination: cntct.email,
                    message: req.body.message,
                    newAccount: true,
                    username: req.body.name
                }), mailRes());
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }
    /*
        What a sign-in link says, and nothing more.

        The strategy signs the request body it is given into the link,
        and a signed token is readable by anyone who holds it: it is
        not encrypted. The links used to be sent with the whole request
        behind them -- the new account's password, a sign-in's password
        and the instance object with the Postgres service's credentials
        -- so an email, a proxy log or a browser history held them in
        the clear.

        The token now carries the user name, where the link goes and
        the database it opens, and the instance is looked up again on
        the way back in. A confirmation code travels as a keyed hash of
        the code, so the second factor cannot be read out of the link
        it guards. What the mail itself says (the code, an account's
        type and message) rides on the request, not in the token.
    */
    function codeHash(code) {
        return crypto.createHmac("sha256", thesecret).update(
            String(code)
        ).digest("hex");
    }

    function linkRequest(req, who) {
        let linkReq = Object.create(req);
        let tenant = req.tenant;
        let body = {
            database: (
                tenant
                ? tenant.pgDatabase
                : undefined
            ),
            destination: who.destination,
            username: who.username
        };

        if (who.confirmCode) {
            body.confirm = codeHash(who.confirmCode);
        }

        linkReq.body = body;
        linkReq.mail = {
            accountType: who.accountType,
            confirmCode: who.confirmCode,
            message: who.message,
            name: who.username,
            newAccount: who.newAccount === true
        };

        return linkReq;
    }

    /*
        A response stand-in for magic-link sends that answer the caller
        some other way. The strategy reports a failed send through
        res.status().json(), so the stand-in has to hold both or a mail
        hiccup turns the real answer into a 500 (seen with the
        two-factor envelope, C.2).
    */
    function mailRes() {
        return {
            end: () => "",
            json: () => "",
            send: () => "",
            status: function () {
                return this;
            }
        };
    }

    f.datasource.magicLoginSend = async function (opts) {
        let given = opts.body || {};
        let owner = given.user || {};

        await magicLogin.send(linkRequest(opts, {
            accountType: given.accountType,
            destination: given.destination,
            message: given.message,
            newAccount: given.newAccount,
            username: given.username || owner.name
        }), mailRes());
    };

    function doPatchUserAccount(req, res) {
        let payload = {
            name: "UserAccount",
            method: "PATCH",
            user: req.user.name,
            eventKey: req.query.eventKey,
            id: req.params.id,
            data: req.body || [],
            tenant: req.tenant
        };
        let log = f.copy(payload);
        log.data.forEach(function (item) {
            if (item.path === "/password") {
                item.value = "****";
            }
        });
        log.data.password = "****";

        logger.verbose(loggable(log));
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    async function doQueryRequest(req, res) {
        try {
            await primeTenant(req);
        } catch (err) {
            error.bind(res)(err);
            return;
        }

        let payload = req.body || {};
        let name = resolveName(req.url, req.tenant);
        /*
            Queries on Form, Module, Role and UserAccount used to run as a
            super user for every signed-in caller, so `$auth` had no say
            and every user could list all user accounts. The client needs
            these to start up, so the install grants `everyone` read on
            them instead -- which an administrator can now revoke.
        */
        let isSuper = req.user.isSuper;

        payload.name = name;
        payload.method = "GET"; // Internally this is a select statement
        payload.user = req.user.name;
        payload.filter = payload.filter || {};
        payload.tenant = req.tenant;

        if (payload.showDeleted) {
            payload.showDeleted = (
                payload.showDeleted === "true" || payload.showDeleted === true
            );
        }

        if (payload.subscription !== undefined) {
            payload.subscription.merge = (
                payload.subscription.merge === "true" ||
                payload.subscription.merge === true
            );
        }

        payload.filter.offset = payload.filter.offset || 0;

        logger.verbose(loggable(payload));
        datasource.request(payload, isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doAggregate(req, res) {
        let payload = {
            method: "POST",
            name: "doAggregate",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(
            payload,
            req.user.isSuper
        ).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doGetMethod(fn, req, res) {
        let payload = {
            method: "GET",
            name: fn,
            user: req.user.name,
            data: {name: req.params.name},
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(
            payload,
            req.user.isSuper
        ).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doGetBaseCurrency(req, res) {
        let query = qs.parse(req.query);
        let payload = {
            method: "GET",
            name: "baseCurrency",
            user: req.user.name,
            data: {effective: query.effective},
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doConvertCurrency(req, res) {
        let query = qs.parse(req.query);
        let payload = {
            method: "GET",
            name: "convertCurrency",
            user: req.user.name,
            data: {
                fromCurrency: query.fromCurrency,
                amount: query.amount,
                toCurrency: query.toCurrency,
                effective: query.effective
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetFeather(req, res) {
        req.params.name = req.params.name.toCamelCase(true);
        doGetMethod("getFeather", req, res);
    }

    function doGetSettingsRow(req, res) {
        doGetMethod("getSettingsRow", req, res);
    }

    function doGetSettingsDefinition(req, res) {
        doGetMethod("getSettingsDefinition", req, res);
    }

    function doGetDashboard(req, res) {
        doGetMethod("getDashboard", req, res);
    }

    function doGetDashboards(req, res) {
        doGetMethod("getDashboards", req, res);
    }

    function doGetWorkbook(req, res) {
        doGetMethod("getWorkbook", req, res);
    }

    function doGetWorkbooks(req, res) {
        doGetMethod("getWorkbooks", req, res);
    }

    function doGetNavigationCategories(req, res) {
        doGetMethod("getNavigationCategories", req, res);
    }

    /*
        The whole category list arrives in one request, so a round of
        edits in the maintenance dialog -- adds, renames, removals --
        applies together or not at all. See
        services/navigation-categories.js.
    */
    function doSaveNavigationCategories(req, res) {
        let payload = {
            method: "PUT",
            name: "saveNavigationCategories",
            user: req.user.name,
            data: {
                specs: req.body
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function registerDataRoute(catalog, key) {
        let name = key.toSpinalCase();

        if (catalog[key].isReadOnly) {
            dbRouter.get("/:db/data/" + name + "/:id", doRequest);
        } else {
            dbRouter.post("/:db/data/" + name, doRequest);
            dbRouter.get("/:db/data/" + name + "/:id", doRequest);
            dbRouter.patch("/:db/data/" + name + "/:id", doRequest);
            dbRouter.delete("/:db/data/" + name + "/:id", doRequest);
        }

        if (catalog[key].plural) {
            name = catalog[key].plural.toSpinalCase();
            dbRouter.post("/:db/data/" + name, doQueryRequest);
        }

    }

    /*
        A feather that only one database carries is in no catalog at
        mount time, so generic routes resolve it when a request arrives
        (ADR-002). Mounted once, after every specific route; read-only
        enforcement happens in the datasource against the request's own
        catalog, where it guards every database instead of one.
    */
    function registerDataFallback() {
        if (registerDataFallback.done) {
            return;
        }
        registerDataFallback.done = true;
        dbRouter.get("/:db/data/:collection/:id", doRequest);
        dbRouter.post("/:db/data/:collection", doDataPostFallback);
        dbRouter.patch("/:db/data/:collection/:id", doRequest);
        dbRouter.delete("/:db/data/:collection/:id", doRequest);
    }

    /*
        A POST under /data is a create when the path names a feather and
        a query when it names a feather's plural -- the enumerated
        routes encode that distinction at mount time, so the fallback
        has to make it at request time.
    */
    async function doDataPostFallback(req, res) {
        try {
            await primeTenant(req);
        } catch (err) {
            error.bind(res)(err);
            return;
        }

        let raw = req.params.collection.toCamelCase(true);
        let catalog = (
            (
                req.tenant &&
                settings.cachedCatalog(req.tenant.pgDatabase)
            ) || settings.unionCatalog()
        );

        if (catalog[raw]) {
            doRequest(req, res);
            return;
        }

        doQueryRequest(req, res);
    }

    function registerDataRoutes() {
        let keys;
        let catalog = settings.unionCatalog();

        keys = Object.keys(catalog).filter((key) => key !== "UserAccount");
        keys.forEach(registerDataRoute.bind(null, catalog));

        /*
            A feather that only a tenant database carries is not in any
            catalog at mount time, so a generic route resolves it when
            the request arrives (ADR-002). Mounted once, after the
            enumerated routes; read-only enforcement happens in the
            datasource against the request's own catalog, where it
            guards every database instead of one.
        */
    }

    /*
        The layout's name comes from the route, not the body, so a
        request cannot quietly save over a different layout than the
        one it addressed.
    */
    function doSaveDashboard(req, res) {
        let spec = Object.assign({}, req.body, {name: req.params.name});

        // Only the installer may speak with a package's voice; see
        // saveDashboard on why a package's default claim is weaker
        // than an administrator's.
        delete spec.fromPackage;
        let payload = {
            method: "PUT",
            name: "saveDashboard",
            user: req.user.name,
            data: spec,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetDashboardTargets(req, res) {
        doGetMethod("getDashboardTargets", req, res);
    }

    // Metric from the route, not the body.
    function doSaveDashboardTarget(req, res) {
        let payload = {
            method: "PUT",
            name: "saveDashboardTarget",
            user: req.user.name,
            data: Object.assign({}, req.body, {metric: req.params.metric}),
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doDeleteDashboardTarget(req, res) {
        let payload = {
            method: "DELETE",
            name: "deleteDashboardTarget",
            user: req.user.name,
            data: {metric: req.params.metric},
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doDeleteDashboard(req, res) {
        let payload = {
            method: "DELETE",
            name: "deleteDashboard",
            user: req.user.name,
            data: {name: req.params.name},
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSaveWorkbook(req, res) {
        let payload = {
            method: "PUT",
            name: "saveWorkbook",
            user: req.user.name,
            data: {
                specs: req.body
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            function () {
                registerDataRoutes();
                respond.bind(res)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doSaveSettings(req, res) {
        let payload = {
            method: "PUT",
            name: "saveSettings",
            user: req.user.name,
            data: {
                name: req.params.name,
                etag: req.body.etag,
                data: req.body.data
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            function (resp) {
                registerDataRoutes();
                respond.bind(res, resp)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doDeleteWorkbook(req, res) {
        let payload = {
            method: "DELETE",
            name: "deleteWorkbook",
            user: req.user.name,
            data: {name: req.params.name},
            tenant: req.tenant
        };
        if (req.isCamelCase) {
            payload.data.name = payload.data.name.toCamelCase(true);
        }

        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSubscribe(req, res) {
        let query = qs.parse(req.params.query);
        let payload = {
            method: "POST",
            name: "subscribe",
            user: req.user.name,
            id: query.id,
            subscription: query.subscription,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUnsubscribe(req, res) {
        let query = qs.parse(req.params.query);
        let payload = {
            method: "POST",
            name: "unsubscribe",
            user: req.user.name,
            subscription: query.subscription,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doLock(req, res) {
        let username = req.user.name;

        logger.verbose("Lock " + req.body.id);
        datasource.lock(
            req.body.id,
            username,
            req.body.eventKey,
            undefined,
            false,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUnlock(req, res) {
        let criteria;
        let usr = req.user.name;

        criteria = {
            id: req.body.id,
            username: usr
        };

        logger.verbose("Unlock " + req.body.id);
        datasource.unlock(
            criteria,
            undefined,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doPackageModule(req, res) {
        let name = req.params.name;
        let username = req.user.name;
        let options = {
            includeDashboard: !(
                req.body && req.body.includeDashboard === false
            )
        };

        logger.verbose("Package " + name);
        datasource.package(
            name,
            username,
            req.tenant,
            options
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    /*
        The Modules page's Install: a package zip, put on this server
        and applied to this database in one action (ADR-002 section 6).
        It used to unpack the zip into a temporary folder, write the
        module's code into this database's rows and delete the folder,
        so the server never held the package and the code that ran was a
        table row anyone with write access could change -- the very
        thing Install apart from Deploy exists to end. Now Install puts
        the files under modules/<name>/<version>/ and Deploy applies
        that version here, the same two acts the Instances screen and
        the command line perform, with the same rules: a platform
        administrator, the instance held while it runs, both ends
        audited.
    */
    async function doInstall(req, res) {
        let query = qs.parse(req.params.query);
        const TEMPFILE = "./files/tmp_" + f.createId() + ".zip";

        try {
            if (!req.user && !(req.session || {}).identity) {
                res.status(401).json("Unauthorized session");
                return;
            }
            if (!req.files || !req.files.package) {
                res.status(400).send("No files were uploaded.");
                return;
            }

            logger.verbose("Install");

            await req.files.package.mv(TEMPFILE);

            let payload = adminPayload(req);

            payload.data = {
                source: TEMPFILE,
                subscription: query.subscription
            };

            let done = await admin.installAndDeploy(payload);

            await refreshTenants();
            // What was installed and where, so the page can say so
            res.json(done);
        } catch (err) {
            error.bind(res)(err);
        } finally {
            fs.rmSync(TEMPFILE, {force: true});
        }
    }

    async function doUpgrade(req, res) {
        let query = qs.parse(req.params.query);
        const DIR = "./";

        logger.verbose("Upgrade");

        try {
            await datasource.install(
                DIR,
                req.user.name,
                {
                    subscription: query.subscription,
                    tenant: req.tenant,
                    databases: query.databases
                }
            );
            respond.bind(res)();
        } catch (err) {
            error.bind(res)(err);
        }
    }

    function doExport(req, res) {
        let apiPath = req.url.replace("/do/export", "");
        let feather = resolveName(apiPath);
        logger.verbose("Export", feather, req.params.format);

        datasource.export(
            feather,
            req.body.properties,
            req.body.filter || {},
            "./files/downloads/",
            req.params.format,
            req.user.name,
            req.body.subscription,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUpload(req, res) {
        const DIR = "./files/upload/";
        if (!fileUpload) {
            return res.status(400).send("File uploads not allowed.");
        }
        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        let file = req.files.dataFile;
        let owrite = file.overwrite;
        let filePath = DIR + file.name;
        fs.stat(filePath, function (ignore, stat) {
            if (stat && !owrite) {
                res.json({
                    message: "File already exists",
                    status: "exists"
                });
            } else {
                file.mv(filePath, function (err) {
                    if (err) {
                        logger.error(err);
                        console.error(err);
                        return res.status(500).json({
                            message: "Failed to persist file",
                            status: "failed"
                        });
                    }
                    res.json({message: "Uploaded file", status: "success"});
                });
            }
        });
    }
    function doImport(req, res) {
        let id = f.createId();
        let format = req.params.format;
        let apiPath = req.url.replace("/do/import", "");
        let feather = resolveName(apiPath);
        let query = qs.parse(req.params.query);
        const DIR = "./files/import/";
        const TEMPFILE = DIR + id + "." + format;

        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        logger.verbose("Import", format, feather);

        // The name of the input field
        let file = req.files.import;

        // Move the file to a install folder
        file.mv(TEMPFILE, function (err) {
            if (err) {
                return res.status(500).send(err);
            }

            datasource.import(
                feather,
                format,
                TEMPFILE,
                req.user.name,
                query.subscription,
                req.tenant
            ).then(
                respond.bind(res)
            ).catch(
                error.bind(res)
            );
        });
    }

    function doOpenPdf(req, res) {
        let filepath = "./files/downloads/";
        let file = filepath + req.params.file;

        fs.readFile(file, function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {"Content-Type": "application.pdf"});
            res.write(resp);
            res.end();
            fs.unlink(file, function () {
                return;
            });
        });
    }

    function doPrintPdfForm(req, res) {
        logger.verbose("Print PDF Form", req.body.form);

        datasource.printPdfForm(
            req.body.form,
            req.body.id || req.body.ids || req.body.data,
            req.body.filename,
            req.user.name,
            req.body.options,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    async function doSendMail(req, res) {
        let err = error.bind(res);
        let theSmtp;
        let resp;
        let payload;
        let found;
        let gSettings;
        let smtpType;

        try {
            gSettings = await datasource.request({
                method: "GET",
                name: "getSettings",
                data: {name: "globalSettings"},
                tenant: req.tenant,
                user: req.user.name
            }, true);

            smtpType = (
                (gSettings && gSettings.smtpType)
                ? gSettings.smtpType
                : "None"
            );

            if (smtpType === "SMTP") {
                theSmtp = {
                    auth: {
                        pass: gSettings.smtpPassword,
                        user: gSettings.smtpUser
                    },
                    host: gSettings.smtpHost,
                    port: gSettings.smtpPort,
                    secure: gSettings.smtpSecure,
                    type: gSettings.smtpType
                };
            } else if (smtpType === "Gmail") {
                resp = await req.sessionStore.pool.query((
                    "SELECT * FROM \"$session\" WHERE sid=$1; "
                ), [req.user.id]);
                found = resp.rows[0];
                if (!found) {
                    err("Google authorization required");
                    return;
                }

                theSmtp = {
                    type: "Gmail",
                    auth: {
                        refreshToken: found.sess.refreshToken,
                        user: found.sess.profile[jsn].email
                    }
                };
            } else {
                err("Invalid SMTP type '" + smtpType + "'");
                return;
            }

            payload = {
                method: "POST",
                name: "sendMail",
                user: req.user.name,
                data: {
                    message: {
                        from: req.body.message.from || theSmtp.auth.user,
                        to: req.body.message.to,
                        cc: req.body.message.cc,
                        bcc: req.body.message.bcc,
                        subject: req.body.message.subject,
                        text: req.body.message.text,
                        html: req.body.message.html
                    },
                    pdf: {
                        data: req.body.pdf.data,
                        form: req.body.pdf.form,
                        ids: req.body.pdf.id || req.body.pdf.ids,
                        filename: req.body.pdf.filename
                    },
                    smtp: theSmtp
                },
                tenant: req.tenant
            };

            logger.verbose("Send mail");
            logger.verbose(loggable(payload));
            resp = await datasource.request(payload, true);
            respond.bind(res)(resp);
        } catch (e) {
            // Force reauthentication in case of failure
            // Perhaps the user revoked it
            if (smtpType === "Gmail" && found) {
                await req.sessionStore.pool.query((
                    "DELETE FROM \"$session\" WHERE sid=$1; "
                ), [req.user.id]);
            }
            err(e);
        }
    }

    function doGetDownload(req, res) {
        let filePath = "./files/downloads/" + req.params.sourcename;

        res.download(
            filePath,
            req.params.targetname || req.params.sourcename,
            function (err) {
                if (err) {
                    logger.error(err);
                    console.error(err);
                    return;
                }
                fs.unlink(filePath, function () {
                    return; //console.log("deleted " + filePath);
                });
            }
        );
    }

    function doProcessFile(req, res) {
        let data = {encoded: null};
        if (!req.user) {
            res.status(401).json("Unauthorized session");
            return;
        }
        return new Promise(function (rev) {
            let url = req.body.url || req.url;
            pdf.fetchBytes(decodeURI(url)).then(function (bytes) {
                if (req.method === "POST" && req.body && (
                    req.body.annotation || req.body.watermark
                )) {
                    pdf.annotate(bytes, req.body).then(function (bytes2) {
                        // data.bytes = bytes;
                        data.encoded = Buffer.from(
                            bytes2,
                            "binary"
                        ).toString("base64");
                        rev();
                    });
                } else {
                    data.encoded = Buffer.from(
                        bytes,
                        "binary"
                    ).toString("base64");
                    rev();
                }
            });

        }).then(function () {
            res.writeHeader(200, "application/json");
            res.write(JSON.stringify(data));
            res.end();
        });
    }

    /*
        Uploaded content, unlike the bundled assets in `files` and
        `dirs`, is somebody's: it needs a signed-in session. A request
        that names no instance deserializes to the bare identity, and
        to `{}` when there is no session at all -- truthy either way,
        so the user has to be asked for by name rather than merely
        existing.
    */
    function doRequestFile(req, res) {
        if (!req.user || !req.user.name) {
            res.status(401).json("Unauthorized session");
            return;
        }
        return doGetFile(req, res);
    }

    function doGetFile(req, res) {
        let url = "." + decodeURI(req.url);
        let file = req.params.file || "";
        let suffix = (
            file
            ? file.slice(file.indexOf("."), file.length)
            : url.slice(url.lastIndexOf("."), url.length)
        ).toLowerCase();
        let mimetype;

        switch (suffix) {
        case ".pdf":
            mimetype = {"Content-Type": "application/pdf"};
            break;
        case ".mjs":
        case ".js":
            mimetype = {"Content-Type": "application/javascript"};
            break;
        case ".css":
            mimetype = {"Content-Type": "text/css"};
            break;
        case ".map":
        case ".json":
            mimetype = {"Content-Type": "application/json"};
            break;
        case ".jpeg":
        case ".jpg":
            mimetype = {"Content-Type": "image/jpeg"};
            break;
        case ".png":
            mimetype = {"Content-Type": "image/png"};
            break;
        case ".svg":
            mimetype = {"Content-Type": "image/svg+xml"};
            break;
        case ".ttf":
            mimetype = {"Content-Type": "application/x-font-ttf"};
            break;
        case ".otf":
            mimetype = {"Content-Type": "application/x-font-otf"};
            break;
        case ".woff":
            mimetype = {"Content-Type": "font/woff"};
            break;
        case ".woff2":
            mimetype = {"Content-Type": "font/woff2"};
            break;
        default:
            throw new Error("Unknown file type " + suffix);
        }

        // In debug mode the client is served as unbundled source that
        // changes with every pull. With no cache headers the browser
        // may keep running an old copy, so make it ask each time (a
        // revalidation, not a full download, once the file is unchanged).
        if (debug) {
            mimetype["Cache-Control"] = "no-cache";
        }

        fs.readFile(url + file, function (err, resp) {
            if (err) {
                console.log(err);
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, mimetype);
            res.write(resp);
            res.end();
        });
    }

    function doGetIndexFile(ignore, res) {
        let file = (
            debug
            ? "./index_debug.html"
            : "./index.html"
        );
        fs.readFile(file, function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, (
                debug
                ? {"Cache-Control": "no-cache", "Content-Type": "text/html"}
                : {"Content-Type": "text/html"}
            ));
            res.write(resp);
            res.end();
        });
    }

    /*
        The help window (ADR-003): one page, which asks for a topic and
        renders the module's Markdown itself. Served from the checkout
        like index.html, and behind the session like the rest of an
        instance.
    */
    function doGetHelpPage(ignore, res) {
        fs.readFile("./help.html", function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {"Content-Type": "text/html"});
            res.write(resp);
            res.end();
        });
    }

    // Which page answers for a form or a feather, and the customer's own
    function doGetHelpTopic(req, res) {
        let payload = {
            data: {
                feather: req.query.feather,
                form: req.query.form
            },
            method: "GET",
            name: "getHelpTopic",
            tenant: req.tenant,
            user: req.user.name
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    /*
        The REST API reference: one page that has Redoc render the
        instance's own OpenAPI document. Served like the help window.
    */
    function doGetApiPage(ignore, res) {
        fs.readFile("./api.html", function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {"Content-Type": "text/html"});
            res.write(resp);
            res.end();
        });
    }

    // Framework, module and infrastructure versions for About
    function doGetAbout(req, res) {
        doGetMethod("getAbout", req, res);
    }

    // The instance's OpenAPI document: core, its feathers, its modules
    function doGetOpenApi(req, res) {
        doGetMethod("getOpenApi", req, res);
    }

    /*
        A help file of the module version this database deployed. The
        service refuses a path that leaves the module's help folder.
    */
    function doGetHelpFile(req, res) {
        let payload = {
            data: {
                module: req.params.module,
                path: req.params[0]
            },
            method: "GET",
            name: "getHelpFile",
            tenant: req.tenant,
            user: req.user.name
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(function (resp) {
            res.type(resp.type);
            res.sendFile(resp.file);
        }).catch(error.bind(res));
    }

    /*
        "Forgot password": mail a link that signs the person in and
        sends them to the change-password page.

        What this used to trip on, for anyone whose profile was made at
        first sign-in (everyone made on the Users screen): such a
        profile has no contact, so the user account trigger refused the
        flag ("Contact is required"), the error went nowhere, and the
        request never answered; and with no contact there was no
        address to mail anyway. flagPasswordChange makes the contact
        from the identity's name and address when there is none. And a
        mail that could not go used to be answered "sent"; it is now
        answered as a failure, in words that give nothing away to
        someone who is not signed in.
    */
    async function identityInfo(req, username) {
        return await manager.run(async function (mclient) {
            let found = await manager.identity(mclient, username);

            return (
                found
                ? {email: found.email, fullName: found.full_name}
                : {}
            );
        });
    }

    async function flagPasswordChange(req, username, fallback) {
        let user = await datasource.deserializeUser(
            {tenant: req.tenant},
            username
        );
        let email = user.email;
        let known;
        let names;
        let rows;

        if (!email) {
            known = (
                typeof fallback === "function"
                ? await fallback()
                : fallback
            ) || {};
            email = known.email;

            if (!email) {
                return Promise.reject(new Error(
                    "There is no email address on file for " + username
                ));
            }

            // The trigger also wants the contact to carry the address
            names = String(known.fullName || "").trim().split(/\s+/);
            await datasource.changeUserInfo({
                by: (
                    req.user
                    ? req.user.name
                    : username
                ),
                email,
                firstName: names.slice(0, -1).join(" "),
                lastName: names[names.length - 1] || username,
                name: username,
                phone: ""
            }, req.tenant);
        }

        rows = await datasource.request({
            filter: {criteria: [{property: "name", value: username}]},
            method: "GET",
            name: "UserAccount",
            properties: ["id"],
            tenant: req.tenant,
            user: username
        }, true);

        await datasource.request({
            data: [{op: "replace", path: "/changePassword", value: true}],
            id: rows[0].id,
            method: "PATCH",
            name: "UserAccount",
            tenant: req.tenant,
            user: username
        }, true);

        return email;
    }

    /*
        Send the magic link and wait to learn whether it went. The
        strategy answers "sent" whatever happened (sendMagicLink keeps
        the failure on the request), and has no promise to wait on.
    */
    async function sendLink(req, body) {
        /*
            Its own body, so nothing the caller typed (a password, say)
            rides along in the signed link.
        */
        let linkReq = linkRequest(req, body);

        await new Promise(function (resolve) {
            magicLogin.send(linkReq, {
                end: resolve,
                json: resolve,
                send: resolve,
                status: function () {
                    return this;
                }
            });
        });

        if (linkReq.mailError) {
            return Promise.reject(linkReq.mailError);
        }
    }

    async function doResetPassword(req, res) {
        let body = req.body || {};
        let username = String(body.username || "");
        let destination;

        if (username === systemUser) {
            error.bind(res)(
                "Cannot reset password for the system user"
            );
            return;
        }

        try {
            destination = await flagPasswordChange(
                req,
                username,
                () => identityInfo(req, username)
            );
        } catch (err) {
            error.bind(res)(err);
            return;
        }

        try {
            await sendLink(req, {
                destination,
                username
            });
        } catch (err) {
            logger.error("Reset mail for " + username + ": " + err);
            error.bind(res)(new Error(
                "The email could not be sent. Please ask your " +
                "administrator."
            ));
            return;
        }

        res.json({success: true});
    }

    async function doNotice(req, res, next) {
        let signature;
        let hash;
        let valid = false;

        try {
            // Fail closed: with no secret or header configured there is
            // nothing to verify against, so nothing is accepted.
            if (webhookHeader && webhookSecret) {
                signature = req.header(webhookHeader);
                if (signature && req.rawBody !== undefined) {
                    hash = crypto.createHmac(
                        "SHA256",
                        webhookSecret
                    ).update(
                        req.rawBody
                    ).digest("base64");
                    let a = Buffer.from(hash);
                    let b = Buffer.from(String(signature));
                    valid = (
                        a.length === b.length &&
                        crypto.timingSafeEqual(a, b)
                    );
                }
            } else {
                logger.error(
                    "Webhook rejected: webhookHeader and webhookSecret " +
                    "must both be configured."
                );
            }

            if (valid) {
                await datasource.request({
                    data: {payload: req.body},
                    method: "POST",
                    name: "Notice",
                    tenant: req.tenant,
                    user: systemUser
                }, true);
                res.statusCode = 200;
                res.send("Success");
            } else {
                res.statusCode = 401;
                logger.error("Invalid webhook credentials");
                next("Invalid webhook credentials");
            }
        } catch (e) {
            res.statusCode = 500;
            logger.error(e);
            console.error(e);
            next(e);
        }
    }

    async function doSignIn(req, res) {
        let message;
        req.flash = function (ignore, msg) {
            logger.verbose(msg);
            message = msg;
        };

        async function next(err) {
            if (err) {
                res.status(res.statusCode).json(message);
                return;
            }

            /*
                A second factor when the installation demands one
                (config twoFactorAuth, everywhere) or when the signed-in
                user's organization does (organization
                isTwoFactorRequired, tenant plan C.2): the policy
                belongs to the organization, and two organizations on
                one installation may answer differently.
            */
            if (twoFactorAuth || req.user.isTwoFactorRequired) {
                let userEmail = "";
                let userPhone = "";

                if (req.user.email) {
                    userEmail = (
                        "********" +
                        req.user.email.slice(
                            req.user.email.length - 10
                        )
                    );
                }
                if (req.user.phone) {
                    userPhone = (
                        "***-***-" +
                        req.user.phone.slice(
                            req.user.phone.length - 4
                        )
                    );
                }

                let linkReq = linkRequest(req, {
                    confirmCode: String(
                        Math.floor(Math.random() * 90000) + 10000
                    ),
                    destination: req.user.email,
                    username: req.user.name
                });

                try {
                    magicLogin.send(linkReq, mailRes());
                    respond.bind(res)({
                        success: true,
                        confirmUrl: linkReq.magicHref,
                        email: userEmail,
                        phone: userPhone,
                        smsEnabled: false
                    });
                } catch (e) {
                    error.bind(res)(e);
                }
            } else {
                try {
                    req.user.mode = await modeOf(req.tenant);
                    await new Promise(function (resolve, reject) {
                        req.logIn(req.user, function (err) {
                            return (
                                err
                                ? reject(err)
                                : resolve()
                            );
                        });
                    });
                    req.session.mode = req.user.mode;
                    req.session.database = req.database;
                    req.session.save(function () {
                        res.json(req.user);
                    });
                } catch (e) {
                    error.bind(res)(e);
                }
            }
        }
        /*
            A missing local profile is not an answer: the identity and
            its grant live in the manager, and somebody granted an
            instance they have never opened has no profile in it yet.
            Authentication decides, and the profile is made once the
            grant is proven (tenant plan B.7, server/database.js). A
            wrong username gets the same generic refusal from there.
        */
        authenticateLocal(req, res, next);
    }

    function doSignOut(req, res, next) {
        // Notify all instances on same session
        Object.keys(eventSessions).forEach(function (key) {
            if (eventSessions[key].sessionID === req.sessionID) {
                eventSessions[key]({
                    payload: {
                        subscription: {
                            subscriptionId: "",
                            change: "signedOut",
                            data: {}
                        }
                    }
                });
            }
        });
        req.logout(function () {
            req.session.destroy();
            if (res) {
                res.status(200).send();
            }
            if (next) {
                next();
            }
        });
    }

    /*
        The picker, at a URL that names no database (tenant plan G.1).

        Sign-in here is against the manager alone: it proves the
        identity and nothing more, and the instances it may reach come
        from its grants. Choosing one is what proves access to that
        instance, in deserializeUser above.

        A second factor is an instance's to ask for, since the code is
        sent by the instance's own mail service: an organization that
        requires one can pick here but signs in at the instance.
    */
    function doGetPickerFile(ignore, res) {
        fs.readFile("./picker.html", function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {
                "Cache-Control": "no-cache",
                "Content-Type": "text/html"
            });
            res.write(resp);
            res.end();
        });
    }

    async function doPickerSignIn(req, res) {
        let identity;

        try {
            identity = await datasource.authenticateIdentityOnly(
                req.body.username,
                req.body.password,
                req.body.organization
            );
        } catch (err) {
            logger.error("/sign-in: " + err);
            res.status(401).json({message: signInMessage(err)});
            return;
        }

        startIdentitySession(req, identity, function (err) {
            if (err) {
                error.bind(res)(err);
                return;
            }
            res.json(identity);
        });
    }

    /*
        Put a signed-in identity on the session (tenant plan G.1).

        An organization that requires a second factor gets no passport
        session from a password sign-in here: the factor is sent by an
        instance's own mail service, which the manager has none of. The
        identity still rides on the session, so the picker can list the
        instances; without a passport user, opening one lands on that
        instance's own sign-in, which asks for the factor. Nothing is
        admitted on a half-proved identity.

        A sign-in through an identity provider is different: the
        provider applied its own policy, multi-factor included, before
        it vouched for anyone (ADR-001 C.3). `factorDone` says so.
    */
    function startIdentitySession(req, identity, done) {
        function answer(err) {
            if (err) {
                done(err);
                return;
            }
            req.session.identity = identity;
            delete req.session.database;
            req.session.save(() => done());
        }

        if (identity.isTwoFactorRequired && !identity.factorDone) {
            answer();
            return;
        }

        /*
            Passport holds the user name, as it does for an instance
            sign-in, so every request afterwards resolves the same way.
            The identity rides on the session beside it: it is what the
            picker knows before an instance is chosen.
        */
        req.login({name: identity.username}, answer);
    }

    /*
        Single sign-on (ADR-001 C.3). The organization is named first,
        because its provider is what decides where the browser goes;
        the protocol itself is server/services/oidc.js, and who the
        subject turns out to be is server/services/federation.js.
    */
    function ssoRedirectUri(req) {
        /*
            Configured rather than derived where it can be: the
            provider matches the redirect against what was registered
            with it, and a host header is the client's to set.
        */
        return (
            ssoCallbackUrl ||
            req.protocol + "://" + req.get("host") + "/auth/sso/callback"
        );
    }

    async function withProvider(organizationName) {
        return await platform.run(async function (mclient) {
            let resp = await mclient.query(
                (
                    "SELECT _pk, id, name FROM organization " +
                    "WHERE lower(name) = lower($1) " +
                    "  AND is_active AND NOT is_deleted"
                ),
                [String(organizationName || "").trim()]
            );

            if (!resp.rows.length) {
                return {};
            }

            return {
                organization: resp.rows[0],
                provider: await federation.providerFor(
                    mclient,
                    resp.rows[0]._pk
                )
            };
        });
    }

    async function doSsoStart(req, res) {
        try {
            let found = await withProvider((req.body || {}).organization);

            if (!found.provider) {
                /*
                    The same answer whether the organization is not
                    there or has no provider: which organizations exist
                    is not a question an unauthenticated caller gets
                    answered (G.1).
                */
                res.status(404).json({
                    message: (
                        "That organization does not sign in through an " +
                        "identity provider here."
                    )
                });
                return;
            }

            let begun = await oidc.begin(
                found.provider,
                ssoRedirectUri(req)
            );

            req.session.sso = {
                nonce: begun.nonce,
                organization: found.organization.id,
                state: begun.state,
                verifier: begun.verifier
            };
            req.session.save(function () {
                res.json({url: begun.url});
            });
        } catch (err) {
            logger.error("/auth/sso/start: " + (err.message || err));
            error.bind(res)(err);
        }
    }

    async function doSsoCallback(req, res) {
        let pending = (
            req.session
            ? req.session.sso
            : undefined
        );

        function refuse(message) {
            res.redirect("/#denied=" + encodeURIComponent(message));
        }

        if (!pending) {
            refuse("There is no sign-in waiting. Start again.");
            return;
        }
        delete req.session.sso;

        try {
            let identity = await platform.run(async function (mclient) {
                let organization = await manager.organizationById(
                    mclient,
                    pending.organization
                );

                if (!organization) {
                    throw new Error("That organization is gone");
                }

                let provider = await federation.providerFor(
                    mclient,
                    organization._pk
                );

                if (!provider) {
                    throw new Error(
                        "That organization has no identity provider"
                    );
                }

                /*
                    The callback as the provider sent it, rebuilt on
                    the redirect URI that was registered with them
                    rather than on the host header. A callback with no
                    query string at all is not one of theirs.
                */
                let query = String(req.originalUrl || "").split("?")[1];

                if (!query) {
                    throw new Error("That sign-in did not come back");
                }

                let said = await oidc.finish(
                    provider,
                    ssoRedirectUri(req) + "?" + query,
                    pending
                );
                let who = await federation.resolve(mclient, {
                    claims: said.claims,
                    organizationPk: organization._pk,
                    provider,
                    subject: said.subject
                });
                let full = await manager.organization(
                    mclient,
                    organization._pk
                );

                return {
                    email: who.identity.email || "",
                    /*
                        The provider applied its own policy before it
                        vouched for them, so the factor is done.
                    */
                    factorDone: true,
                    fullName: (
                        who.identity.full_name || who.identity.username
                    ),
                    isOrgAdmin: await manager.isOrgAdminOf(
                        mclient,
                        who.identity._pk,
                        organization._pk
                    ),
                    isPlatformAdmin: (
                        who.identity.is_platform_admin === true
                    ),
                    isTwoFactorRequired: (
                        full.is_two_factor_required === true
                    ),
                    organization: {
                        id: organization.id,
                        name: organization.name
                    },
                    username: who.identity.username
                };
            });

            startIdentitySession(req, identity, function (err) {
                if (err) {
                    refuse(err.message || String(err));
                    return;
                }
                res.redirect("/");
            });
        } catch (err) {
            logger.error("/auth/sso/callback: " + (err.message || err));
            refuse(err.message || String(err));
        }
    }

    async function doMyInstances(req, res) {
        let identity = (
            req.session
            ? req.session.identity
            : undefined
        );

        if (!identity) {
            res.status(401).json("Unauthorized session");
            return;
        }

        try {
            let instances = await platform.run(
                (mclient) => platform.instancesFor(
                    mclient,
                    identity.username
                )
            );

            res.json({
                identity: {
                    fullName: identity.fullName,
                    isOrgAdmin: identity.isOrgAdmin === true,
                    isPlatformAdmin: identity.isPlatformAdmin === true,
                    isTwoFactorRequired: (
                        identity.isTwoFactorRequired === true
                    ),
                    organization: identity.organization,
                    username: identity.username
                },
                instances
            });
        } catch (err) {
            error.bind(res)(err);
        }
    }

    /*
        The platform console (tenant plan G.2, G.3): organizations and
        every instance on the installation, for a platform
        administrator with no instance in play. Who may do what is
        decided in server/services/platform.js, which reads the
        identity rather than believing the session about it.
    */
    function doPlatform(fn) {
        return async function (req, res) {
            let identity = (
                req.session
                ? req.session.identity
                : undefined
            );

            if (!identity) {
                res.status(401).json("Unauthorized session");
                return;
            }

            try {
                respond.bind(res)(await platform.run(
                    async function (mclient) {
                        let actor = await platform.actor(mclient, identity);

                        return await fn(mclient, {
                            actor,
                            by: identity.username,
                            data: req.body || {},
                            identity
                        });
                    }
                ));
            } catch (e) {
                error.bind(res)(e);
            }
        };
    }

    /*
        A package arrives as a file rather than as JSON, so this stages
        it and hands the path to the same service the rest of the
        console's acts go through -- which is where the platform-
        administrator check and the audit live. The staged copy goes
        whatever happens: it is somebody's upload sitting in a temp
        directory.
    */
    async function doPackageUpload(req, res) {
        let staged;

        try {
            if (!req.user && !(req.session || {}).identity) {
                res.status(401).json("Unauthorized session");
                return;
            }

            let file = (req.files || {}).package;

            if (!file) {
                res.status(400).json("No package was uploaded");
                return;
            }

            staged = file.tempFilePath || path.join(
                os.tmpdir(),
                "fb-upload-" + Date.now()
            );

            if (!file.tempFilePath) {
                fs.writeFileSync(staged, file.data);
            }

            let payload = adminPayload(req);

            payload.data = {
                force: String(req.query.force) === "true",
                source: staged
            };

            respond.bind(res)(await admin.installPackage(payload));
        } catch (e) {
            error.bind(res)(e);
        } finally {
            if (staged) {
                try {
                    fs.rmSync(staged, {force: true});
                } catch (ignore) {
                    // the upload directory is the temp directory's
                }
            }
        }
    }

    function platformData(obj) {
        return Object.assign({}, obj.data, {by: obj.by});
    }

    // Session lists and disconnects are an administrator's tool
    function requireSuper(req, res) {
        if (req.user && req.user.isSuper) {
            return true;
        }
        res.status(403).json("Forbidden");
        return false;
    }

    /*
        Administration of the manager database (ADR-001, tenant plan
        D.4). The manager is not routable, so these run inside the
        instance the administrator is signed in to and act on that
        instance's organization. Who may do what is decided in
        server/services/admin.js, which answers 401 when the caller
        holds no tier at all.
    */
    function adminPayload(req) {
        return {
            data: req.body || {},
            isSuper: Boolean(req.user && req.user.isSuper),
            limit: Number(req.query.limit) || undefined,
            /*
                What this process is serving, so the instances screen
                can tell a registered instance from one that is
                actually up (tenant plan D.3's registry accessor).
            */
            /*
                The organization to act on, for a platform
                administrator's break-glass reach (tenant plan A.4).
                Reads carry it in the query string, writes in the body;
                admin.js refuses it for everyone else.
            */
            organization: (
                req.query.organization ||
                (req.body || {}).organization ||
                undefined
            ),
            /*
                Who the session says is calling, for a call that names
                no instance (the platform console, tenant plan G.2).
                admin.js reads the authority from the identity itself;
                this only says which identity to read.
            */
            identity: (
                req.session
                ? req.session.identity
                : undefined
            ),
            registry: datasource.registeredTenants(),
            tenant: req.tenant,
            /*
                Where a person signs in, and the means of inviting
                one: the 2.2.0 way of making a user, a mail with a
                link that signs them in and makes them choose their
                own password. Needs the request (its host and its
                database name are in the link), so admin.js is handed
                a function rather than the request.
            */
            invite: (username, destination, fullName) => inviteByMail(
                req,
                username,
                destination,
                fullName
            ),
            signInUrl: (
                req.database
                ? req.protocol + "://" + req.get("host") + "/" +
                        req.database + "/"
                : undefined
            ),
            /*
                No session is a 401 rather than the type error reading
                a name off nothing used to raise: these routes answer
                where no database is named, so an unauthenticated
                caller reaches them and has to be told, not handed a
                stack trace.
            */
            user: (req.user || {}).name
        };
    }

    /*
        Mail a new person a link that signs them in and makes them set
        their own password, as 2.2.0 did (John, 2026-10-20). The
        profile is made now, with the flag that sends them to the
        change-password page on arrival, because a link opened later
        finds it already there; it is the same flag a password reset
        sets (doResetPassword). Rejects with the reason when the mail
        could not go, which the strategy itself would hide.
    */
    async function inviteByMail(req, username, destination, fullName) {
        /*
            The profile is made now (the person has a grant), with the
            contact the trigger insists on, built from what the
            administrator typed.
        */
        await flagPasswordChange(req, username, {
            email: destination,
            fullName
        });

        await sendLink(req, {
            destination,
            newAccount: true,
            username
        });
    }

    function doAdmin(method) {
        return async function (req, res) {
            try {
                respond.bind(res)(await admin[method](adminPayload(req)));
            } catch (e) {
                error.bind(res)(e);
            }
        };
    }

    /*
        An instance write goes straight to the manager's registry
        table, which the Tenant feather's own change events do not
        cover, so the registry is read again here. Without it a
        newly registered instance would not be served until the next
        restart.
    */
    /*
        Demo instances run out (tenant plan D.4): is_demo with an
        expiration in the past stops accepting sign-ins. Checked when
        the registry loads and every hour after, so an expired demo
        closes without anyone pressing anything; the audit trail says
        when each one went.
    */
    async function sweepDemos() {
        try {
            let closed = await admin.sweepDemos();

            if (closed.length) {
                logger.info(
                    "Expired demo instance(s) closed: " +
                    closed.join(", ")
                );
            }
        } catch (err) {
            logger.error(
                "Could not sweep expired demos: " + (err.message || err)
            );
        }

        /*
            And the ones that ran out long enough ago that nobody is
            coming back for them (tenant plan D.4). Separate from the
            close above: a failure to drop must not stop instances
            being closed, which is the part that matters for sign-in.
        */
        try {
            let dropped = await admin.sweepDemoDrops();

            if (dropped.length) {
                logger.warn(
                    "Expired demo instance(s) dropped: " +
                    dropped.join(", ")
                );
            }
        } catch (err) {
            logger.error(
                "Could not drop expired demos: " + (err.message || err)
            );
        }
    }

    function doAdminInstance(method) {
        return async function (req, res) {
            try {
                if (!req.user && !(req.session || {}).identity) {
                    res.status(401).json("Unauthorized session");
                    return;
                }

                let resp = await admin[method](adminPayload(req));

                await refreshTenants();
                respond.bind(res)(resp);
            } catch (e) {
                error.bind(res)(e);
            }
        };
    }

    /*
        A GET that still needs a caller-named instance and process id
        (the Upgrade/Deploy progress poll): nothing here writes, so
        there is no registry to refresh, but the ids ride in the query
        string rather than a body `adminPayload` would otherwise find
        empty.
    */
    function doAdminRead(method) {
        return async function (req, res) {
            try {
                if (!req.user && !(req.session || {}).identity) {
                    res.status(401).json("Unauthorized session");
                    return;
                }

                let payload = adminPayload(req);

                payload.data = req.query;
                respond.bind(res)(await admin[method](payload));
            } catch (e) {
                error.bind(res)(e);
            }
        };
    }

    async function doGetSessions(req, res) {
        if (!requireSuper(req, res)) {
            return;
        }

        let sql = (
            "SELECT * FROM \"$session\" " +
            "WHERE sess->>'database'=$1 " +
            " AND expire > now() " +
            " AND sess->>'passport' IS NOT NULL " +
            "ORDER BY expire;"
        );
        let resp = await req.sessionStore.pool.query(sql, [req.database]);
        resp = resp.rows.map(function (row) {
            return {
                id: row.sid,
                user: row.sess.passport.user,
                expires: row.expire
            };
        });
        respond.bind(res)(resp);
    }

    async function doDisconnectSession(req, res) {
        if (!requireSuper(req, res)) {
            return;
        }

        // Only this database's sessions, never another tenant's
        let sql = (
            "DELETE FROM \"$session\" WHERE sid=$1 AND sess->>'database'=$2;"
        );

        // Notify all instances on same session
        Object.keys(eventSessions).forEach(function (key) {
            if (eventSessions[key].sessionID === req.params.id) {
                eventSessions[key]({
                    payload: {
                        subscription: {
                            subscriptionId: "",
                            change: "signedOut",
                            data: {}
                        }
                    }
                });
            }
        });

        await req.sessionStore.pool.query(sql, [req.params.id, req.database]);

        respond.bind(res)(true);
    }

    function doGetProfile(req, res) {
        let payload = {
            method: "GET",
            name: "getProfile",
            user: req.user.name,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doPutProfile(req, res) {
        let payload = {
            method: "PUT",
            name: "saveProfile",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doPatchProfile(req, res) {
        let payload = {
            method: "PATCH",
            name: "patchProfile",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doIsAuthorized(req, res) {
        let payload = {
            method: "GET",
            name: "isAuthorized",
            user: req.user.name,
            data: {
                user: req.user.name,
                action: req.query.action
            },
            tenant: req.tenant
        };

        if (req.query.id) {
            payload.data.id = req.query.id;
        } else if (req.query.feather) {
            payload.data.feather = req.query.feather;
        }

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetObjectAuthorizations(req, res) {
        let payload = {
            method: "GET",
            name: "getAuthorizations",
            user: req.user.name,
            data: {
                id: req.body.filter.criteria[0].value
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSaveAuthorization(req, res) {
        let payload = {
            method: "POST",
            name: "saveAuthorization",
            user: req.user.name,
            data: {
                user: req.user.name,
                id: req.body.id,
                role: req.body.role,
                actions: req.body.actions
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doStopProcess(req, res) {
        let payload = {
            method: "POST",
            name: "stopProcess",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doWorkbookIsAuthorized(req, res) {
        let payload = {
            method: "GET",
            name: "workbookIsAuthorized",
            user: req.user.name,
            data: {
                name: req.params.name,
                user: req.user.name,
                action: req.query.action
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSettingIsAuthorized(req, res) {
        let payload = {
            method: "GET",
            name: "settingIsAuthorized",
            user: req.user.name,
            data: {
                name: req.params.name,
                user: req.user.name
            },
            tenant: req.tenant
        };

        logger.verbose(loggable(payload));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    async function doChangeRolePassword(req, res) {
        let payload = {
            method: "POST",
            name: "changeRolePassword",
            user: req.user.name,
            data: {
                name: req.user.name,
                password: req.body.password
            },
            tenant: req.tenant
        };

        logger.verbose("Change role password for " + req.user.name);
        try {
            await datasource.request(payload);
            await doSignOut(req, res);
        } catch (e) {
            error.bind(res)(e);
        }
    }

    function doChangePassword(req, res) {
        let payload = {
            method: "POST",
            name: "changeOwnPassword",
            user: req.user.name,
            data: {
                name: req.user.name,
                oldPassword: req.body.oldPassword,
                newPassword: req.body.newPassword,
                request: req
            },
            tenant: req.tenant
        };

        logger.verbose("Change password for " + req.user.name);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doChangeUserInfo(req, res) {
        let payload = {
            name: req.user.name,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            phone: req.body.phone
        };

        logger.verbose("Change User Info", JSON.stringify(payload, null, 2));
        datasource.changeUserInfo(
            payload,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    async function doConnect(req, res) {
        let key = f.createId();
        let user = req.user;
        let who = {};
        eventKeys[key] = {
            sessionID: req.sessionID,
            tenant: req.tenant
        };

        /*
            The organization and administration tier go out with the
            session user, for the signed-in label in the ribbon. Best
            effort on purpose: nothing in the application depends on
            them, so a manager this process cannot read costs the
            label its tooltip and no more. Read fresh rather than kept
            on the session, which says who someone is and never what
            they may do.

            The client connects before anyone has signed in -- that is
            how it learns whether a session is open -- so there is
            often no user here at all, and the answer is then the same
            nothing it always was.
        */
        if (user) {
            try {
                who = await admin.whoAmI({
                    tenant: req.tenant,
                    user: user.name
                });
            } catch (err) {
                logger.verbose(
                    "Could not read who " + user.name +
                    " is signed in as: " + (err.message || err)
                );
            }
        }

        respond.bind(res)({
            data: {
                authorized: (
                    user
                    ? Object.assign({}, user, who)
                    : user
                ),
                eventKey: key
            }
        });
    }

    // Listen for changes to feathers, update and broadcast to all
    function subscribeToFeathers() {
        return new Promise(function (resolve, reject) {
            let sid = f.createId();
            let eKey = f.createId();
            let payload = {
                name: "Feather",
                method: "GET",
                user: systemUser,
                subscription: {
                    id: sid,
                    eventKey: eKey
                },
                tenant: false
            };

            function changeCallback(resp) {
                // Update all clients
                Object.keys(eventSessions).forEach(function (key) {
                    if (eventSessions[key].sessionID) {
                        eventSessions[key]({
                            payload: {
                                subscription: {
                                    change: "feather",
                                    deleted: false
                                },
                                data: resp
                            }
                        });
                    }
                });
            }

            // Response function in case a feather changes
            eventSessions[eKey] = function (message) {
                let name;

                if (
                    message.payload.subscription.change === "create" ||
                    message.payload.subscription.change === "update"
                ) {
                    name = message.payload.data.name;

                    // Update server with route changes
                    registerDataRoute(name);

                    // Get feather to update client
                    datasource.request({
                        method: "GET",
                        name: "getFeather",
                        user: systemUser,
                        data: {
                            name: message.payload.data.name
                        },
                        tenant: false
                    }, true).then(changeCallback).catch(reject);
                } else if (message.payload.subscription.change === "delete") {
                     // Update all clients
                    Object.keys(eventSessions).forEach(function (key) {
                        if (eventSessions[key].sessionID) {
                            eventSessions[key]({
                                payload: {
                                    subscription: {
                                        change: "feather",
                                        deleted: true
                                    },
                                    data: message.payload.data
                                }
                            });
                        }
                    });
                }

                // Update subscription
                delete payload.client;
                datasource.request(payload, true);
            };

            datasource.request(payload, true).then(resolve).catch(reject);
        });
    }

    // Listen for changes to catalog, refresh if changed
    async function subscribeToCatalog() {
        let eKey = f.createId();

        // Refresh the local copy of the catalog if it changes
        eventSessions[eKey] = function () {
            datasource.getCatalog().catch(console.log);
        };
        eventSessions[eKey].fetch = false;

        await datasource.request({
            name: "getSettings",
            method: "GET",
            user: systemUser,
            subscription: {id: f.createId(), eventKey: eKey},
            data: {name: "catalog"},
            tenant: false
        }, true);
    }

    // HANDLE PUSH NOTIFICATION -------------------------------
    // Receiver callback for all events, sends only to applicable instance.
    let pending = [];
    let isFetching = false;

    function processFetch() {
        if (!isFetching && pending.length) {
            isFetching = true;
            let job = pending[0];
            let jobId = job.payload.id;
            let jobName = job.payload.name;
            datasource.request(job.payload, true).then(function (resp) {
                // Group together any other responses for the same
                // record to reduce duplicate queries
                let jobs = pending.filter(
                    (p) => (
                        p.payload.id === jobId &&
                        p.payload.name === jobName
                    )
                );
                jobs.forEach(function (thejob) {
                    let idx = pending.indexOf(thejob);
                    pending.splice(idx, 1);
                    thejob.callback(resp);
                });
                isFetching = false;
                processFetch();
            }).catch(function (e) {
                logger.error(e);
                console.error(e);
            });
        }
    }

    function receiver(message, pTenant) {
        let eventKey = message.payload.subscription.eventkey;
        let change = message.payload.subscription.change;
        let fn = eventSessions[eventKey];

        function cb(resp) {
            if (resp) {
                message.payload.data = resp;
            } else if (
                change === "update" ||
                change === "create"
            ) {
                return; // Record deleted
            }

            fn(message);
        }

        if (fn) {
            if (fn.fetch === false) {
                cb();
                return;
            }

            // If record change, fetch new record
            if (change === "create" || change === "update") {
                pending.push({
                    payload: {
                        name: message.payload.data.table.toCamelCase(true),
                        method: "GET",
                        user: systemUser,
                        id: message.payload.data.id,
                        tenant: pTenant
                    },
                    callback: cb
                });
                processFetch();
                return;
            }

            cb();
        }
    }

    function handleEvents() {
        // Instantiate event key for web socket connection
        wss.on("connection", function connection(ws, req) {
            let eKey;

            ws.on("message", function incoming(key) {
                let sessionID;

                eKey = key;

                if (eventKeys[key]) {
                    sessionID = eventKeys[key].sessionID;
                } else {
                    ws.send("Invalid event key " + key);
                    return;
                }

                eventSessions[eKey] = function (message) {
                    let data = JSON.stringify({
                        message: message.payload
                    });
                    ws.send(data);
                };
                eventSessions[eKey].sessionID = sessionID;

                logger.verbose("Listening for events " + eKey);
            });

            ws.on("close", function close() {
                let db = req.url.replaceAll("/", "");
                db = db.toCamelCase().toSnakeCase();
                let tenant = tenants.find((t) => t.pgDatabase === db);
                delete eventSessions[eKey];
                datasource.unsubscribe(eKey, "instance", tenant);
                datasource.unlock({
                    eventKey: eKey
                });

                logger.info("Closed instance " + eKey);
            });
        });
    }

    /*
        Read the registry again and listen to whatever it now holds.
        Both the Tenant change subscription and the instance
        administration routes come through here.
    */
    /*
        One at a time. Registering an instance reads the registry twice
        at once -- in the route that registered it and in the change
        event that registering raised -- and two overlapping reads both
        find the new instance missing: both add it, and both listen to
        it. The second listener asks for the advisory lock this process
        already holds for the first and waits for itself for good, which
        is also the request that was refreshing.
    */
    const refreshOneAtATime = serialize(async function () {
        tenants = await datasource.loadTenants();
        await listenToTenants();
    });

    function refreshTenants() {
        return refreshOneAtATime();
    }

    async function listenToTenants() {
        let tenant;
        let n = 0;

        while (n < tenants.length) {
            tenant = tenants[n];
            if (!tenant.listenerConn) {
                try {
                    await datasource.listen(tenant, receiver);
                } catch (err) {
                    logger.error(err.message);
                    console.error(err.message);
                }
            }
            n += 1;
        }
    }

    // Listen for changes to tenants, refresh if changed
    async function subscribeToTenants() {
        let sid = f.createId();
        let eKey = f.createId();

        // Reregister routes if something changes
        eventSessions[eKey] = refreshTenants;

        await datasource.request({
            name: "Tenant",
            method: "GET",
            user: systemUser,
            subscription: {id: sid, eventKey: eKey},
            tenant: false
        }, true);
    }

    // Define exactly which directories and files are to be served
    const dirs = [
        "/client",
        "/client/components",
        "/client/models",
        "/common",
        "/fonts",
        "/node_modules/codemirror/addon/lint",
        "/node_modules/codemirror/lib",
        "/node_modules/codemirror/mode/javascript",
        "/node_modules/codemirror/mode/css",
        "/node_modules/typeface-raleway/files",
        "/node_modules/print-js/dist",
        "/node_modules/tinymce",
        "/node_modules/tinymce/models/dom",
        "/node_modules/tinymce/icons/default",
        "/node_modules/tinymce/skins/ui/oxide",
        "/node_modules/tinymce/skins/ui/oxide/fonts",
        "/node_modules/tinymce/skins/ui/oxide-dark",
        "/node_modules/tinymce/skins/ui/oxide-dark/fonts",
        "/node_modules/tinymce/skins/content/default",
        "/node_modules/tinymce/skins/content/dark",
        "/node_modules/tinymce/skins/content/document",
        "/node_modules/tinymce/skins/content/writer",
        "/node_modules/tinymce/themes/silver",
        "/node_modules/tinymce/themes/mobile",
        "/media",
        "/media/icons/iconpark"
    ];

    const files = [
        "/index.html",
        "/media/featherbone.png",
        "/files/logo.jpg",
        "/css/featherbone.css",
        "/css/print.css",
        "/node_modules/big.js/big.mjs",
        "/node_modules/event-source-polyfill/src/eventsource.js",
        "/node_modules/fast-json-patch/dist/fast-json-patch.js",
        "/node_modules/fast-json-patch/dist/fast-json-patch.min.js",
        "/node_modules/marked/lib/marked.umd.js",
        "/node_modules/mithril/mithril.js",
        "/node_modules/mithril/mithril.min.js",
        "/node_modules/redoc/bundles/redoc.standalone.js",
        "/node_modules/qs/dist/qs.js",
        "/node_modules/purecss/build/pure-min.css",
        "/node_modules/purecss/build/grids-responsive-min.css",
        "/node_modules/dialog-polyfill/dialog-polyfill.css",
        "/node_modules/codemirror/theme/neat.css",
        "/node_modules/typeface-raleway/index.css",
        "/node_modules/gantt/dist/gantt.min.js"
    ];

    /*
        Paths that belong to the picker rather than to any instance
        (tenant plan G.1). Every other path names a database in its
        first element, so these have to be known by name or the first
        element of "/my/instances" would be read as a database.
    */
    const platformPaths = [
        "/auth/sso",
        "/files/",
        "/my/",
        "/platform",
        "/sign-in",
        "/sign-out"
    ];

    function isPlatformPath(url) {
        let path = String(url || "").split("?")[0];

        if (path === "/" || path === "") {
            return true;
        }
        return platformPaths.some(function (p) {
            return (
                p.endsWith("/")
                ? path.startsWith(p)
                : path === p || path.startsWith(p + "/")
            );
        });
    }

    /*
        The user of a session that has not chosen an instance: the
        identity itself, with none of the local profile an instance
        would add (tenant plan G.1).
    */
    function identityUser(req, name) {
        let identity = (
            req.session
            ? req.session.identity
            : undefined
        );

        if (!identity) {
            /*
                A session signed in to an instance rather than at the
                picker carries no identity record, but passport still
                holds the name (see startIdentitySession). Keeping it
                is what lets a path outside any instance -- an uploaded
                file, say -- tell that someone is signed in at all.
            */
            return (
                name
                ? {name}
                : {}
            );
        }

        return {
            email: identity.email,
            fullName: identity.fullName,
            /*
                Whether they administer an organization at all. Which
                ones is the admin screens' own question, asked of the
                organization in front of them, because one person may
                administer several now.
            */
            isOrgAdmin: identity.isOrgAdmin === true,
            isPlatformAdmin: identity.isPlatformAdmin === true,
            isSuper: false,
            name: identity.username || name,
            organization: identity.organization
        };
    }

    /*
        Let an identity session into the instance it is asking for,
        once the manager says the grant is still live (tenant plan
        G.1). Admission is recorded on the session, so the manager is
        asked when an instance is entered rather than on every request
        inside it.
    */
    async function admitToInstance(req) {
        let identity = req.session.identity;

        if (req.session.database === req.database) {
            return {ok: true};
        }
        if (!req.tenant) {
            return {ok: false, reason: "Not a registered instance"};
        }

        return await platform.run(async function (mclient) {
            let entry = await platform.mayEnter(
                mclient,
                identity.username,
                req.tenant.id,
                identity.isPlatformAdmin === true
            );

            if (entry.ok) {
                req.session.database = req.database;
            }
            return entry;
        });
    }

    async function deserializeUser(req, name, done) {
        try {
            if (files.indexOf(req.url) !== -1) {
                done(null, {}); // Don't care about user on files
                return;
            }

            let ldir = req.url.slice(0, req.url.lastIndexOf("/"));
            if (dirs.indexOf(ldir) !== -1) {
                done(null, {}); // Don't care about user on files
                return;
            }

            if (!req.tenant && isPlatformPath(req.url)) {
                // The picker's own paths name no instance
                req.database = undefined;
            } else if (!req.tenant) {
                let db = req.url.slice(1);
                if (db.indexOf("/") !== -1) {
                    db = db.slice(0, db.indexOf("/"));
                }
                if (db === "oauth2") {
                    if (req.session && req.session.database) {
                        db = req.session.database;
                    } else {
                        return Promise.reject("Invalid session for oauth2");
                    }
                }
                db = db.toCamelCase().toSnakeCase();
                req.database = db;
                req.tenant = tenants.find((t) => t.pgDatabase === db);
                if (req.tenant && !req.tenant.baseUrl) {
                    req.tenant.baseUrl = (
                        req.protocol + "://" + req.get("host") + "/" +
                        req.database
                    );
                }
            }

            /*
                A request that names no database is the picker (tenant
                plan G.1). There is no instance to resolve a profile
                in, so the identity the session was signed in with is
                the user.
            */
            if (!req.database) {
                done(null, identityUser(req, name));
                return;
            }

            /*
                A session made at the picker proves itself against each
                instance it enters. Sign-in checked the grant once, for
                one instance; one sign-in now reaches several, so the
                grant is read again at the door. A refusal is not an
                error: the session stands and the picker says why.
            */
            if (req.session && req.session.identity) {
                let entry = await admitToInstance(req);

                if (!entry.ok) {
                    let user = identityUser(req, name);

                    user.enterDenied = entry.reason;
                    done(null, user);
                    return;
                }
            }

            let user = await datasource.deserializeUser(req, name);
            if (user) {
                user.splashUrl = splashUrl;
                user.splashTitle = splashTitle;
            }
            done(null, user);
        } catch (e) {
            req.isAuthenticated = false;
            req.sessionError = e;
            done(e, {});
        }
    }

    /*
        What an instance in maintenance still answers: its own pages
        and sign-in, so a platform administrator can get to the
        Instances screen, and the administration routes that screen
        calls -- including the one that ends the maintenance.
    */
    const MAINTENANCE_PATHS = [
        "/admin/",
        "/sign-in",
        "/sign-out",
        "/connect",
        "/webauthn/",
        "/auth/",
        "/reset-password",
        "/modules",
        "/settings",
        "/do/getSettings"
    ];

    function maintenanceOk(req) {
        let rest = req.path.slice(1);

        rest = rest.slice(rest.indexOf("/"));
        if (rest === "" || rest === "/") {
            return true;
        }
        return MAINTENANCE_PATHS.some((p) => rest.startsWith(p));
    }

    async function start() {
        // Resolve database
        dbRouter.param("db", function (req, res, next, id) {
            id = id.toCamelCase().toSnakeCase();
            /*
                The manager is in `tenants` so requests that name no
                instance have a connection to reach, but it is not an
                instance and is never served as one: it holds the
                registry, the identities and the sessions, not an
                application (tenant plan section 9).
            */
            let tenant = tenants.find(
                (t) => id === t.pgDatabase && t.id !== "-1"
            );
            let msg = (
                "Database " + id +
                " is not a registered tenant"
            );
            if (tenant) {
                req.database = id;
                req.tenant = tenant;
                /*
                    An instance in maintenance is having its schema
                    changed, so it answers nothing but the few things
                    needed to get it back (ADR-002 question 7): the
                    sign-in pages and the administration routes, which
                    is where a platform administrator clears the state.
                    Before, there was no state at all and a half-built
                    instance answered as if it were well.
                */
                if (tenant.isMaintenance === true && !maintenanceOk(req)) {
                    res.status(503).json({
                        message: (
                            "Instance " + tenant.name +
                            " is down for maintenance"
                        )
                    });
                    return;
                }
                next();
                return;
            }
            res.sendStatus(404);
            logger.error(msg);
            console.error(msg);
        });

        // For webhook notifications
        function rawBodySaver(req, ignore, buf, encoding) {
            if (buf && buf.length) {
                req.rawBody = buf.toString(encoding || "utf8");
            }
        }

        // static pages
        // configure app to use bodyParser()
        // this will let us get the data from a POST
        app.use(bodyParser.urlencoded({
            extended: true,
            verify: rawBodySaver
        }));
        app.use(bodyParser.json({
            limit: "5mb",
            verify: rawBodySaver
        }));

        // This is exclusively for web hooks
        app.use(bodyParser.raw({
            verify: rawBodySaver,
            type: "*/json"
        }));

        // Set up authentication with passport
        passport.use(new LocalStrategy(
            {passReqToCallback: true},
            function (req, username, password, done) {
                datasource.authenticate(req, username, password).then(
                    async function (user) {
                        // Check session count
                        if (
                            !user.isSuper &&
                            req.session &&
                            req.tenant.edition &&
                            req.tenant.edition.maxSessions
                        ) {
                            let sql = (
                                "SELECT sid FROM \"$session\" " +
                                "WHERE sess->>'database'=$1 " +
                                " AND sess->>'passport' IS NOT NULL " +
                                " AND expire > now();"
                            );
                            let resp = await req.sessionStore.pool.query(
                                sql,
                                [req.database]
                            );

                            if (
                                resp.rows.length >=
                                req.tenant.edition.maxSessions
                            ) {
                                done(null, false, new Error(
                                    "Maximum allowed sessions of " +
                                    req.tenant.edition.maxSessions +
                                    " exceeded"
                                ));
                                return;
                            }
                        }

                        return done(null, user);
                    }
                ).catch(
                    function (err) {
                        logger.error("/signin: " + err);
                        console.error("/signin: " + err);
                        return done(null, false, {
                            message: signInMessage(err)
                        });
                    }
                );
            }
        ));


        // Magic link setup
        magicLogin = new MagicLoginStrategy({
            secret: thesecret,
            callbackUrl: "/auth/magiclink/callback",
            sendMagicLink: async function (destination, href, ignore, req) {
                try {
                    // Confirmation mail only
                    if (req.mail.confirmCode) {
                        req.magicHref = href;
                        await notify.send(req.tenant, systemUser, {
                            html: (
                                `<html><p>Your confirmation code is: ` +
                                `<b>${req.mail.confirmCode}</b>` +
                                `</p><html>`
                            ),
                            subject: "Featherbone confirmation code",
                            to: req.user.email
                        });
                        return;
                    }

                    // Link to log in without password
                    let url = (
                        req.protocol + "://" + req.get("host") + "/" +
                        req.database + href
                    );

                    // New account
                    if (req.mail.newAccount) {
                        let acctType = (
                            req.mail.accountType
                            ? req.mail.accountType + " "
                            : ""
                        );
                        let msg = (
                            req.mail.message
                            ? `${req.mail.message}`
                            : ""
                        );
                        let theHtml = (
                            `<html><p>A new ${acctType}` +
                            `account has been created` +
                            ` for you at: <b>${req.get("host")}</b></p>` +
                            `<p>Your user name is: ` +
                            `<b>${req.mail.name}</b></p>` +
                            `${msg}` +
                            `<p>Click <a href=` +
                            `\"${url}\"` +
                            `>here</a> to sign in.</p><html>`
                        );
                        await notify.send(req.tenant, systemUser, {
                            html: theHtml,
                            subject: `New ${acctType} account created`,
                            to: destination
                        });
                    } else {
                        // Reset password
                        await notify.send(req.tenant, systemUser, {
                            html: (
                                `<html><p>Click <a href=` +
                                `\"${url}\"` +
                                `>here</a> to reset your password.` +
                                `</p><html>`
                            ),
                            subject: "Featherbone password reset",
                            to: destination
                        });
                    }
                } catch (e) {
                    /*
                        The strategy would answer "sent" whatever
                        happened here. A caller that needs to know
                        (an administrator inviting someone) reads this.
                    */
                    req.mailError = e;
                    logger.error(e);
                    console.error(e);
                }
            },
            verify: async function (payload, callback, req) {
                try {

                    if (payload.confirm) {
                        let given = Buffer.from(
                            codeHash(req.query.confirmCode || "")
                        );
                        let held = Buffer.from(String(payload.confirm));

                        if (
                            given.length !== held.length ||
                            !crypto.timingSafeEqual(given, held)
                        ) {
                            callback(new Error("Invalid confirmation code"));
                            return;
                        }
                    }

                    /*
                        The instance is found again here, from the
                        registry, rather than read out of the link.
                    */
                    req.tenant = (
                        payload.database
                        ? tenants.find(
                            (t) => t.pgDatabase === payload.database
                        )
                        : undefined
                    );
                    let user = await datasource.deserializeUser(
                        req,
                        payload.username
                    );

                    req.session.database = req.database;
                    req.session.save(function () {
                        callback(null, user);
                    });
                } catch (err) {
                    callback(err);
                }
            },
            jwtOptions: {expiresIn: "2 days"}
        });

        passport.use(magicLogin);

        passport.serializeUser(function (user, done) {
            //console.log("serialize ", user);
            done(null, user.name);
        });

        passport.deserializeUser(deserializeUser);

        // Liveness probe for connection-monitor.js's reconnect polling.
        // Deliberately ahead of the session/passport middleware below:
        // no auth, no tenant (":db") routing, just "is this process up"
        // (John, Oct 2026).
        app.get("/api/ping", function (ignore, res) {
            res.json({ok: true});
        });

        // Initialize passport
        app.use(express.static("public"));
        app.use(session({
            store: new PgSession({
                pool: pgPool,
                tableName: "$session"
            }),
            secret: thesecret,
            /*
                Never rewrite an unchanged session (tenant plan E.3,
                improvement plan 4.4): every request on every tenant
                used to write a full session row in the manager.
                rolling still slides the expiry, which the store does
                with a cheap touch instead of a rewrite.
            */
            resave: false,
            rolling: true,
            saveUninitialized: false,
            cookie: {
                secure: "auto",
                maxAge: sessionTimeout
            },
            genid: () => f.createId()
        }));
        app.use(bodyParser.urlencoded({extended: false}));
        app.use(passport.initialize());
        app.use(passport.session());

        // Google Oauth2
        if (googleOauth2ClientId) {
            passport.use(new GoogleStrategy(
                {
                    clientID: googleOauth2ClientId,
                    clientSecret: googleOauth2ClientSecret,
                    callbackURL: (
                        googleOauth2CallbackUrl + "/oauth2/redirect/google"
                    ),
                    passReqToCallback: true,
                    scope: ["profile", "email"]
                },
                googleVerify
            ));

            let ppg = passport.authenticate("google", {
                scope: [
                    "https://www.googleapis.com/auth/userinfo.profile",
                    "https://www.googleapis.com/auth/userinfo.email",
                    "https://mail.google.com/"
                ],
                accessType: "offline",
                prompt: "consent"
            });
            let redirects = {};
            dbRouter.get(
                "/:db/oauth/google",
                async function (req, res, next) {
                    try {
                        let resp = await req.sessionStore.pool.query((
                            "SELECT * FROM \"$session\" WHERE sid=$1; "
                        ), [req.user.id]);
                        if (resp.rows.length) {
                            res.redirect(req.query.redirectUrl);
                            return;
                        }
                        req.session.database = req.params.db;
                        redirects[req.user.name] = req.query.redirectUrl;
                        return ppg(req, res, next);
                    } catch (e) {
                        return Promise.reject(e);
                    }
                }
            );
            app.get(
                "/oauth2/redirect/google",
                passport.authenticate("google", {
                    failureRedirect: ".."
                }),
                function (req, res) {
                    let url = redirects[req.user.name];
                    delete redirects[req.user.name];
                    // Successful authentication, redirect home.
                    res.redirect(url);
                }
            );
        }

        dbRouter.post("/:db/notice", doNotice);
        dbRouter.post("/:db/sign-in", doSignIn);
        dbRouter.post("/:db/sign-out", doSignOut);
        dbRouter.post("/:db/reset-password", doResetPassword);
        dbRouter.get(
            "/:db/auth/magiclink/callback",
            SignInLink.callback(passport, {
                error: (msg) => logger.error(msg)
            })
        );

        // Block unauthorized requests to internal data
        app.use(function (req, res, next) {
            if (req.sessionError) {
                doSignOut(req, res);
                return;
            }

            /*
                An identity session asked for an instance the manager
                will not let it into (tenant plan G.1). The session
                stands -- it was signed in against the manager, not
                against this instance -- so the answer is the picker
                and the reason, not a sign-out.
            */
            if (req.user && req.user.enterDenied) {
                let reason = req.user.enterDenied;

                if (
                    req.method === "GET" &&
                    String(req.headers.accept || "").includes("text/html")
                ) {
                    res.redirect(
                        "/#denied=" + encodeURIComponent(reason)
                    );
                    return;
                }
                res.status(403).json(reason);
                return;
            }

            /*
                An identity session may move between the instances it
                is granted, since each entry is checked (G.1). The
                rule below is for a session signed in to one instance,
                which has proved nothing about any other.
            */
            if (
                req.session &&
                req.session.database &&
                req.database &&
                !req.session.identity &&
                req.session.database !== req.database
            ) {
                doSignOut(req, undefined, function () {
                    let url = (
                        req.protocol + "://" + req.get("host") + "/" +
                        req.database
                    );
                    res.redirect(url);
                });
                return;
            }

            let target = req.url.slice(1);
            let interval = req.session.cookie.expires - new Date();
            target = target.split("/");
            if (!req.user && check.indexOf(target[1]) !== -1) {
                res.status(401).json("Unauthorized session");
                return;
            }

            if (req.session && sessions[req.sessionID]) {
                clearTimeout(sessions[req.sessionID]);
            }
            if (req.user) {
                webauthn.applyToken(req);
                req.user.mode = req.session.mode || mode;
                sessions[req.sessionID] = setTimeout(function () {
                    logger.verbose("Session " + req.sessionID + " timed out");
                    doSignOut(req, res);
                }, interval);
            }

            next();
        });

        // static pages
        dbRouter.get("/:db/files/downloads/:sourcename", doGetDownload);
        dbRouter.get(
            "/:db/files/downloads/:sourcename/:targetname",
            doGetDownload
        );
        // File upload
        dbRouter.use(expressFileUpload());
        dbRouter.get("/:db/", doGetIndexFile);

        /*
            The picker: a URL with no database in it (tenant plan
            G.1). Registered before the database router, which only
            ever matches a path whose first element names an instance.
        */
        app.get("/", doGetPickerFile);
        app.post("/sign-in", doPickerSignIn);
        app.post("/sign-out", doSignOut);
        app.get("/my/instances", doMyInstances);
        app.post("/auth/sso/start", doSsoStart);
        app.get("/auth/sso/callback", doSsoCallback);

        /*
            The platform console, on the same page and the same
            session (tenant plan G.2, G.3). Instance actions are the
            Instances screen's own, reached with no instance of their
            own: admin.js takes the organization from the body and
            refuses it for anyone below platform.
        */
        app.get("/platform", doGetPickerFile);
        app.get("/platform/overview", doPlatform(
            async function (mclient, obj) {
                let options = await platform.buildOptions(mclient);
                let fleet = await platform.fleet(mclient);
                let deployed = await datasource.deployedModules();

                return {
                    actor: {
                        isPlatformAdmin: true,
                        organization: obj.identity.organization,
                        username: obj.identity.username
                    },
                    /*
                        What each instance carries and what this server
                        holds, so the console can say which instances
                        are behind before anyone starts a rolling
                        outage (ADR-002 question 7).
                    */
                    fleet: fleet.map(function (instance) {
                        let carried = deployed[instance.database];
                        let core = (
                            carried
                            ? carried.modules.find(
                                (mod) => mod.name === "Core"
                            )
                            : undefined
                        );

                        return Object.assign({}, instance, {
                            /*
                                Core is a module row like any other,
                                but it comes from the framework's own
                                manifest rather than a package, so the
                                fleet's "behind" -- measured against
                                the packages this server holds --
                                never counts it. Decided here, with
                                the one comparison the startup
                                upgrade uses.
                            */
                            coreVersion: (
                                core
                                ? core.version
                                : undefined
                            ),
                            isCoreBehind: (
                                carried
                                ? upgrade.isBehind(
                                    core
                                    ? core.version
                                    : undefined
                                )
                                : false
                            ),
                            modules: carried
                        });
                    }),
                    installed: await datasource.installedPackages(),
                    organizations: await platform.organizations(mclient),
                    people: await platform.people(mclient),
                    providers: await platform.providers(mclient),
                    /*
                        The framework this server runs. Core comes
                        from the framework's manifest rather than a
                        package, so "behind" for it is measured
                        against this, not against what the server
                        holds in modules/ (John, 2026-10-17).
                    */
                    serverVersion: upgrade.version(),
                    services: options.services,
                    templates: options.templates
                };
            }
        ));
        app.post("/platform/organization", doPlatform(
            (mclient, obj) => platform.addOrganization(
                mclient,
                platformData(obj)
            )
        ));
        app.post("/platform/organization/update", doPlatform(
            (mclient, obj) => platform.updateOrganization(
                mclient,
                platformData(obj)
            )
        ));
        app.post("/platform/organization/status", doPlatform(
            (mclient, obj) => platform.setOrganizationActive(
                mclient,
                platformData(obj)
            )
        ));
        app.post("/platform/organization/provider", doPlatform(
            async function (mclient, obj) {
                let saved = await platform.saveProvider(
                    mclient,
                    platformData(obj)
                );

                // Discovery is cached per issuer and client
                oidc.forget();
                return saved;
            }
        ));
        app.post("/platform/organization/administrator", doPlatform(
            (mclient, obj) => platform.appointAdministrator(
                mclient,
                platformData(obj)
            )
        ));
        app.post("/platform/instance", doAdminInstance("registerInstance"));
        app.post(
            "/platform/instance/status",
            doAdminInstance("setInstanceActive")
        );
        app.post(
            "/platform/instance/maintenance",
            doAdminInstance("setInstanceMaintenance")
        );
        app.post(
            "/platform/instance/provision",
            doAdminInstance("provisionInstance")
        );
        app.post(
            "/platform/instance/provision/resume",
            doAdminInstance("provisionResume")
        );
        app.post(
            "/platform/instance/deploy",
            doAdminInstance("deployPackage")
        );
        app.post("/platform/instance/drop", doAdminInstance("dropInstance"));
        app.post("/platform/template", doAdminInstance("buildTemplate"));
        app.post(
            "/platform/instance/upgrade",
            doAdminInstance("upgradeInstance")
        );
        app.get(
            "/platform/instance/process",
            doAdminRead("processStatus")
        );
        app.post(
            "/platform/instances/deploy",
            doAdminInstance("deployFleet")
        );
        app.post(
            "/platform/instances/upgrade",
            doAdminInstance("upgradeFleet")
        );
        app.post(
            "/platform/instances/sweep",
            doAdminInstance("sweepDemosGuarded")
        );
        app.get("/platform/packages", doAdminInstance("packages"));
        app.post(
            "/platform/packages/remove",
            doAdminInstance("removePackage")
        );
        /*
            Install from an uploaded archive. The upload middleware is
            put on this route rather than the app: everything else
            under /platform is JSON, and the file parser has no
            business in front of it. The size cap is the one thing a
            public-facing upload must not leave open.
        */
        app.post(
            "/platform/packages/install",
            expressFileUpload({
                abortOnLimit: true,
                limits: {fileSize: 256 * 1024 * 1024},
                useTempFiles: true
            }),
            doPackageUpload
        );

        app.use("/", dbRouter);
        dirs.forEach((dirname) => app.get(dirname + "/:filename", doGetFile));
        files.forEach((filename) => app.get(filename, doGetFile));

        // The factory-default logo (formats.image's fallbackSrc for
        // "logo", and what pdf.js prints when nothing is set) is a
        // bundled asset, not uploaded content: it rides in `files`
        // above, which both serves it and waves off the session, so
        // it is public and needs no fileUpload.

        // Uploaded files
        if (fileUpload) {
            app.get("/files/upload/:filename", doRequestFile);
            app.post("/files/upload/:filename", doProcessFile);
        }

        // Create routes for each catalog object
        registerDataRoutes();

        // REGISTER CORE ROUTES -------------------------------
        logger.info("Registering core routes");
        dbRouter.get("/:db/webauthn/reg", webauthn.doWebAuthNRegister);
        dbRouter.post("/:db/webauthn/reg", webauthn.postWebAuthNRegister);
        dbRouter.get("/:db/webauthn/auth", webauthn.doWebAuthNAuthenticate);
        dbRouter.post("/:db/webauthn/auth", webauthn.postWebAuthNAuthenticate);
        dbRouter.post("/:db/connect", doConnect);
        dbRouter.post("/:db/data/user-accounts", doQueryRequest);
        dbRouter.post("/:db/data/user-account", doPostUserAccount);
        dbRouter.get("/:db/data/user-account/:id", doRequest);
        dbRouter.get("/:db/pdf/:file", doOpenPdf);
        dbRouter.patch("/:db/data/user-account/:id", doPatchUserAccount);
        dbRouter.delete("/:db/data/user-account/:id", doRequest);
        dbRouter.get("/:db/currency/base", doGetBaseCurrency);
        dbRouter.get("/:db/currency/convert", doConvertCurrency);
        dbRouter.get("/:db/do/is-authorized", doIsAuthorized);
        dbRouter.post("/:db/do/aggregate/", doAggregate);
        dbRouter.post(
            "/:db/data/object-authorizations",
            doGetObjectAuthorizations
        );
        dbRouter.get("/:db/admin/overview", doAdmin("overview"));
        dbRouter.post("/:db/admin/identity", doAdmin("createIdentity"));
        dbRouter.post(
            "/:db/admin/identity/info",
            doAdmin("updateIdentity")
        );
        dbRouter.post(
            "/:db/admin/identity/password",
            doAdmin("setPassword")
        );
        dbRouter.post("/:db/admin/identity/status", doAdmin("setStatus"));
        dbRouter.post(
            "/:db/admin/identity/org-admin",
            doAdmin("setOrgAdmin")
        );
        dbRouter.post(
            "/:db/admin/identity/instance-admin",
            doAdmin("setInstanceAdmin")
        );
        dbRouter.post(
            "/:db/admin/identity/platform-admin",
            doAdmin("setPlatformAdmin")
        );
        dbRouter.post(
            "/:db/admin/identity/roles",
            doAdmin("identityRoles")
        );
        dbRouter.post(
            "/:db/admin/identity/role",
            doAdmin("setRoleMembership")
        );
        dbRouter.post("/:db/admin/grant", doAdmin("setGrant"));
        dbRouter.get("/:db/admin/instances", doAdmin("instanceOverview"));
        dbRouter.post(
            "/:db/admin/instance",
            doAdminInstance("registerInstance")
        );
        dbRouter.post(
            "/:db/admin/instance/organization",
            doAdminInstance("attachInstance")
        );
        dbRouter.post(
            "/:db/admin/instance/status",
            doAdminInstance("setInstanceActive")
        );
        dbRouter.post(
            "/:db/admin/instance/maintenance",
            doAdminInstance("setInstanceMaintenance")
        );
        dbRouter.post(
            "/:db/admin/instance/deploy",
            doAdminInstance("deployPackage")
        );
        dbRouter.post(
            "/:db/admin/instance/provision",
            doAdminInstance("provisionInstance")
        );
        dbRouter.post(
            "/:db/admin/instance/provision/resume",
            doAdminInstance("provisionResume")
        );
        dbRouter.post(
            "/:db/admin/instance/drop",
            doAdminInstance("dropInstance")
        );
        dbRouter.post(
            "/:db/admin/template",
            doAdminInstance("buildTemplate")
        );
        dbRouter.post(
            "/:db/admin/instance/upgrade",
            doAdminInstance("upgradeInstance")
        );
        dbRouter.get(
            "/:db/admin/instance/process",
            doAdminRead("processStatus")
        );
        dbRouter.post(
            "/:db/admin/instances/deploy",
            doAdminInstance("deployFleet")
        );
        dbRouter.post(
            "/:db/admin/instances/upgrade",
            doAdminInstance("upgradeFleet")
        );
        dbRouter.post(
            "/:db/admin/instances/sweep",
            doAdminInstance("sweepDemosGuarded")
        );
        dbRouter.get("/:db/sessions", doGetSessions);
        dbRouter.post("/:db/do/disconnect/:id", doDisconnectSession);
        dbRouter.post("/:db/do/change-password/", doChangePassword);
        dbRouter.post("/:db/do/change-role-password/", doChangeRolePassword);
        dbRouter.post("/:db/do/change-user-info/", doChangeUserInfo);
        dbRouter.post("/:db/do/save-authorization", doSaveAuthorization);
        dbRouter.post("/:db/do/stop-process", doStopProcess);
        dbRouter.post("/:db/do/export/:format/:feather", doExport);
        dbRouter.post("/:db/do/import/:format/:feather/:query", doImport);
        dbRouter.post("/:db/do/upload", doUpload);
        dbRouter.post("/:db/do/print-pdf/form/", doPrintPdfForm);
        dbRouter.post("/:db/do/send-mail", doSendMail);
        dbRouter.post("/:db/do/subscribe/:query", doSubscribe);
        dbRouter.post("/:db/do/unsubscribe/:query", doUnsubscribe);
        dbRouter.post("/:db/do/lock", doLock);
        dbRouter.post("/:db/do/unlock", doUnlock);
        dbRouter.get("/:db/feather/:name", doGetFeather);
        dbRouter.post("/:db/module/package/:name", doPackageModule);
        dbRouter.post("/:db/module/install/:query", doInstall);
        dbRouter.post("/:db/do/upgrade/:query", doUpgrade);
        dbRouter.get("/:db/help", doGetHelpPage);
        dbRouter.get("/:db/help-topic", doGetHelpTopic);
        dbRouter.get("/:db/help/:module/*", doGetHelpFile);
        dbRouter.get("/:db/about", doGetAbout);
        dbRouter.get("/:db/api", doGetApiPage);
        dbRouter.get("/:db/openapi.json", doGetOpenApi);
        dbRouter.get("/:db/profile", doGetProfile);
        dbRouter.put("/:db/profile", doPutProfile);
        dbRouter.patch("/:db/profile", doPatchProfile);
        dbRouter.get("/:db/settings/:name", doGetSettingsRow);
        dbRouter.put("/:db/settings/:name", doSaveSettings);
        dbRouter.get("/:db/settings-definition", doGetSettingsDefinition);
        dbRouter.get(
            "/:db/settings/is-authorized/:name",
            doSettingIsAuthorized
        );
        dbRouter.get("/:db/dashboards", doGetDashboards);
        dbRouter.get("/:db/dashboard/:name", doGetDashboard);
        dbRouter.put("/:db/dashboard/:name", doSaveDashboard);
        dbRouter.delete("/:db/dashboard/:name", doDeleteDashboard);
        dbRouter.get("/:db/dashboard-targets", doGetDashboardTargets);
        dbRouter.put("/:db/dashboard-target/:metric", doSaveDashboardTarget);
        dbRouter.delete(
            "/:db/dashboard-target/:metric",
            doDeleteDashboardTarget
        );
        dbRouter.get("/:db/workbooks", doGetWorkbooks);
        dbRouter.get(
            "/:db/navigation-categories",
            doGetNavigationCategories
        );
        dbRouter.put(
            "/:db/navigation-categories",
            doSaveNavigationCategories
        );
        dbRouter.get(
            "/:db/workbook/is-authorized/:name",
            doWorkbookIsAuthorized
        );
        dbRouter.get("/:db/workbook/:name", doGetWorkbook);
        dbRouter.put("/:db/workbook/:name", doSaveWorkbook);
        dbRouter.delete("/:db/workbook/:name", doDeleteWorkbook);

        await listenToTenants();
        handleEvents();

        // MODULE ROUTES
        dbRouter.post("/:db/:module/*", doModuleRoute);

        // Last of all: the generic data fallback, strictly after every
        // specific route so none is shadowed
        registerDataFallback();

        // START THE SERVER
        // ====================================================================
        const server = app.listen(port);
        // Enable web sockets to listen on the same port as http
        server.on("upgrade", function (request, socket, head) {
            wss.handleUpgrade(request, socket, head, function (socket) {
                wss.emit("connection", socket, request);
            });
        });
        console.log("Magic happens on port " + port);
    }

    // ..........................................................
    // FIRE IT UP
    //

    init().then(
        subscribeToTenants
    ).then(function () {
        sweepDemos();
        setInterval(sweepDemos, 3600000);
    }).then(
        subscribeToFeathers
    ).then(
        subscribeToCatalog
    ).then(start).catch(process.exit);
}());
