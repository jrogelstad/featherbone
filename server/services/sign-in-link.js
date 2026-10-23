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
/*jslint node, unordered*/
/**
    What happens when somebody follows a sign-in link from an email (a
    new account, an invitation, a password reset) and it does not work.

    A link stops working for ordinary reasons: it is two days old, it
    was meant for an instance the server no longer serves, or the server
    was restarted with another secret. The person who clicked has done
    nothing wrong, and used to be handed the server's own error page
    (John, Oct 2026: "super unfriendly"). They are taken to the sign-in
    screen of the instance instead, with their user name already in it
    and a line saying the link did not work, so a password or "Forgot
    password" is all that is left to do.

    @module SignInLink
*/
(function (exports) {
    "use strict";

    // How a failed link tells the sign-in screen whose it was
    const MARKER = "#link-failed=";

    /**
        What a link claims, read without checking it. Only for deciding
        whose sign-in screen to go to and which kind of link it was:
        nothing is signed in on the strength of it, and the user name
        is put in a text box and nowhere else.

        @method claims
        @param {String} token The link's token
        @return {Object} {confirm: Boolean, expired: Boolean,
            username: String}
    */
    function claims(token) {
        let part = String(token || "").split(".")[1];
        let body;

        try {
            body = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
        } catch (ignore) {
            body = {};
        }

        body = body || {};

        return {
            confirm: Boolean(body.confirm || body.confirmCode),
            // The strategy says only "Unauthorized" of a link past its
            // time; the log can say more
            expired: (
                typeof body.exp === "number" &&
                body.exp * 1000 < Date.now()
            ),
            username: (
                typeof body.username === "string"
                ? body.username.slice(0, 100)
                : ""
            )
        };
    }

    /**
        Where somebody whose link failed goes: the sign-in screen of
        the instance, told whose link it was. Relative, as the success
        redirect is, so it holds behind a proxy and under any path.

        @method failedUrl
        @param {String} username
        @return {String}
    */
    function failedUrl(username) {
        return "../../" + MARKER + encodeURIComponent(username || "");
    }

    /**
        Express handler for the link's callback.

        @method callback
        @param {Object} passport
        @param {Object} logger
        @return {Function} (req, res, next)
    */
    function callback(passport, logger) {
        return function (req, res, next) {
            let said = claims(req.query.token);

            function failed(reason) {
                let problem = (
                    typeof reason === "string"
                    ? new Error(reason)
                    : reason
                );

                /*
                    A confirmation code is answered by the client over
                    XHR and told "invalid" by the status; sending it to
                    the sign-in page would hide that. Everything else is
                    somebody's browser opening an email.
                */
                if (said.confirm) {
                    next(problem);
                    return;
                }

                logger.error(
                    "Sign-in link not accepted for \"" + said.username +
                    "\": " + problem.message + (
                        said.expired
                        ? " (the link had expired)"
                        : ""
                    )
                );
                res.redirect(failedUrl(said.username));
            }

            passport.authenticate("magiclogin", {
                session: true
            }, function (err, user, info) {
                if (err || !user) {
                    failed(err || (info && info.message) || "Unauthorized");
                    return;
                }

                req.logIn(user, function (e) {
                    if (e) {
                        failed(e);
                        return;
                    }
                    res.redirect("../../");
                });
            })(req, res, next);
        };
    }

    exports.SignInLink = {
        MARKER,
        callback,
        claims,
        failedUrl
    };

}(exports));
