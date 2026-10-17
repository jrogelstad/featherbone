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
    The instance picker (tenant plan G.1): sign in once against the
    manager at a URL with no database, then choose which instance to
    open.

    Deliberately its own page rather than part of the application
    bundle. The application is served from an instance and knows which
    one it is from the first element of the path; this page runs before
    there is an instance at all, and the bundle it would otherwise join
    (`client/clientmin.js`) is built rather than read.
*/
/*jslint browser, this*/
/*global m*/
(function () {
    "use strict";

    let vm = {
        error: "",
        identity: undefined,
        instances: [],
        isBusy: false,
        needOrganization: false,
        ready: false
    };

    function fieldValue(id) {
        let el = document.getElementById(id);

        return (
            el
            ? el.value
            : ""
        );
    }

    // A refusal handed back by a redirect from an instance, so the
    // reason survives the trip (server.js, enterDenied)
    function denialFromHash() {
        let hash = window.location.hash || "";

        if (!hash.startsWith("#denied=")) {
            return "";
        }
        window.history.replaceState(
            undefined,
            "",
            window.location.pathname
        );
        return decodeURIComponent(hash.slice("#denied=".length));
    }

    function request(method, path, body) {
        return m.request({
            background: true,
            body,
            extract: function (xhr) {
                let data;

                try {
                    data = JSON.parse(xhr.responseText);
                } catch (ignore) {
                    data = xhr.responseText;
                }
                if (xhr.status >= 400) {
                    throw {data, status: xhr.status};
                }
                return data;
            },
            method,
            url: path
        });
    }

    function load() {
        return request("GET", "/my/instances").then(function (data) {
            vm.identity = data.identity;
            vm.instances = data.instances;
            vm.ready = true;
        }).catch(function () {
            vm.identity = undefined;
            vm.ready = true;
        }).then(m.redraw);
    }

    function signIn() {
        if (vm.isBusy) {
            return;
        }
        vm.isBusy = true;
        vm.error = "";

        request("POST", "/sign-in", {
            organization: fieldValue("organization"),
            password: fieldValue("password"),
            username: fieldValue("username")
        }).then(function () {
            vm.isBusy = false;
            vm.needOrganization = false;
            return load();
        }).catch(function (err) {
            let data = (err || {}).data || {};

            vm.isBusy = false;
            vm.error = data.message || "Could not sign in";
            if (data.code === "organization-required") {
                vm.needOrganization = true;
            }
            m.redraw();
        });
    }

    function signOut() {
        request("POST", "/sign-out").catch(function () {
            return;
        }).then(function () {
            vm.identity = undefined;
            vm.instances = [];
            vm.error = "";
            vm.needOrganization = false;
            m.redraw();
        });
    }

    function open(instance) {
        if (!instance.isActive || instance.isMaintenance) {
            return;
        }
        window.location.assign("/" + instance.database + "/");
    }

    function field(id, label, type, onEnter) {
        return m("div", {
            class: "pure-control-group fb-sign-in"
        }, [
            m("label", {
                class: "fb-sign-in-label",
                for: id
            }, label),
            m("input", {
                autocomplete: (
                    type === "password"
                    ? "current-password"
                    : "on"
                ),
                id,
                onkeydown: function (e) {
                    if (e.which === 13) {
                        onEnter();
                        e.preventDefault();
                        return false;
                    }
                },
                type: type || "text"
            })
        ]);
    }

    function signInForm() {
        return m("form", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "fb-sign-in fb-sign-in-header"
            }, "Sign in to Featherbone"),
            m("div", {
                class: "fb-sign-in fb-sign-in-error"
            }, vm.error),
            field("username", "Username", "text", signIn),
            field("password", "Password", "password", signIn),
            (
                vm.needOrganization
                ? field("organization", "Organization", "text", signIn)
                : undefined
            ),
            m("div", {
                class: "pure-control-group fb-sign-in"
            }, [
                m("label", {class: "fb-sign-in-label"}, ""),
                m("button", {
                    class: "pure-button pure-button-primary fb-input",
                    disabled: vm.isBusy,
                    onclick: function () {
                        signIn();
                        return false;
                    },
                    style: {width: "215px"}
                }, "Sign in")
            ])
        ]);
    }

    function state(instance) {
        if (instance.isMaintenance) {
            return "Down for maintenance";
        }
        if (!instance.isActive) {
            return "Closed";
        }
        if (instance.isDemo) {
            return (
                instance.expiration
                ? "Demo until " + new Date(
                    instance.expiration
                ).toLocaleDateString()
                : "Demo"
            );
        }
        return "Open";
    }

    function instanceRow(instance) {
        let closed = !instance.isActive || instance.isMaintenance;

        return m("tr", {
            class: "fb-admin-row",
            onclick: function () {
                open(instance);
            },
            style: {
                cursor: (
                    closed
                    ? "default"
                    : "pointer"
                )
            },
            title: (
                closed
                ? state(instance)
                : "Open " + instance.name
            )
        }, [
            m("td", {class: "fb-admin-col-name"}, instance.name),
            m("td", {class: "fb-admin-muted"}, instance.database),
            m("td", {class: "fb-admin-col-status"}, state(instance)),
            m("td", {class: "fb-admin-col-actions"}, m("button", {
                class: (
                    closed
                    ? "pure-button fb-button-disabled"
                    : "pure-button pure-button-primary"
                ),
                disabled: closed,
                onclick: function (e) {
                    e.stopPropagation();
                    open(instance);
                    return false;
                }
            }, "Open"))
        ]);
    }

    function instanceList() {
        return [
            m("div", {class: "fb-title"}, [
                m("label", (
                    "Welcome, " + (
                        vm.identity.fullName || vm.identity.username
                    )
                ))
            ]),
            m("div", {
                class: "fb-admin-subtitle"
            }, vm.identity.organization.name),
            (
                vm.error
                ? m("div", {class: "fb-admin-note"}, vm.error)
                : undefined
            ),
            (
                vm.identity.isTwoFactorRequired
                ? m("div", {class: "fb-admin-note"}, (
                    "Your organization asks for a second factor, and the " +
                    "instance is what sends it. Opening one will ask you " +
                    "to sign in there."
                ))
                : undefined
            ),
            (
                vm.instances.length
                ? m("div", {class: "fb-admin-scroll"}, m("table", {
                    class: "pure-table fb-admin-table"
                }, [
                    m("thead", m("tr", [
                        m("th", "Instance"),
                        m("th", "Database"),
                        m("th", "State"),
                        m("th", "")
                    ])),
                    m("tbody", vm.instances.map(instanceRow))
                ]))
                : m("div", {class: "fb-admin-note"}, (
                    "You have access to no instance yet. An " +
                    "administrator grants it."
                ))
            ),
            m("div", {class: "fb-admin-meta"}, m("a", {
                class: "fb-click-text",
                onclick: signOut
            }, "Sign out"))
        ];
    }

    const picker = {
        oncreate: function () {
            document.getElementById("fb-title").text = "Featherbone";
            vm.error = denialFromHash();
            load();
        },

        view: function () {
            if (!vm.ready) {
                return m("div", {class: "fb-admin-note"}, "Signing in…");
            }
            return m("div", {
                class: "fb-picker",
                style: {margin: "0 auto", maxWidth: "48em", padding: "1em"}
            }, (
                vm.identity
                ? instanceList()
                : signInForm()
            ));
        }
    };

    m.mount(document.getElementById("fb-picker"), picker);
}());
