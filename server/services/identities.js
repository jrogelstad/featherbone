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
/**
    Application-side password verification (ADR-001 B.1).

    An identity's password is verified in Node, never by opening a
    Postgres connection as the user. Two verifier forms are understood:

    - "scrypt$N$r$p$<salt>$<key>" -- the application's own hash, written
      by `hashPassword`.
    - "SCRAM-SHA-256$<iter>:<salt>$<storedKey>:<serverKey>" -- a
      verifier exported from `pg_authid.rolpassword`, so existing
      passwords migrate with no reset. Verification is the SCRAM math
      offline: derive SaltedPassword with PBKDF2, then compare
      StoredKey = SHA256(HMAC(SaltedPassword, "Client Key")). Proven in
      docs/scram-verify.js.
    - "md5<hex>" -- the older pg_authid form, md5(password || username),
      from clusters whose password_encryption was md5. Needs the
      username to check, so `verifyPassword` takes it as a third
      argument.

    An imported verifier is password-equivalent at rest and reports
    `needsRehash`, so the caller replaces it with a scrypt hash on the
    first successful sign-in.

    @module Identities
*/
(function (exports) {
    "use strict";
    const crypto = require("crypto");

    // Interactive sign-in parameters: 16 MiB, fast enough per attempt
    const N = 16384;
    const R = 8;
    const P = 1;
    const KEYLEN = 64;

    exports.Identities = function () {
        let that = {};

        /**
            Hash a password for storage.

            @method hashPassword
            @param {String} password
            @return {String} verifier "scrypt$N$r$p$<salt>$<key>"
        */
        that.hashPassword = function (password) {
            let salt = crypto.randomBytes(16);
            let key = crypto.scryptSync(password, salt, KEYLEN, {
                N,
                r: R,
                p: P,
                maxmem: 128 * N * R * 2
            });

            return (
                "scrypt$" + N + "$" + R + "$" + P + "$" +
                salt.toString("base64") + "$" + key.toString("base64")
            );
        };

        /**
            Verify a password against a stored verifier.

            @method verifyPassword
            @param {String} password
            @param {String} stored Verifier in any understood form
            @param {String} [username] Required to check an md5 verifier
            @return {Object} {ok: Boolean, needsRehash: Boolean}
        */
        that.verifyPassword = function (password, stored, username) {
            let m;

            if (typeof stored !== "string" || !stored) {
                return {ok: false, needsRehash: false};
            }

            m = (
                /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$(.+)$/
            ).exec(stored);
            if (m) {
                let n = Number(m[1]);
                let r = Number(m[2]);
                let salt = Buffer.from(m[4], "base64");
                let key = Buffer.from(m[5], "base64");
                let check = crypto.scryptSync(password, salt, key.length, {
                    N: n,
                    r,
                    p: Number(m[3]),
                    maxmem: 128 * n * r * 2
                });

                return {
                    ok: crypto.timingSafeEqual(key, check),
                    needsRehash: false
                };
            }

            m = (
                /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/
            ).exec(stored.trim());
            if (m) {
                let salted = crypto.pbkdf2Sync(
                    password,
                    Buffer.from(m[2], "base64"),
                    Number(m[1]),
                    32,
                    "sha256"
                );
                let clientKey = crypto.createHmac(
                    "sha256",
                    salted
                ).update("Client Key").digest();
                let storedKey = crypto.createHash(
                    "sha256"
                ).update(clientKey).digest();

                return {
                    ok: crypto.timingSafeEqual(
                        Buffer.from(m[3], "base64"),
                        storedKey
                    ),
                    needsRehash: true
                };
            }

            m = (/^md5([0-9a-f]{32})$/).exec(stored.trim());
            if (m && typeof username === "string") {
                let digest = crypto.createHash("md5").update(
                    password + username
                ).digest("hex");

                return {
                    ok: crypto.timingSafeEqual(
                        Buffer.from(m[1], "utf8"),
                        Buffer.from(digest, "utf8")
                    ),
                    needsRehash: true
                };
            }

            return {ok: false, needsRehash: false};
        };

        return that;
    };

}(exports));
