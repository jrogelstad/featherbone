/*jslint node, unordered */

(function (exports) {
    "use strict";
    const f = require("../../common/core");
    const datasource = require("../datasource");
    const {Fido2Lib} = require("fido2-lib");
    const crypto = require("crypto");
    const pdf = require("./pdf.js");
    let challenges = {};

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

    async function findUserAccount(name) {
        let object = {
            method: "GET",
            name: "UserAccount",
            user: "featheradmin",
            "filter": {
                "limit": 1,
                "offset": 0,
                "criteria": [
                    {
                        "property": [
                            "id",
                            "name",
                            "contact.fullName"
                        ],
                        "operator": "~*",
                        "value": name
                    }
                ]
            }
        };
        return await datasource.request(object, true);
    }
    async function findCredentials(name, byId) {
        let object = {
            method: "GET",
            name: "WebauthnCredential",
            user: "featheradmin",
            properties: [
                "id",
                "user.id",
                "credentialId",
                "counter",
                "publicKey"
            ],
            filter: {
                "limit": 20,
                "offset": 0,
                "criteria": [
                    {
                        "property": [
                            (
                                (byId)
                                ? "credentialId"
                                : "user.name"
                            )
                        ],
                        "operator": "=",
                        "value": name
                    }
                ]
            },
            "showDeleted": false
        };
        if (byId) {
            console.log(object.filter.criteria);
        }
        return await datasource.request(object, true);
    }

    async function createCredential(userId, credentialId, counter, publicKey) {
        let id = f.createId();
        let nowIso = new Date().toISOString();
        let data = {
            "id": id,
            "created": nowIso,
            "createdBy": "",
            "updated": nowIso,
            "updatedBy": "",
            "isDeleted": false,
            "objectType": "",
            "user": {
                "id": userId
            },
            "credentialId": credentialId,
            "counter": counter,
            "publicKey": publicKey,
            "rpId": rpId,
            "originUrl": originUrl
        };
        let payload = {
            name: "WebauthnCredential",
            method: "POST",
            user: "featheradmin",
            eventKey: undefined,
            id: undefined,
            data
        };
        return await datasource.request(payload, true);
    }

    async function doWebAuthNRegister(req, res) {

        let users = await findUserAccount(req.user.name);
        let user = users[0];
        let registrationOptions = await fido2Lib.attestationOptions();
        registrationOptions.user.id = user.id;
        registrationOptions.user.name = user.name;

        /// Could be contact name
        registrationOptions.user.displayName = user.name;
        let randId = crypto.randomUUID();
        registrationOptions.challenge = randId;

        /// Challenge needs to be put into the session
        /// or an HA location for ephemeral values
        challenges[user.name] = randId;

        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(registrationOptions));
        res.end();
    }

    async function postWebAuthNRegister(req, res) {

        let pkc = req.body;
        let users = await findUserAccount(req.user.name);
        let user = users[0];

        // Decode the raw id, which is the same as the credential id
        pkc.rawId = b_ab(b64url_b(pkc.rawId));

        /// encode the challenge into a buffer
        let challenge = b64_b(b64url_b64(challenges[user.name]));

        const attestationExpectations = {
            challenge,
            origin: originUrl,
            factor: "either"
        };
        console.log(attestationExpectations);
        /// will throw an error
        const regResult = await fido2Lib.attestationResult(
            pkc,
            attestationExpectations
        );

        const authnrData = regResult.authnrData;
        const credId = b_b64(new Uint8Array(authnrData.get("credId")));
        let publicKey = authnrData.get("credentialPublicKeyPem");
        let counter = parseInt(authnrData.get("counter"));
        console.log("Cred Id", credId);
        console.log("Public Key", publicKey);
        console.log("counter", counter);

        let createRet = await createCredential(
            user.id,
            credId,
            counter,
            publicKey
        );
        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(createRet));
        res.end();
    }

    async function doWebAuthNAuthenticate(req, res) {
        let users = await findUserAccount(req.user.name);
        let user = users[0];

        let creds = await findCredentials(req.user.name);
        console.log(creds);
        let authnOptions;
        if (creds.length) {
            authnOptions = await fido2Lib.assertionOptions();
            challenges[user.name] = authnOptions.challenge;
            authnOptions.challenge = b_b64url(ab_b(authnOptions.challenge));
            authnOptions.allowCredentials = [];
            creds.forEach(function (cred) {
                let credId = cred.credentialId;
                authnOptions.allowCredentials.push({
                    type: "public-key",
                    id: credId
                    //,transports: ["internal"]
                });
            });
        } else {
            authnOptions = {
                registrationRequired: true
            };
        }
        res.writeHeader(200, "application/json");
        res.write(JSON.stringify(authnOptions));
        res.end();
    }

    async function postWebAuthNAuthenticate(req, res) {
        let pkc = req.body;
        let users = await findUserAccount(req.user.name);
        let creds = await findCredentials(pkc.rawId, true);
        let user = users[0];
        let cred = creds[0];
        let result = {
            authenticated: false,
            error: false,
            message: null
        };
        if (cred && user) {
            pkc.rawId = b_ab(b64url_b(pkc.rawId));
            // let handle = pkc.response.userHandle;
            pkc.response.userHandle = "null";
            const assertionExpectations = {
                challenge: b_b64url(ab_b(challenges[user.name])),
                origin: originUrl,
                factor: "either",
                publicKey: cred.publicKey,
                prevCounter: 0,
                userHandle: "null"
            };
            assertionExpectations.allowCredentials = [];
            assertionExpectations.allowCredentials.push({
                type: "public-key",
                id: pkc.rawId
            });
            console.log(assertionExpectations);
            try {
                await fido2Lib.assertionResult(pkc, assertionExpectations);
                result.authenticated = true;
            } catch (e) {
                console.error(e);
                result.error = true;
            }
        } else {
            console.log("Credential", cred);
            console.error("Missing credential", pkc.rawId);
            result.error = true;
            result.message = "User or credential missing";
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
    async function loadCipher() {
        cipherBuff = await pdf.readFile("./server/cipher.key");
    }
    loadCipher();

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