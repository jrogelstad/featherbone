/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
**/
/*jslint this, browser*/
import f from "../core.js";

const m = window.m;
const signInPage = {};

signInPage.component = {
    view: function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "fb-sign-in fb-sign-in-header"
            }, "Sign in to Featherbone"),
            m("div", {
                class: "fb-sign-in fb-sign-in-error"
            }, (
                f.state().current().length
                ? f.state().resolve(f.state().current()[0]).message()
                : ""
            )),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {
                    id: "usernameLabel",
                    for: "username",
                    class: "fb-sign-in-label"
                }, "Username"),
                m("input", {
                    id: "username"
                })
            ]),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {
                    id: "passwordLabel",
                    for: "password",
                    class: "fb-sign-in-label"
                }, "Password"),
                m("input", {
                    id: "password",
                    type: "password"
                })
            ]),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {
                    id: "signinLabel",
                    for: "signin",
                    class: "fb-sign-in-label"
                }, ""),
                m("button", {
                    id: "signin",
                    class: "pure-button pure-button-primary fb-input",
                    onclick: function () {
                        f.state().send("authenticate");
                    }
                }, "Sign in")
            ]),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {
                    id: "forgotLabel",
                    for: "forgat",
                    class: "fb-sign-in-label"
                }, ""),
                m("button", {
                    id: "forgot",
                    class: "pure-button fb-input",
                    onclick: function () {
                        return;
                    }
                }, "Forgot password?")
            ])
        ]);
    }
};

export default Object.freeze(signInPage);
