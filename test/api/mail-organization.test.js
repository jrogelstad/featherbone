/*
    Mail sent from inside an instance -- by a package's trigger --
    goes out through the organization's own account (Settings) when the
    caller names no server. It used to use the installation's
    config.json alone, which on a hosted server is a second place to
    set the account up and, unset, a mail server on localhost:
    Tracker's notice of a new issue failed on "connect ECONNREFUSED
    127.0.0.1:465" and took the save with it (John, Oct 2026).
    (server/services/mailer.js sendMail)
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const fs = require("node:fs/promises");
const os = require("os");
const path = require("path");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const {decoded, sink} = require("./lib/mailsink");
const authority = require("../harness/authority");

const NAME = "globalSettings";
const PLATFORM = "fbt_orgmail_platform";
const MODULE = "FbtOrgMail";

function flags(on) {
    return authority.flags(PLATFORM, {
        isOrgAdmin: on === true,
        isPlatformAdmin: on === true
    });
}

// A package whose trigger sends a mail the way Tracker's do: through
// the sendMail function, with the request's client and no server named
function mailingPackage(dir) {
    let file = path.join(dir, MODULE + ".zip");
    let zip = new AdmZip();

    zip.addFile("service.js", Buffer.from(
        "f.datasource.registerFunction(\"POST\", \"Contact\", " +
        "function (obj) {\n" +
        "    if (obj.newRec.lastName !== \"fbt-mail-probe\") {\n" +
        "        return Promise.resolve();\n" +
        "    }\n" +
        "    return f.datasource.request({\n" +
        "        client: obj.client,\n" +
        "        data: {message: {\n" +
        "            html: \"<p>from a package</p>\",\n" +
        "            subject: \"Organization account\",\n" +
        "            to: \"someone@example.com\"\n" +
        "        }},\n" +
        "        method: \"POST\",\n" +
        "        name: \"sendMail\"\n" +
        "    }, true);\n" +
        "}, f.datasource.TRIGGER_AFTER);\n"
    ));
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
        files: [{
            name: "fbt-org-mail",
            path: "service.js",
            type: "service"
        }],
        module: MODULE,
        version: "1.0.0"
    })));
    zip.writeZip(file);
    return file;
}

describe("a package's mail uses the organization's account", function () {
    let admin;
    let held;
    let smtp;
    let work;

    async function useSmtp(port) {
        let current = await admin.get("/settings/" + NAME);
        let resp = await admin.raw("PUT", "/settings/" + NAME, {
            data: Object.assign({}, current.data, {
                smtpHost: "127.0.0.1",
                smtpPassword: "secret",
                smtpPort: port,
                smtpSecure: false,
                smtpType: "SMTP",
                smtpUser: "org-account@example.com"
            }),
            etag: current.etag
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    }

    before(async function () {
        work = await fs.mkdtemp(path.join(os.tmpdir(), "fbt-orgmail-"));
        admin = await signedIn();
        held = await admin.get("/settings/" + NAME);
        smtp = await sink();
        await db.ensureIdentity(PLATFORM, settings.password, settings.testDb);
        await flags(true);
    });

    after(async function () {
        await smtp.close();
        await fs.rm(path.join(settings.modulesDir, MODULE), {
            force: true,
            recursive: true
        });
        await db.query("DELETE FROM module WHERE name = $1", [MODULE]);
        await flags(false);
        await db.withClient(
            settings.managerDb,
            (client) => client.query(
                "DELETE FROM \"$organization_settings\" WHERE name = $1",
                [NAME]
            )
        ).catch(() => undefined);

        let current = await admin.get("/settings/" + NAME);

        await admin.raw("PUT", "/settings/" + NAME, {
            data: held.data,
            etag: current.etag
        });
        await fs.rm(work, {force: true, recursive: true});
    });

    it("goes out through the account in Settings", async function () {
        await useSmtp(smtp.port);

        let person = new Session();
        let signed = await person.signIn(
            PLATFORM,
            settings.password,
            "FBTest"
        );

        assert.equal(signed.status, 200, JSON.stringify(signed.body));

        // The one who deploys needs to be a super user here too
        await db.query(
            "UPDATE user_account SET is_super = true " +
            "WHERE lower(name) = lower($1)",
            [PLATFORM]
        );
        await person.upload(
            "/module/install/x=1",
            "package",
            mailingPackage(work)
        );

        let sent = smtp.mails.length;
        let made = await person.raw("POST", "/data/contact", {
            firstName: "Mail",
            lastName: "fbt-mail-probe"
        });

        assert.equal(made.status, 200, JSON.stringify(made.body));
        assert.equal(smtp.mails.length, sent + 1, "it reached the account");

        let mail = smtp.mails[smtp.mails.length - 1];

        assert.match(mail.from, /org-account@example\.com/);
        assert.match(decoded(mail.raw), /Subject: Organization account/);
    });
});
