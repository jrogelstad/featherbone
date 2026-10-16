/*
    Framework for building object relational database apps
    Copyright (C) 2026  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public
    License along with this program.  If not, see
    <http://www.gnu.org/licenses/>.
*/
/*
    Talking to an identity provider over OpenID Connect (ADR-001 C.3).

    The protocol is not hand-rolled. `openid-client` does discovery,
    the authorization request, PKCE, the code exchange and the
    signature, issuer, audience and nonce checks on the id token; the
    plan said as much ("hand-rolling OIDC is a hazard"). What is here
    is the part that is ours: which provider, which redirect, and the
    claims that come back.

    This file deliberately knows nothing about identities. It answers
    "the provider says this is subject S with these claims" and hands
    that to server/services/federation.js, which decides who that is.
    The split is also what makes the deciding half testable without an
    identity provider in the room.

    Microsoft Entra ID (Azure AD) is the reference target. Its issuer
    is https://login.microsoftonline.com/<directory>/v2.0, and the
    discovery document lives under that, so nothing here is specific
    to it beyond the default scopes.
*/
/*jslint node*/
"use strict";

(function (exports) {
    "use strict";

    const SCOPES = "openid profile email";

    /**
        An OpenID Connect client, one per provider configuration.

        @class Oidc
        @constructor
        @namespace Services
    */
    exports.Oidc = function () {
        let that = {};
        let cached = {};

        function fail(message, code) {
            let err = new Error(message);

            err.statusCode = code || 400;
            return err;
        }

        /*
            Discovery is a network round trip, so what it returns is
            kept per issuer and client. Keyed by both, so changing
            either in the console takes effect without a restart.
        */
        async function configure(provider) {
            let key = provider.issuer + "|" + provider.clientId;

            if (cached[key]) {
                return cached[key];
            }

            let client = require("openid-client");
            let url = new URL(provider.issuer);

            cached[key] = await client.discovery(
                url,
                provider.clientId,
                provider.clientSecret
            );

            return cached[key];
        }

        /**
            Forget what discovery returned, so the next sign-in asks
            the provider again. Called when a provider is changed.

            @method forget
            @return {undefined}
        */
        that.forget = function () {
            cached = {};
        };

        /**
            Where to send the browser to sign in, and what to remember
            while it is away.

            The state, nonce and PKCE verifier go back to the caller to
            put on the session rather than being kept here: a second
            node may handle the callback, and a value this process
            holds in memory would not be there.

            @method begin
            @param {Object} provider As federation.providerFor returns
            @param {String} redirectUri Where the provider sends them
            @return {Promise} {url, state, nonce, verifier}
        */
        that.begin = async function (provider, redirectUri) {
            let client = require("openid-client");
            let config = await configure(provider);
            let verifier = client.randomPKCECodeVerifier();
            let challenge = await client.calculatePKCECodeChallenge(
                verifier
            );
            let state = client.randomState();
            let nonce = client.randomNonce();
            let url = client.buildAuthorizationUrl(config, {
                code_challenge: challenge,
                code_challenge_method: "S256",
                nonce,
                redirect_uri: redirectUri,
                scope: SCOPES,
                state
            });

            return {nonce, state, url: url.href, verifier};
        };

        /**
            What the provider said, once they come back. Rejects unless
            the id token verifies and the state and nonce are the ones
            that went out.

            @method finish
            @param {Object} provider As federation.providerFor returns
            @param {String} current The full callback URL as received
            @param {Object} pending What begin returned, from the session
            @return {Promise} {subject, claims}
        */
        that.finish = async function (provider, current, pending) {
            let client = require("openid-client");
            let config = await configure(provider);

            if (!pending || !pending.state) {
                throw fail(
                    "There is no sign-in waiting. Start again.",
                    440
                );
            }

            let tokens = await client.authorizationCodeGrant(
                config,
                new URL(current),
                {
                    expectedNonce: pending.nonce,
                    expectedState: pending.state,
                    pkceCodeVerifier: pending.verifier
                }
            );
            let claims = tokens.claims();

            if (!claims || !claims.sub) {
                throw fail("The provider returned no subject");
            }

            /*
                Entra ID puts the name and email in the id token for
                most tenants but not all; where they are missing the
                userinfo endpoint has them, and a user name is needed
                to make an identity (C.4).
            */
            if (!claims.preferred_username && !claims.email) {
                try {
                    let more = await client.fetchUserInfo(
                        config,
                        tokens.access_token,
                        claims.sub
                    );

                    claims = Object.assign({}, more, claims);
                } catch (err) {
                    console.error(
                        "Could not read the user info of " + claims.sub +
                        " at " + provider.issuer + ": " +
                        (err.message || err)
                    );
                }
            }

            return {claims, subject: claims.sub};
        };

        return that;
    };

}(exports));
