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
                            return false;
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
                        return false;
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
                        f.state().send("resetPassword");
                    }
                }, "Forgot password")
            ])
        ]);
    }
};

f.catalog().register("components", "signInPage", signInPage.component);

const confirmCodePage = {};

confirmCodePage.component = {
    oncreate: function () {
        document.getElementById("fb-title").text = "Confirm Sign In Code";
    },

    view: function (vnode) {
        return m("form", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "fb-sign-in fb-sign-in-header"
            }, "Check Your Email"),
            m("div", {
                class: "fb-sign-in fb-sign-in-header",
                style: {fontSize: "Large"},
            }, "Enter the confirmation code below:"),
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
                m("input", {
                    id: "confirm-code",
                    autocomplete: "off",
                    onkeydown: function (e) {
                        if (e.which === 13) {
                            f.state().send("entered", {
                                confirmUrl: vnode.attrs.confirmUrl
                            });
                            e.preventDefault();
                            return false;
                        }
                    }
                })
            ]),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("button", {
                    style: {
                        width: "100px",
                        minWidth: "100px",
                        marginRight: "20px"
                    },
                    id: "confirm",
                    class: "pure-button pure-button-primary fb-input",
                    onclick: function () {
                        f.state().send("entered", {
                            confirmUrl: vnode.attrs.confirmUrl
                        });
                        return false;
                    }
                }, "Confirm"),
                m("button", {
                    style: {
                        width: "100px",
                        minWidth: "100px"
                    },
                    id: "resend",
                    class: "pure-button fb-input",
                    onclick: function () {
                        f.state().send("resend", {
                            confirmUrl: vnode.attrs.confirmUrl
                        });
                        return false;
                    }
                }, "Resend")
            ])
        ]);
    }
};

f.catalog().register(
    "components",
    "confirmCodePage",
    confirmCodePage.component
);

const changePasswordPage = {};

changePasswordPage.component = {
    oncreate: function () {
        document.getElementById("fb-title").text = "Change Password";
    },

    view: function () {
        return m("form", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "fb-sign-in fb-sign-in-header"
            }, "Change Password for Featherbone"),
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
                    id: "userLabel",
                    for: "username",
                    class: "fb-password-label"
                }, "User:"),
                m("input", {
                    id: "username",
                    autocomplete: "off",
                    disabled: true,
                    value: f.currentUser().name
                })
            ]),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {
                    id: "passwordLabel1",
                    for: "password1",
                    class: "fb-password-label"
                }, "New Password:"),
                m("input", {
                    id: "password1",
                    autocomplete: "new-password",
                    type: "password"
                })
            ]),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {
                    id: "passwordLabel2",
                    for: "password2",
                    class: "fb-password-label"
                }, "Re-enter Password:"),
                m("input", {
                    id: "password2",
                    autocomplete: "new-password",
                    type: "password",
                    onkeydown: function (e) {
                        if (e.which === 13) {
                            f.state().send("submit");
                            e.preventDefault();
                            return false;
                        }
                    }
                })
            ]),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {
                    id: "submitLabel",
                    for: "submit",
                    class: "fb-sign-in-label"
                }, ""),
                m("button", {
                    style: {width: "215px"},
                    id: "submit",
                    class: "pure-button pure-button-primary fb-input",
                    onclick: function () {
                        f.state().send("submit");
                        return false;
                    }
                }, "Submit")
            ])
        ]);
    }
};

f.catalog().register(
    "components",
    "changePasswordPage",
    changePasswordPage.component
);
