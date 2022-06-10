/*jslint this, browser, unordered*/
/*global m atob btoa console*/
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
function b64_ab(inStr) {
    return Uint8Array.from(atob(inStr), function (c) {
        return c.charCodeAt(0);
    });
}
function ab_b64(buf) {
    return btoa(buf.reduce(
        function (data, val) {
            return data + String.fromCharCode(val);
        },
        ""
    ));
}

function authenticatedCredential(cred) {
    const outCredential = {
        id: cred.id,
        rawId: ab_b64(new Uint8Array(cred.rawId)),
        response: {
            clientDataJSON: ab_b64(new Uint8Array(
                cred.response.clientDataJSON
            )),
            authenticatorData: ab_b64(new Uint8Array(
                cred.response.authenticatorData
            )),
            signature: ab_b64(new Uint8Array(cred.response.signature)),
            userHandle: cred.response.userHandle
        },
        type: cred.type
    };
    // console.log("authenticated credential", outCredential);
    return outCredential;

}
function publicKeyCredential(pkc) {
    const outCredential = {
        id: pkc.id,
        rawId: ab_b64(new Uint8Array(pkc.rawId)),
        response: {
            clientDataJSON: ab_b64(new Uint8Array(
                pkc.response.clientDataJSON
            )),
            attestationObject: ab_b64(new Uint8Array(
                pkc.response.attestationObject
            ))
        },
        type: pkc.type
    };
    // console.log("credential", outCredential);
    return outCredential;

}

function publicKeyCredentialCreationOptions(attestation) {
    attestation.user.id = b64_ab(attestation.user.id);
    attestation.challenge = b64_ab(b64url_b64(attestation.challenge));
}

function publicKeyCredentialRequestOptions(attestation) {
    attestation.allowCredentials =
    attestation.allowCredentials.map(function (item) {
        item.id = b64_ab(item.id);
        return item;
    });
    attestation.challenge = b64_ab(b64url_b64(attestation.challenge));
}

async function authenticate() {
    let att = await m.request({method: "GET", url: "/webauthn/auth"});
    //console.log("Source Att", att);
    publicKeyCredentialRequestOptions(
        att
    );
    //console.log(att);
    // console.log("Auth Att", att);
    let cred = await navigator.credentials.get({
        publicKey: att
    });
    let credOut = authenticatedCredential(cred);
    let resp = await m.request({
        method: "POST",
        url: "/webauthn/auth",
        body: credOut
    });
    console.log(resp);
}

async function register() {
    //console.log("Register");
    let att = await m.request({method: "GET", url: "/webauthn/reg"});
    publicKeyCredentialCreationOptions(att);
    let cred = await navigator.credentials.create({
        publicKey: att
    });
    // console.log("credential", cred);
    // console.log("credential.rawId", cred.rawId);
    // console.log("credential2", ab_b64(new Uint8Array(cred.rawId)));
    let credOut = publicKeyCredential(cred);

    let resp = await m.request({
        method: "POST",
        url: "/webauthn/reg",
        body: credOut
    });
    console.log("Responded", resp);
    return resp;
}

let webauthn = {
    authenticate,
    register
};
export default Object.freeze(webauthn);
