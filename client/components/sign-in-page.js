/*
    Framework for building object relational database apps
    Copyright (C) 2022  John Rogelstad

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
/*jslint this, browser, unordered*/
/*global f, m*/

const signInPage = {};

signInPage.component = {
    oncreate: function () {
        document.getElementById("fb-title").text = "Sign In";
    },

    view: function () {
        return m("form", {
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
                    autocomplete: "on",
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
                    type: "password",
                    autocomplete: "current-password",
                    onkeydown: function (e) {
                        if (e.which === 13) {
                            f.state().send("authenticate");
                            e.preventDefault();
                        }
                    }
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
                    style: {width: "215px"},
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
                    id: "forgotPasswordLabel",
                    for: "forgotPassword",
                    class: "fb-sign-in-label"
                }, ""),
                m("a", {
                    style: {width: "215px", color: "darkslateblue"},
                    id: "forgotPassword",
                    onclick: function () {
                        console.log("Hello World");
                        f.state().send("forgotPassword");
                    }
                }, "Forgot password")
            ])
        ]);
    }
};

f.catalog().register("components", "signInPage", signInPage.component);

