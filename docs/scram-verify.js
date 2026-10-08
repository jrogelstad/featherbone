/*
    Proof for ADR 001: a Postgres SCRAM-SHA-256 verifier taken from
    pg_authid.rolpassword can be checked offline in Node, so existing
    Featherbone passwords can migrate to application-side authentication
    without forcing anyone to reset.

    Reading pg_authid requires a SUPERUSER connection; a CREATEROLE service
    account is refused, and pg_roles masks the column as '********'.
    Treat an exported verifier as password-equivalent.

    Usage: node docs/scram-verify.js <file-containing-one-verifier>
*/
const crypto = require("crypto");

function verify(storedVerifier, password) {
    const m = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(storedVerifier.trim());
    if (!m) return null;
    const iterations = parseInt(m[1], 10);
    const salt = Buffer.from(m[2], "base64");
    const storedKey = Buffer.from(m[3], "base64");
    const serverKey = Buffer.from(m[4], "base64");

    const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
    const clientKey = crypto.createHmac("sha256", saltedPassword).update("Client Key").digest();
    const computedStored = crypto.createHash("sha256").update(clientKey).digest();
    const computedServer = crypto.createHmac("sha256", saltedPassword).update("Server Key").digest();

    return {
        storedKeyMatches: crypto.timingSafeEqual(storedKey, computedStored),
        serverKeyMatches: crypto.timingSafeEqual(serverKey, computedServer),
        iterations
    };
}

const verifier = require("fs").readFileSync(process.argv[2], "utf8");
for (const pw of ["Correct-Horse-9!", "wrong-password", "Correct-Horse-9"]) {
    console.log(JSON.stringify(pw), "=>", JSON.stringify(verify(verifier, pw)));
}
