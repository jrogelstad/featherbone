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
/*jslint node unordered*/
/*
    Identity backfill (ADR-001 A.5, tooling for B.6).

    Sign-in is by identity and nothing else (B.8), so an installation
    that predates identities has nobody who can sign in until this has
    run. Builds the manager's identity records from what already
    exists:

    - One organization (named with --organization, default "Default"),
      created if absent.
    - Every registered instance is attached to that organization if it
      has none.
    - Every active login user account found in those instances becomes
      an identity in the organization (one identity per username; the
      same name in two instances is the same person, which is the
      test-and-production case), with an access grant per instance it
      appears in.
    - With superuser credentials (--username/--password), each new
      identity's password verifier is copied from pg_authid, so the
      user's current password keeps working and is re-hashed to the
      application's own form on first sign-in. Without them, identities
      are created with no password and must be reset.

    A dry run is the default and writes nothing. Pass --apply to write.
    Run it again any time: it reports what exists and only adds what is
    missing, so it is also the registration step when a new instance is
    attached by hand. A fresh `node install.js --instance` needs none
    of this: it makes the organization and the first identity itself.

    Pass --org-admin <username> to make that person the
    organization's first administrator. Nothing else does: the Users
    screen lets one administrator promote another, and every identity
    here is created with no flags, so without it the first
    administrator is a SQL statement.

    Usage:
        node scripts/migrate-identities.js                     # dry run
        node scripts/migrate-identities.js --apply \
            --username postgres --password <pw> \
            --organization "Acme" --org-admin jsmith
*/
(function () {
    "use strict";

    require("../common/string.js");

    const {Client} = require("pg");
    const f = require("../common/core");
    const {Config} = require("../server/config");
    const {Identities} = require("../server/services/identities");

    const config = new Config();
    const identities = new Identities();

    const DOC_COLS = (
        "_pk,id,created,created_by,updated,updated_by,is_deleted," +
        "owner,etag"
    );

    function docVals(id) {
        return {
            text: (
                "nextval('object__pk_seq'),'" + id + "',now(),'migrate'," +
                "now(),'migrate',false,'migrate','" + id + "'"
            )
        };
    }

    let argv = process.argv;
    let apply = argv.indexOf("--apply") !== -1;
    let orgName = "Default";
    let orgAdmin;
    let superuser;
    let superpwd;

    if (argv.indexOf("--organization") !== -1) {
        orgName = argv[argv.indexOf("--organization") + 1];
    }
    if (argv.indexOf("--username") !== -1) {
        superuser = argv[argv.indexOf("--username") + 1];
    }
    if (argv.indexOf("--password") !== -1) {
        superpwd = argv[argv.indexOf("--password") + 1];
    }
    if (argv.indexOf("--org-admin") !== -1) {
        orgAdmin = argv[argv.indexOf("--org-admin") + 1];
    }

    function say(msg) {
        console.log((
            apply
            ? ""
            : "[dry run] "
        ) + msg);
    }

    async function run() {
        let conf = await config.read();
        let managerDb = config.managerDatabase(conf);
        let manager = new Client({
            database: managerDb,
            host: conf.pgHost,
            password: conf.pgPassword,
            port: conf.pgPort,
            user: conf.pgUser
        });
        let audits = [];

        await manager.connect();

        let kind = await manager.query("SELECT kind FROM \"$db\"");
        if (
            !kind.rows.length ||
            kind.rows[0].kind !== "manager"
        ) {
            throw new Error(
                "Database \"" + managerDb + "\" is not a manager"
            );
        }

        // Verifiers, when superuser credentials were given
        let verifiers = {};
        if (superuser) {
            let su = new Client({
                database: managerDb,
                host: conf.pgHost,
                password: superpwd,
                port: conf.pgPort,
                user: superuser
            });
            await su.connect();
            let resp = await su.query(
                "SELECT rolname, rolpassword FROM pg_authid " +
                "WHERE rolcanlogin AND rolpassword IS NOT NULL"
            );
            await su.end();
            resp.rows.forEach(function (row) {
                verifiers[row.rolname] = row.rolpassword;
            });
            say(
                Object.keys(verifiers).length +
                " password verifiers read from pg_authid"
            );
        } else {
            say(
                "No superuser credentials: identities are created " +
                "without passwords and must be reset"
            );
        }

        // The organization
        let resp = await manager.query(
            "SELECT _pk FROM organization " +
            "WHERE name = $1 AND NOT is_deleted",
            [orgName]
        );
        let orgPk;

        if (resp.rows.length) {
            orgPk = resp.rows[0]._pk;
            say("Organization \"" + orgName + "\" exists");
        } else {
            say("Create organization \"" + orgName + "\"");
            if (apply) {
                resp = await manager.query(
                    (
                        "INSERT INTO organization (" + DOC_COLS +
                        ",name,is_active,authentication," +
                        "is_two_factor_required) VALUES (" +
                        docVals(f.createId()).text +
                        ",$1,true,'password',false) RETURNING _pk"
                    ),
                    [orgName]
                );
                orgPk = resp.rows[0]._pk;
                audits.push([
                    "organization.created", null, "Backfill: " + orgName
                ]);
            }
        }

        // The instances
        resp = await manager.query(
            (
                "SELECT tenant._pk, tenant.name, tenant.pg_database, " +
                "  tenant._organization_organization_pk AS org, " +
                "  svc.pg_host, svc.pg_port, svc.pg_user, " +
                "  pgp_sym_decrypt(svc.pg_password::bytea, $1) " +
                "    AS pg_password " +
                "FROM tenant " +
                "  JOIN tenant_service svc " +
                "    ON tenant._pg_service_tenant_service_pk = svc._pk " +
                "WHERE NOT tenant.is_deleted AND tenant.is_active"
            ),
            [conf.pgCryptoKey]
        );
        let tenants = resp.rows;

        if (!tenants.length) {
            say("No registered instances; nothing to do");
            await manager.end();
            return;
        }

        // username -> {pk or null, grants: Set of tenant pks}
        let known = {};
        resp = await manager.query(
            "SELECT _pk, lower(username) AS username FROM identity " +
            "WHERE _organization_organization_pk = $1 AND NOT is_deleted",
            [orgPk || -1]
        );
        resp.rows.forEach(function (row) {
            known[row.username] = {pk: row._pk, grants: {}};
        });
        resp = await manager.query(
            (
                "SELECT g._identity_identity_pk AS ipk, " +
                "  g._tenant_tenant_pk AS tpk, lower(i.username) AS u " +
                "FROM access_grant g JOIN identity i " +
                "  ON g._identity_identity_pk = i._pk " +
                "WHERE NOT g.is_deleted"
            )
        );
        resp.rows.forEach(function (row) {
            if (known[row.u]) {
                known[row.u].grants[row.tpk] = true;
            }
        });

        let t = 0;
        while (t < tenants.length) {
            let tenant = tenants[t];
            t += 1;

            if (tenant.org === null) {
                say(
                    "Attach instance \"" + tenant.name +
                    "\" to \"" + orgName + "\""
                );
                if (apply) {
                    await manager.query(
                        (
                            "UPDATE tenant SET " +
                            "_organization_organization_pk = $2, " +
                            "updated = now(), updated_by = 'migrate' " +
                            "WHERE _pk = $1"
                        ),
                        [tenant._pk, orgPk]
                    );
                }
            } else if (String(tenant.org) !== String(orgPk)) {
                say(
                    "Instance \"" + tenant.name + "\" belongs to " +
                    "another organization; skipped"
                );
                continue;
            }

            let instance = new Client({
                database: tenant.pg_database,
                host: tenant.pg_host,
                password: tenant.pg_password,
                port: tenant.pg_port,
                user: tenant.pg_user
            });
            let users;

            try {
                await instance.connect();
                users = await instance.query(
                    "SELECT name, email FROM user_account " +
                    "LEFT OUTER JOIN contact " +
                    "  ON _contact_contact_pk = contact._pk " +
                    "WHERE is_active AND is_login IS NOT false " +
                    "  AND NOT user_account.is_deleted"
                );
                await instance.end();
            } catch (err) {
                say(
                    "Instance \"" + tenant.name + "\" unreachable (" +
                    err.message + "); skipped"
                );
                continue;
            }

            let u = 0;
            while (u < users.rows.length) {
                let user = users.rows[u];
                let uname = user.name.toLowerCase();
                u += 1;

                if (!known[uname]) {
                    let hasVerifier = Boolean(verifiers[user.name]);
                    say(
                        "Create identity \"" + user.name + "\"" + (
                            hasVerifier
                            ? " with imported password"
                            : " WITHOUT a password"
                        )
                    );
                    known[uname] = {pk: null, grants: {}};
                    if (apply) {
                        resp = await manager.query(
                            (
                                "INSERT INTO identity (" + DOC_COLS +
                                ",_organization_organization_pk," +
                                "username,full_name,email,password_hash," +
                                "status,is_platform_admin,is_org_admin," +
                                "failed_attempts) VALUES (" +
                                docVals(f.createId()).text +
                                ",$1,$2,$2,$3,$4,'active',false,false,0) " +
                                "RETURNING _pk"
                            ),
                            [
                                orgPk,
                                user.name,
                                user.email || "",
                                verifiers[user.name] || null
                            ]
                        );
                        known[uname].pk = resp.rows[0]._pk;
                        audits.push([
                            "identity.created",
                            known[uname].pk,
                            "Backfill from instance " + tenant.name
                        ]);
                    }
                }

                if (!known[uname].grants[tenant._pk]) {
                    say(
                        "Grant \"" + user.name + "\" access to \"" +
                        tenant.name + "\""
                    );
                    known[uname].grants[tenant._pk] = true;
                    if (apply) {
                        await manager.query(
                            (
                                "INSERT INTO access_grant (" + DOC_COLS +
                                ",_identity_identity_pk," +
                                "_tenant_tenant_pk,is_active,granted) " +
                                "VALUES (" + docVals(f.createId()).text +
                                ",$1,$2,true,now())"
                            ),
                            [known[uname].pk, tenant._pk]
                        );
                        audits.push([
                            "access.granted",
                            known[uname].pk,
                            "Backfill: access to " + tenant.name
                        ]);
                    }
                }
            }
        }

        /*
            The first organization administrator. Nothing else appoints
            one: the Users screen lets an administrator promote somebody
            else, and the backfill above creates every identity with no
            flags, so without this the first one is a SQL statement
            (tenant plan A.4, B.6).
        */
        if (orgAdmin) {
            resp = await manager.query(
                (
                    "SELECT _pk, username, is_org_admin FROM identity " +
                    "WHERE _organization_organization_pk = $1 " +
                    "  AND lower(username) = lower($2) " +
                    "  AND NOT is_deleted"
                ),
                [orgPk, orgAdmin]
            );

            if (!resp.rows.length) {
                say(
                    "No identity \"" + orgAdmin + "\" in \"" + orgName +
                    "\" to make an organization administrator" + (
                        apply
                        ? ""
                        : " -- it would be created by this run, so pass" +
                          " --org-admin again with --apply"
                    )
                );
            } else if (resp.rows[0].is_org_admin) {
                say(
                    "\"" + resp.rows[0].username + "\" already " +
                    "administers \"" + orgName + "\""
                );
            } else {
                say(
                    "Make \"" + resp.rows[0].username + "\" an " +
                    "organization administrator of \"" + orgName + "\""
                );

                if (apply) {
                    await manager.query(
                        (
                            "UPDATE identity SET is_org_admin = true, " +
                            "updated = now(), updated_by = 'migrate' " +
                            "WHERE _pk = $1"
                        ),
                        [resp.rows[0]._pk]
                    );
                    audits.push([
                        "identity.org_admin_granted",
                        resp.rows[0]._pk,
                        "Appointed by the migration"
                    ]);
                }
            }
        }

        // Every write on a customer's behalf leaves a trail (A.4)
        let a = 0;
        while (apply && a < audits.length) {
            await manager.query(
                (
                    "INSERT INTO admin_audit (" + DOC_COLS +
                    ",action,occurred,_target_identity_identity_pk," +
                    "detail) VALUES (" + docVals(f.createId()).text +
                    ",$1,now(),$2,$3)"
                ),
                audits[a]
            );
            a += 1;
        }

        await manager.end();
        say("Done." + (
            apply
            ? " Restart the server; sign-in is by identity."
            : " Nothing was written; pass --apply to write."
        ));
    }

    run().catch(function (err) {
        console.error(err.message);
        process.exit(1);
    });
}());
