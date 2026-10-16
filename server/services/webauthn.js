/*jslint node, unordered */

(function (exports) {
    "use strict";
    const {Fido2Lib} = require("fido2-lib");
    const crypto = require("crypto");
    const pdf = require("./pdf.js");
    const {Manager} = require("./manager");

    const manager = new Manager();

    let fido2Lib;
    let rpId;
    let originUrl = "http://localhost";

    function b64_b64url(inStr) {
        return inStr.replace(
            /\+/g,
            "-"
        ).replace(
            /\//g,
            "_"
        ).replace(
            /\=/g,
            ""
        );
    }
    function b64url_b64(inStr) {
        inStr = inStr.replace(
            /-/g,
            "+"
        ).replace(
            /_/g,
            "/"
        );
        inStr = inStr + "=".repeat(
            (inStr.length % 4)
            ? 4 - (inStr.length % 4)
            : 0
        );
        return inStr;
    }
    function b64_b(inStr) {
        return Buffer.from(inStr, "base64");
    }
    function b_b64(buf) {
        return Buffer.from(buf).toString("base64");
    }
    function b64url_b(inStr) {
        return b64_b(b64url_b64(inStr));
    }
    function b_b64url(buf) {
        return b64_b64url(b_b64(buf));
    }

    function b_ab(buf) {
        return buf.buffer.slice(
            buf.byteOffset,
            buf.byteOffset + buf.byteLength
        );
    }
    function ab_b(byteArray) {
        return Buffer.from(byteArray);
    }

    function init(rid, origin) {
        originUrl = origin;
        rpId = rid;
        fido2Lib = new Fido2Lib({
            timeout: 120000,
            rpId: rid,
            rpName: "FeatherBone",
            rpIcon: "https://localhost/featherbone.png",
            challengeSize: 128,
            attestation: "none",
            cryptoParams: [-7, -257],
            authenticatorAttachment: "platform",
            authenticatorRequireResidentKey: false,
            authenticatorUserVerification: "required"
        });
    }

    /*
        Passkeys belong to the identity in the manager (tenant plan
        C.1), not to one database: a credential registered against one
        instance signs its owner in to every database the identity can
        reach. Bare tables like "$provision", made on first use, so an
        existing manager needs no reinstall and no generic data route
        ever serves key material.

        Challenges live in "$identity_challenge" rather than process
        memory, so a ceremony begun on one node finishes on another
        (E.2), and a restart between the two steps fails the ceremony
        instead of dangling.
    */
    async function ensureTables(mclient) {
        await mclient.query(
            "CREATE TABLE IF NOT EXISTS \"$identity_credential\" (" +
            "  credential_id text PRIMARY KEY," +
            "  identity_pk bigint NOT NULL," +
            "  public_key text NOT NULL," +
            "  counter bigint NOT NULL DEFAULT 0," +
            "  rp_id text NOT NULL DEFAULT ''," +
            "  origin_url text NOT NULL DEFAULT ''," +
            "  created timestamp with time zone NOT NULL DEFAULT now()" +
            ")"
        );
        await mclient.query(
            "CREATE TABLE IF NOT EXISTS \"$identity_challenge\" (" +
            "  identity_pk bigint NOT NULL," +
            "  kind text NOT NULL," +
            "  challenge text NOT NULL," +
            "  expires timestamp with time zone NOT NULL," +
            "  PRIMARY KEY (identity_pk, kind)" +
            ")"
        );
    }

    /*
        The identity behind the signed-in user of this instance: the
        instance names its organization, the organization scopes the
        username (ADR-001).
    */
    async function identityFor(mclient, req) {
        let instance = await manager.instance(mclient, req.tenant);
        let found = await manager.identity(
            mclient,
            instance.organizationPk,
            req.user.name
        );

        if (!found) {
            throw new Error(
                "No identity " + req.user.name + " in this organization"
            );
        }

        return {
            identity: found,
            organizationPk: instance.organizationPk,
            tenantPk: instance.tenantPk
        };
    }

    async function setChallenge(mclient, identityPk, kind, challenge) {
        await ensureTables(mclient);
        await mclient.query(
            (
                "INSERT INTO \"$identity_challenge\" (" +
                "  identity_pk, kind, challenge, expires" +
                ") VALUES ($1, $2, $3, now() + interval '2 minutes') " +
                "ON CONFLICT (identity_pk, kind) DO UPDATE SET " +
                "  challenge = $3, expires = now() + interval '2 minutes'"
            ),
            [identityPk, kind, challenge]
        );
    }

    // One use each: read and remove, refusing an expired one
    async function takeChallenge(mclient, identityPk, kind) {
        await ensureTables(mclient);
        let resp = await mclient.query(
            (
                "DELETE FROM \"$identity_challenge\" " +
                "WHERE identity_pk = $1 AND kind = $2 " +
                "RETURNING challenge, expires"
            ),
            [identityPk, kind]
        );

        if (
            !resp.rows.length ||
            new Date(resp.rows[0].expires) < new Date()
        ) {
            throw new Error(
                "No current " + kind + " challenge. Start over."
            );
        }

        return resp.rows[0].challenge;
    }

    async function findCredentials(mclient, identityPk) {
        await ensureTables(mclient);
        let resp = await mclient.query(
            (
                "SELECT credential_id, public_key, counter " +
                "FROM \"$identity_credential\" WHERE identity_pk = $1"
            ),
            [identityPk]
        );

        return resp.rows;
    }

    /*
        A credential by its id, with its owner -- and the proof the
        owner may enter the instance asking: an active identity holding
        an active grant. The passkey follows the identity everywhere the
        identity can go, and nowhere it cannot.
    */
    async function credentialFor(mclient, credentialId, tenantPk) {
        await ensureTables(mclient);
        let resp = await mclient.query(
            (
                "SELECT c.credential_id, c.public_key, c.counter, " +
                "  c.identity_pk, i.username " +
                "FROM \"$identity_credential\" c " +
                "JOIN identity i ON i._pk = c.identity_pk " +
                "JOIN access_grant g " +
                "  ON g._identity_identity_pk = i._pk " +
                " AND g._tenant_tenant_pk = $2 " +
                " AND g.is_active AND NOT g.is_deleted " +
                "WHERE c.credential_id = $1 " +
                "  AND i.status = 'active' AND NOT i.is_deleted"
            ),
            [credentialId, tenantPk]
        );

        return resp.rows[0];
    }

    async function createCredential(identityPk, credentialId, counter, pem) {
        await manager.run(async function (mclient) {
            await ensureTables(mclient);
            await mclient.query(
                (
                    "INSERT INTO \"$identity_credential\" (" +
                    "  credential_id, identity_pk, public_key, counter, " +
                    "  rp_id, origin_url" +
                    ") VALUES ($1, $2, $3, $4, $5, $6) " +
                    "ON CONFLICT (credential_id) DO NOTHING"
                ),
                [credentialId, identityPk, pem, counter, rpId, originUrl]
            );
        });
    }

    async function doWebAuthNRegister(req, res) {
        try {
            let registrationOptions = await manager.run(
                async function (mclient) {
                    let ctx = await identityFor(mclient, req);
                    let options = await fido2Lib.attestationOptions();
                    let randId = crypto.randomUUID();

                    options.user.id = ctx.identity.id;
                    options.user.name = req.user.name;
                    /// Could be contact name
                    options.user.displayName = req.user.name;
                    options.challenge = randId;
                    await setChallenge(
                        mclient,
                        ctx.identity._pk,
                        "reg",
                        randId
                    );

                    return options;
                }
            );

            res.writeHeader(200, "application/json");
            res.write(JSON.stringify(registrationOptions));
            res.end();
        } catch (err) {
            res.status(500).json(err.message || String(err));
        }
    }

    async function postWebAuthNRegister(req, res) {
        try {
            let pkc = req.body;
            let outcome = await manager.run(async function (mclient) {
                let ctx = await identityFor(mclient, req);
                let stored = await takeChallenge(
                    mclient,
                    ctx.identity._pk,
                    "reg"
                );

                // Decode the raw id, also the credential id
                pkc.rawId = b_ab(b64url_b(pkc.rawId));

                const attestationExpectations = {
                    challenge: b64_b(b64url_b64(stored)),
                    origin: originUrl,
                    factor: "either"
                };
                /// will throw an error
                const regResult = await fido2Lib.attestationResult(
                    pkc,
                    attestationExpectations
                );

                const authnrData = regResult.authnrData;
                const credId = b_b64(
                    new Uint8Array(authnrData.get("credId"))
                );

                return {
                    counter: parseInt(authnrData.get("counter")),
                    credId,
                    identityPk: ctx.identity._pk,
                    organizationPk: ctx.organizationPk,
                    publicKey: authnrData.get("credentialPublicKeyPem")
                };
            });

            await createCredential(
                outcome.identityPk,
                outcome.credId,
                outcome.counter,
                outcome.publicKey
            );

            // A new way in is a privileged change (ADR-001 A.4)
            await manager.run((mclient) => manager.audit(mclient, {
                action: "identity.passkey_registered",
                by: req.user.name,
                organizationPk: outcome.organizationPk,
                targetIdentityPk: outcome.identityPk
            }));

            res.writeHeader(200, "application/json");
            res.write(JSON.stringify({registered: true}));
            res.end();
        } catch (err) {
            res.status(500).json(err.message || String(err));
        }
    }

    async function doWebAuthNAuthenticate(req, res) {
        try {
            let authnOptions = await manager.run(async function (mclient) {
                let ctx = await identityFor(mclient, req);
                let creds = await findCredentials(
                    mclient,
                    ctx.identity._pk
                );
                let options;

                if (!creds.length) {
                    return {registrationRequired: true};
                }

                options = await fido2Lib.assertionOptions();
                await setChallenge(
                    mclient,
                    ctx.identity._pk,
                    "auth",
                    b_b64url(ab_b(options.challenge))
                );
                options.challenge = b_b64url(ab_b(options.challenge));
                options.allowCredentials = creds.map(function (cred) {
                    return {
                        type: "public-key",
                        id: cred.credential_id
                    };
                });

                return options;
            });

            res.writeHeader(200, "application/json");
            res.write(JSON.stringify(authnOptions));
            res.end();
        } catch (err) {
            res.status(500).json(err.message || String(err));
        }
    }

    async function postWebAuthNAuthenticate(req, res) {
        let pkc = req.body;
        let result = {
            authenticated: false,
            error: false,
            message: null
        };

        try {
            await manager.run(async function (mclient) {
                let ctx = await identityFor(mclient, req);
                let cred = await credentialFor(
                    mclient,
                    pkc.rawId,
                    ctx.tenantPk
                );

                if (!cred || cred.identity_pk !== ctx.identity._pk) {
                    result.error = true;
                    result.message = "User or credential missing";
                    return;
                }

                let stored = await takeChallenge(
                    mclient,
                    ctx.identity._pk,
                    "auth"
                );

                pkc.rawId = b_ab(b64url_b(pkc.rawId));
                pkc.response.userHandle = "null";

                const assertionExpectations = {
                    challenge: stored,
                    origin: originUrl,
                    factor: "either",
                    publicKey: cred.public_key,
                    prevCounter: Number(cred.counter),
                    userHandle: "null",
                    allowCredentials: [{
                        type: "public-key",
                        id: pkc.rawId
                    }]
                };

                try {
                    let assertion = await fido2Lib.assertionResult(
                        pkc,
                        assertionExpectations
                    );

                    /*
                        The signature counter guards against a cloned
                        authenticator; it used to be checked against a
                        hard zero and never written back.
                    */
                    await mclient.query(
                        (
                            "UPDATE \"$identity_credential\" " +
                            "SET counter = $2 WHERE credential_id = $1"
                        ),
                        [
                            cred.credential_id,
                            Number(assertion.authnrData.get("counter"))
                        ]
                    );
                    result.authenticated = true;
                } catch (e) {
                    console.error(e);
                    result.error = true;
                }
            });
        } catch (err) {
            result.error = true;
            result.message = err.message || String(err);
        }

        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(result));
        res.end();
    }
    function applyToken(req) {
        let tokenStr = req.get("fb-token");
        if (tokenStr) {
            if (tokenStr.match(/^undefined$/)) {
                console.warn("Missed identity verification.");
            } else {
                let token = extractToken(req);
                if (token) {
                    console.log("Applying token: '" + token.name + "'");
                    req.user = {
                        id: token.id,
                        name: token.name
                    };
                } else {
                    console.error("Invalid token");
                }
            }
        }
    }
    function extractToken(req) {
        let key = parseCipherKey();
        let outObj;
        let token = req.get("fb-token");
        if (key && token) {
            token = decodeURI(token);
            let tokenDec = decryptToString(key, token);
            if (tokenDec) {
                /// Having trouble with PKCS#5/7 padding
                /// Trim off anything after the last brace
                let trim = tokenDec.substring(0, tokenDec.lastIndexOf("}") + 1);
                let tokenObj = JSON.parse(trim);
                if (tokenObj) {
                    let expiry = tokenObj.expiryDate - Date.now();
                    if (expiry > 0) {
                        outObj = tokenObj;
                    } else {
                        console.warn("Token expired");
                    }
                } else {
                    console.error("Failed to parse JSON object");
                }
            } else {
                console.error("Failed to decrypt token");
            }
        } else {
            console.error("Invalid key or token");
        }
        return outObj;
    }

    function parseKey(xmlStr) {
        if (!xmlStr) {
            return null;
        }
        let matKey = xmlStr.match(/<key>([A-Za-z0-9+=\/]+)<\/key>/);
        let matIv = xmlStr.match(/<iv>([A-Za-z0-9+=\/]+)<\/iv>/);
        let key;
        let iv;
        if (matKey && matKey.length) {
            key = matKey[1];
        } else {
            console.warn("Failed to parse key");
        }
        if (matIv && matIv.length) {
            iv = matIv[1];
        } else {
            console.warn("Failed to parse IV");
        }
        if (key && iv) {
            return setDecryptCipher(
                {
                    key,
                    iv
                }
            );
        } else {
            return null;
        }
    }

    function setDecryptCipher(cipherKey, algo) {
        if (!cipherKey || !cipherKey.key || !cipherKey.iv) {
            console.error("Invalid cipherKey");
            return;
        }

        let keyByte = new Uint8Array(Buffer.from(cipherKey.key, "base64"));
        let ivByte = new Uint8Array(Buffer.from(cipherKey.iv, "base64"));

        let algorithm = algo || "aes-256-cbc";
        let secretKey = keyByte;
        let iv = ivByte;

        cipherKey.decrypt = crypto.createDecipheriv(algorithm, secretKey, iv);
        cipherKey.decrypt.setAutoPadding(false);
        return cipherKey;
    }

    let cipherBuff;
    async function loadCipher(key) {
        if (!key) {
            return;
        }
        cipherBuff = await pdf.readFile(key);
    }

    function parseCipherKey() {
        let keyBuff = cipherBuff;
        if (!keyBuff) {
            console.error("Invalid key");
            return;
        }
        return parseKey(Buffer.from(keyBuff).toString());
    }

    function decryptToString(cipherKey, base64Txt) {
        if (!cipherKey || !cipherKey.decrypt) {
            console.error("Invalid cipher key");
            return null;
        }
        let decryptedData = cipherKey.decrypt.update(
            base64Txt,
            "base64",
            "utf-8"
        );
        decryptedData += cipherKey.decrypt.final("utf-8");
        return decryptedData;
    }
    exports.webauthn = {
        loadCipher,
        extractToken,
        applyToken,
        decryptToString,
        parseCipherKey,
        doWebAuthNAuthenticate,
        doWebAuthNRegister,
        postWebAuthNRegister,
        postWebAuthNAuthenticate,
        init
    };
}(exports));
