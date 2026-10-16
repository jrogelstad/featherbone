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
    Two screens served where no database is named: the instance picker
    (tenant plan G.1) and the platform console (G.2, G.3).

    Deliberately their own page rather than part of the application
    bundle. The application is served from an instance and knows which
    one it is from the first element of the path; these run before there
    is an instance at all, and the bundle they would otherwise join
    (`client/clientmin.js`) is built rather than read.

    Actions follow the pattern the rest of Featherbone uses: clicking a
    row selects it, the buttons at the right of the toolbar enable for
    what the selected row allows, and a right-click offers the same
    actions where the row is.
*/
/*jslint browser, this*/
/*global m*/
(function () {
    "use strict";

    const AUTH = [
        {label: "Local password", value: "password"},
        {label: "Single sign-on only", value: "sso"},
        {label: "Either", value: "both"}
    ];

    let vm = {
        error: "",
        fleet: [],
        form: undefined,
        identity: undefined,
        installed: [],
        instances: [],
        isBusy: false,
        menu: undefined,
        needOrganization: false,
        note: "",
        organizations: [],
        picked: {},
        providers: [],
        ready: false,
        selection: undefined,
        services: [],
        templates: [],
        wantSso: false,
        view: (
            window.location.pathname.startsWith("/platform")
            ? "platform"
            : "picker"
        )
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

    function reason(err) {
        let data = (err || {}).data;

        if (data && data.message) {
            return data.message;
        }
        if (typeof data === "string" && data) {
            return data;
        }
        return "That did not work";
    }

    /*
        The right-click menu goes away on any click, wherever it lands,
        and on Escape. One function for the life of the page, so the
        listener that was added is the one that is removed.
    */
    function closeMenu(e) {
        if (
            vm.menu &&
            (!e || e.type === "click" || e.key === "Escape")
        ) {
            vm.menu = undefined;
            m.redraw();
        }
    }

    // Reading ----------------------------------------------------------

    function loadPicker() {
        return request("GET", "/my/instances").then(function (data) {
            vm.identity = data.identity;
            vm.instances = data.instances;
            vm.ready = true;
        }).catch(function () {
            vm.identity = undefined;
            vm.ready = true;
        }).then(m.redraw);
    }

    function loadPlatform() {
        return request("GET", "/platform/overview").then(function (data) {
            vm.identity = Object.assign(
                {},
                vm.identity,
                data.actor
            );
            vm.fleet = data.fleet;
            vm.organizations = data.organizations;
            vm.services = data.services;
            vm.templates = data.templates;
            vm.installed = data.installed || [];
            vm.providers = data.providers || [];
            vm.ready = true;
        }).catch(function (err) {
            /*
                Signed in, but not a platform administrator (or not
                signed in at all). Either way the answer is the
                picker, which says which it was.
            */
            if ((err || {}).status === 401) {
                vm.view = "picker";
                window.history.replaceState(undefined, "", "/");
                vm.error = reason(err);
                return loadPicker();
            }
            vm.error = reason(err);
            vm.ready = true;
        }).then(m.redraw);
    }

    function load() {
        return (
            vm.view === "platform"
            ? loadPlatform()
            : loadPicker()
        );
    }

    function go(view) {
        vm.view = view;
        vm.error = "";
        vm.note = "";
        vm.form = undefined;
        vm.selection = undefined;
        window.history.pushState(
            undefined,
            "",
            (
                view === "platform"
                ? "/platform"
                : "/"
            )
        );
        load();
    }

    // Writing ----------------------------------------------------------

    function send(path, body, said) {
        vm.isBusy = true;
        vm.error = "";
        vm.note = "";

        return request("POST", path, body).then(function () {
            vm.isBusy = false;
            vm.form = undefined;
            vm.note = said;
            return load();
        }).catch(function (err) {
            vm.isBusy = false;
            vm.error = reason(err);
            m.redraw();
        });
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

    /*
        Single sign-on (ADR-001 C.3). The organization is named first:
        which identity provider to send the browser to is the
        organization's to say, and the server will not list them to
        somebody who has not signed in.
    */
    function sso() {
        if (vm.isBusy) {
            return;
        }
        vm.isBusy = true;
        vm.error = "";

        request("POST", "/auth/sso/start", {
            organization: fieldValue("sso-organization")
        }).then(function (data) {
            window.location.assign(data.url);
        }).catch(function (err) {
            vm.isBusy = false;
            vm.error = reason(err);
            m.redraw();
        });
    }

    function signOut() {
        request("POST", "/sign-out").catch(function () {
            return;
        }).then(function () {
            vm.identity = undefined;
            vm.instances = [];
            vm.organizations = [];
            vm.fleet = [];
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

    // Shared pieces ----------------------------------------------------

    function field(id, label, type, onEnter, value) {
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
                    ? "new-password"
                    : "on"
                ),
                id,
                onkeydown: function (e) {
                    if (e.which === 13 && onEnter) {
                        onEnter();
                        e.preventDefault();
                        return false;
                    }
                },
                type: type || "text",
                value
            })
        ]);
    }

    function selector(id, label, options, value) {
        return m("div", {
            class: "pure-control-group fb-sign-in"
        }, [
            m("label", {class: "fb-sign-in-label", for: id}, label),
            m("select", {id}, options.map(function (option) {
                return m("option", {
                    selected: option.value === value,
                    value: option.value
                }, option.label);
            }))
        ]);
    }

    function toolbarButton(entry) {
        return m("button", {
            class: (
                "pure-button" + (
                    entry.disabled
                    ? " fb-button-disabled"
                    : ""
                )
            ),
            disabled: entry.disabled,
            id: "fb-platform-" + entry.key,
            onclick: entry.run,
            title: entry.title
        }, entry.label);
    }

    function contextMenu(entries) {
        if (!vm.menu) {
            return m("div", {class: "fb-context-menu"});
        }
        return m("div", {
            class: "fb-context-menu",
            style: {
                display: "inline",
                left: vm.menu.left + "px",
                top: vm.menu.top + "px"
            }
        }, m("ul", {
            class: "pure-menu-list fb-menu-list fb-menu-list-show",
            id: "fb-platform-menu"
        }, entries.map(function (entry) {
            return m("li", {
                class: (
                    "pure-menu-link fb-menu-list-item" + (
                        entry.disabled
                        ? " pure-menu-disabled"
                        : ""
                    )
                ),
                id: "fb-platform-menu-" + entry.key,
                onclick: function () {
                    if (!entry.disabled) {
                        entry.run();
                    }
                },
                title: entry.title
            }, entry.label);
        })));
    }

    function rowEvents(id) {
        return {
            onclick: function () {
                vm.selection = id;
                vm.menu = undefined;
            },
            oncontextmenu: function (e) {
                vm.selection = id;
                vm.menu = {left: e.pageX, top: e.pageY};
                e.preventDefault();
                return false;
            }
        };
    }

    // The picker -------------------------------------------------------

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
            ]),
            (
                vm.wantSso
                ? [
                    field("sso-organization", "Organization", "text", sso),
                    m("div", {class: "pure-control-group fb-sign-in"}, [
                        m("label", {class: "fb-sign-in-label"}, ""),
                        m("button", {
                            class: "pure-button fb-input",
                            disabled: vm.isBusy,
                            onclick: function () {
                                sso();
                                return false;
                            },
                            style: {width: "215px"}
                        }, "Continue")
                    ])
                ]
                : m("div", {class: "pure-control-group fb-sign-in"}, [
                    m("label", {class: "fb-sign-in-label"}, ""),
                    m("a", {
                        class: "fb-click-text",
                        onclick: function () {
                            vm.wantSso = true;
                            vm.error = "";
                        },
                        style: {width: "215px"}
                    }, "Sign in with single sign-on")
                ])
            )
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
            m("div", {class: "fb-admin-meta"}, [
                (
                    vm.identity.isPlatformAdmin
                    ? m("a", {
                        class: "fb-click-text",
                        onclick: function () {
                            go("platform");
                        },
                        style: {marginRight: "1em"}
                    }, "Administer the platform")
                    : undefined
                ),
                m("a", {class: "fb-click-text", onclick: signOut}, "Sign out")
            ])
        ];
    }

    // The platform console ---------------------------------------------

    function selectedOrganization() {
        return vm.organizations.find((o) => o.id === vm.selection);
    }

    function organizationActions() {
        let organization = selectedOrganization();
        let none = organization === undefined;

        function entry(key, label, title, disabled, run) {
            return {disabled, key, label, run, title};
        }

        return {
            administrator: entry(
                "administrator",
                "Appoint administrator",
                (
                    none
                    ? "Select an organization"
                    : "Give " + organization.name + " an administrator"
                ),
                none,
                function () {
                    vm.form = {kind: "administrator"};
                    vm.menu = undefined;
                }
            ),
            edit: entry(
                "edit",
                "Edit",
                (
                    none
                    ? "Select an organization"
                    : "Rename " + organization.name + ", or change how " +
                        "it signs in"
                ),
                none,
                function () {
                    vm.form = {kind: "edit"};
                    vm.menu = undefined;
                }
            ),
            provider: entry(
                "provider",
                "Single sign-on",
                (
                    none
                    ? "Select an organization"
                    : "How " + organization.name + " signs in through an " +
                        "identity provider"
                ),
                none,
                function () {
                    vm.form = {kind: "provider"};
                    vm.menu = undefined;
                }
            ),
            instance: entry(
                "instance",
                "New instance",
                (
                    none
                    ? "Select an organization"
                    : "Build an instance for " + organization.name
                ),
                none || !vm.templates.length,
                function () {
                    vm.form = {kind: "instance"};
                    vm.menu = undefined;
                }
            ),
            organization: entry(
                "organization",
                "New organization",
                "Create an organization",
                false,
                function () {
                    vm.form = {kind: "organization"};
                    vm.menu = undefined;
                }
            ),
            status: entry(
                "status",
                (
                    none || organization.isActive
                    ? "Close"
                    : "Open"
                ),
                (
                    none
                    ? "Select an organization"
                    : (
                        organization.isActive
                        ? "Stop " + organization.name + " signing in " +
                            "anywhere. Its instances and their data stay."
                        : "Let " + organization.name + " sign in again"
                    )
                ),
                none,
                function () {
                    vm.menu = undefined;
                    send(
                        "/platform/organization/status",
                        {
                            id: organization.id,
                            isActive: !organization.isActive
                        },
                        (
                            organization.isActive
                            ? organization.name + " is closed"
                            : organization.name + " is open"
                        )
                    );
                }
            )
        };
    }

    function organizationForm() {
        let organization = selectedOrganization() || {};
        let kind = vm.form.kind;

        function cancel() {
            vm.form = undefined;
            vm.error = "";
        }

        function submit() {
            if (kind === "organization") {
                send("/platform/organization", {
                    authentication: fieldValue("authentication"),
                    isTwoFactorRequired: (
                        document.getElementById("two-factor").checked
                    ),
                    name: fieldValue("name")
                }, "Organization created");
                return;
            }
            if (kind === "edit") {
                send("/platform/organization/update", {
                    authentication: fieldValue("authentication"),
                    id: organization.id,
                    isTwoFactorRequired: (
                        document.getElementById("two-factor").checked
                    ),
                    name: fieldValue("name")
                }, "Organization saved");
                return;
            }
            if (kind === "administrator") {
                send("/platform/organization/administrator", {
                    email: fieldValue("email"),
                    fullName: fieldValue("full-name"),
                    organization: organization.id,
                    password: fieldValue("password"),
                    username: fieldValue("username")
                }, "Administrator appointed");
                return;
            }
            if (kind === "provider") {
                send("/platform/organization/provider", {
                    adminGroup: fieldValue("admin-group"),
                    clientId: fieldValue("client-id"),
                    clientSecret: fieldValue("client-secret"),
                    defaultInstances: fieldValue("default-instances").split(
                        ","
                    ).map((one) => one.trim()).filter(Boolean),
                    isJustInTime: (
                        document.getElementById("just-in-time").checked
                    ),
                    issuer: fieldValue("issuer"),
                    kind: fieldValue("provider-kind"),
                    name: fieldValue("provider-name"),
                    organization: organization.id,
                    usernameClaim: fieldValue("username-claim")
                }, "Identity provider saved");
                return;
            }
            send("/platform/instance/provision", {
                database: fieldValue("database"),
                name: fieldValue("instance-name"),
                organization: organization.id,
                service: fieldValue("service"),
                template: fieldValue("template")
            }, "Instance built");
        }

        const titles = {
            administrator: "Appoint an administrator of " + organization.name,
            edit: "Edit " + organization.name,
            instance: "Build an instance for " + organization.name,
            organization: "New organization",
            provider: "How " + organization.name + " signs in"
        };

        let fields = [];

        if (kind === "organization" || kind === "edit") {
            fields = [
                field("name", "Name", "text", submit, (
                    kind === "edit"
                    ? organization.name
                    : ""
                )),
                selector("authentication", "Sign-in", AUTH, (
                    organization.authentication || "password"
                )),
                m("div", {class: "pure-control-group fb-sign-in"}, [
                    m("label", {
                        class: "fb-sign-in-label",
                        for: "two-factor"
                    }, "Second factor"),
                    m("input", {
                        checked: (
                            kind === "edit"
                            ? organization.isTwoFactorRequired
                            : false
                        ),
                        id: "two-factor",
                        type: "checkbox"
                    })
                ])
            ];
        } else if (kind === "administrator") {
            fields = [
                field("username", "Username", "text", submit),
                field("full-name", "Full name", "text", submit),
                field("email", "Email", "text", submit),
                field("password", "Password", "password", submit),
                m("div", {class: "fb-admin-note"}, (
                    "They administer this organization: its people and " +
                    "who reaches which of its instances. They are " +
                    "granted no instance here."
                ))
            ];
        } else if (kind === "provider") {
            let have = vm.providers.find(
                (one) => one.organizationId === organization.id
            ) || {};

            fields = [
                m("div", {class: "fb-admin-note"}, (
                    "The organization signs in through this provider " +
                    "when its sign-in is set to single sign-on, or " +
                    "either. Register " + (
                        window.location.origin + "/auth/sso/callback"
                    ) + " as the redirect URI with the provider."
                )),
                field("provider-name", "Called", "text", submit, (
                    have.name || "Microsoft"
                )),
                selector("provider-kind", "Provider", [
                    {
                        label: "Microsoft Entra ID (Azure AD)",
                        value: "azure-ad"
                    },
                    {label: "Any OpenID Connect provider", value: "oidc"}
                ], have.kind || "azure-ad"),
                field("issuer", "Issuer", "text", submit, have.issuer || (
                    "https://login.microsoftonline.com/<directory>/v2.0"
                )),
                field("client-id", "Client id", "text", submit, (
                    have.clientId || ""
                )),
                field("client-secret", (
                    have.hasSecret
                    ? "New secret"
                    : "Client secret"
                ), "password", submit),
                field("username-claim", "User name claim", "text", submit, (
                    have.usernameClaim || "preferred_username"
                )),
                field("admin-group", "Administrator group", "text", submit, (
                    have.adminGroup || ""
                )),
                m("div", {class: "pure-control-group fb-sign-in"}, [
                    m("label", {
                        class: "fb-sign-in-label",
                        for: "just-in-time"
                    }, "Make accounts"),
                    m("input", {
                        checked: have.isJustInTime === true,
                        id: "just-in-time",
                        type: "checkbox"
                    })
                ]),
                field(
                    "default-instances",
                    "Granting",
                    "text",
                    submit,
                    (have.defaultInstances || []).join(", ")
                ),
                m("div", {class: "fb-admin-note"}, (
                    "A made account is granted the databases named " +
                    "above, separated by commas, and nothing else. " +
                    "Leave it empty and it reaches nothing until " +
                    "somebody grants it."
                )),
                (
                    have.hasSecret
                    ? m("div", {class: "fb-admin-note"}, (
                        "A secret is stored. Leave the field empty to " +
                        "keep it."
                    ))
                    : undefined
                )
            ];
        } else {
            fields = [
                field("instance-name", "Instance", "text", submit),
                field("database", "Database", "text", submit),
                selector("service", "Connection", vm.services.map(
                    (s) => ({label: s.name, value: s.id})
                )),
                selector("template", "From template", vm.templates.map(
                    (t) => ({label: t, value: t})
                ))
            ];
        }

        return m("form", {
            class: "pure-form pure-form-aligned",
            style: {
                background: "var(--fb-surface)",
                borderBottom: "1px solid var(--fb-border)",
                padding: "0.5em 0 1em 0"
            }
        }, [
            m("div", {class: "fb-sign-in fb-sign-in-header"}, titles[kind]),
            fields,
            m("div", {class: "pure-control-group fb-sign-in"}, [
                m("label", {class: "fb-sign-in-label"}, ""),
                m("button", {
                    class: "pure-button pure-button-primary",
                    disabled: vm.isBusy,
                    onclick: function () {
                        submit();
                        return false;
                    },
                    style: {width: "110px"}
                }, "Save"),
                m("button", {
                    class: "pure-button",
                    onclick: function () {
                        cancel();
                        return false;
                    },
                    style: {marginLeft: "6px", width: "110px"}
                }, "Cancel")
            ])
        ]);
    }

    function organizationRow(organization) {
        let events = rowEvents(organization.id);

        return m("tr", Object.assign({
            class: (
                "fb-admin-row" + (
                    vm.selection === organization.id
                    ? " fb-table-row-selected"
                    : ""
                )
            )
        }, events), [
            m("td", {class: "fb-admin-col-name"}, organization.name),
            m("td", {class: "fb-admin-col-status"}, (
                organization.isActive
                ? "Open"
                : "Closed"
            )),
            m("td", organization.instances),
            m("td", organization.identities),
            m("td", (
                organization.administrators
                ? organization.administrators
                : m("span", {
                    title: (
                        "Nobody can administer this organization. " +
                        "Appoint an administrator."
                    )
                }, "none")
            )),
            m("td", {class: "fb-admin-muted"}, (
                organization.authentication + (
                    vm.providers.some(
                        (one) => one.organizationId === organization.id
                    )
                    ? ""
                    : (
                        organization.authentication === "password"
                        ? ""
                        : " (no provider)"
                    )
                )
            ))
        ]);
    }

    // What an instance carries, and whether anything it carries is
    // behind a version this server holds (ADR-002 question 2)
    function carries(instance) {
        let modules = (instance.modules || {}).modules;

        if (!modules || !modules.length) {
            return {adrift: 0, behind: 0, fromRows: 0, text: "—"};
        }

        return {
            /*
                Named a version this server does not hold, so the
                instance runs the code in its own tables and nothing
                says so (ADR-002 section 2).
            */
            adrift: modules.filter((one) => one.isVersionMissing).length,
            behind: modules.filter((one) => one.isBehind).length,
            fromRows: modules.filter((one) => !one.isOnDisk).length,
            text: modules.map(function (one) {
                return one.name + " " + one.version + " (" + (
                    one.isOnDisk
                    ? "disk"
                    : "rows"
                ) + ")";
            }).join(", ")
        };
    }

    function fleetRow(instance) {
        let what = carries(instance);

        return m("tr", {class: "fb-admin-row"}, [
            m("td", m("input", {
                checked: vm.picked[instance.id] === true,
                onclick: function (e) {
                    vm.picked[instance.id] = e.target.checked;
                },
                type: "checkbox"
            })),
            m("td", {class: "fb-admin-col-name"}, (
                instance.organization || "—"
            )),
            m("td", instance.name),
            m("td", {class: "fb-admin-muted"}, instance.database),
            m("td", {class: "fb-admin-col-status"}, state(instance)),
            m("td", {
                class: (
                    what.behind || what.adrift
                    ? undefined
                    : "fb-admin-muted"
                ),
                title: what.text
            }, [
                (
                    what.adrift
                    ? m("span", {
                        style: {color: "var(--fb-danger)"},
                        title: (
                            what.adrift + " module(s) name a version " +
                            "this server does not hold, so this " +
                            "instance runs the code in its own tables"
                        )
                    }, what.adrift + " adrift ")
                    : undefined
                ),
                (
                    what.behind
                    ? what.behind + " behind"
                    : undefined
                ),
                (
                    !what.behind && !what.adrift
                    ? what.text
                    : undefined
                ),
                (
                    what.fromRows && !what.adrift
                    ? m("span", {
                        class: "fb-admin-muted"
                    }, " " + what.fromRows + " from rows")
                    : undefined
                )
            ]),
            m("td", instance.users)
        ]);
    }

    function pickedInstances() {
        return vm.fleet.filter((i) => vm.picked[i.id] === true);
    }

    function deployForm() {
        let chosen = pickedInstances();
        let versions = vm.installed.map(function (one) {
            return {
                label: one.name + " " + one.version,
                value: one.name + "@" + one.version
            };
        });

        function submit() {
            let pick = fieldValue("package").split("@");

            send("/platform/instances/deploy", {
                instances: chosen.map((i) => i.id),
                module: pick[0],
                stopOnError: !document.getElementById("carry-on").checked,
                version: pick[1]
            }, "Deployed");
        }

        return m("form", {
            class: "pure-form pure-form-aligned",
            style: {
                background: "var(--fb-surface)",
                borderBottom: "1px solid var(--fb-border)",
                padding: "0.5em 0 1em 0"
            }
        }, [
            m("div", {class: "fb-sign-in fb-sign-in-header"}, (
                "Deploy to " + chosen.length + " instance" + (
                    chosen.length === 1
                    ? ""
                    : "s"
                )
            )),
            m("div", {class: "fb-admin-note"}, (
                "One at a time, each held while it runs and let go " +
                "afterwards: " + chosen.map((i) => i.name).join(", ") +
                ". They are down in turn, not together."
            )),
            selector("package", "Package", versions),
            m("div", {class: "pure-control-group fb-sign-in"}, [
                m("label", {
                    class: "fb-sign-in-label",
                    for: "carry-on"
                }, "Carry on"),
                m("input", {
                    id: "carry-on",
                    type: "checkbox"
                })
            ]),
            m("div", {class: "fb-admin-note"}, (
                "Left off, the first failure stops the rest and leaves " +
                "that instance held. On, the ones that can take it do."
            )),
            m("div", {class: "pure-control-group fb-sign-in"}, [
                m("label", {class: "fb-sign-in-label"}, ""),
                m("button", {
                    class: "pure-button pure-button-primary",
                    disabled: vm.isBusy || !versions.length,
                    onclick: function () {
                        submit();
                        return false;
                    },
                    style: {width: "110px"}
                }, "Deploy"),
                m("button", {
                    class: "pure-button",
                    onclick: function () {
                        vm.form = undefined;
                        return false;
                    },
                    style: {marginLeft: "6px", width: "110px"}
                }, "Cancel")
            ])
        ]);
    }

    function console_() {
        let actions = organizationActions();

        return [
            m("div", {class: "fb-toolbar"}, [
                m("button", {
                    class: "pure-button",
                    onclick: function () {
                        go("picker");
                    }
                }, "Instances"),
                m("button", {
                    class: "pure-button",
                    onclick: load
                }, "Refresh"),
                m("div", {class: "fb-toolbar-fill"}),
                toolbarButton(actions.organization),
                toolbarButton(actions.edit),
                toolbarButton(actions.administrator),
                toolbarButton(actions.provider),
                toolbarButton(actions.instance),
                toolbarButton(actions.status),
                toolbarButton({
                    disabled: !pickedInstances().length,
                    key: "deploy",
                    label: "Deploy",
                    run: function () {
                        vm.form = {kind: "deploy"};
                        vm.menu = undefined;
                    },
                    title: (
                        pickedInstances().length
                        ? "Deploy a package into the instances ticked " +
                            "below, one after another"
                        : "Tick the instances to deploy to"
                    )
                })
            ]),
            contextMenu([
                actions.edit,
                actions.administrator,
                actions.provider,
                actions.instance,
                actions.status
            ]),
            m("div", {class: "fb-title"}, m("label", "The platform")),
            m("div", {class: "fb-platform-body"}, [
            (
                vm.error
                ? m("div", {class: "fb-admin-note"}, vm.error)
                : undefined
            ),
            (
                vm.note
                ? m("div", {class: "fb-admin-note"}, vm.note)
                : undefined
            ),
            (
                vm.form && vm.form.kind === "deploy"
                ? deployForm()
                : undefined
            ),
            (
                vm.form && vm.form.kind !== "deploy"
                ? organizationForm()
                : undefined
            ),
            m("div", {class: "fb-platform-section"}, "Organizations"),
            m("div", {class: "fb-admin-scroll"}, m("table", {
                class: "pure-table fb-admin-table"
            }, [
                m("thead", m("tr", [
                    m("th", "Organization"),
                    m("th", "State"),
                    m("th", "Instances"),
                    m("th", "People"),
                    m("th", "Administrators"),
                    m("th", "Sign-in")
                ])),
                m("tbody", vm.organizations.map(organizationRow))
            ])),
            m("div", {class: "fb-platform-section"}, (
                "Every instance on this installation"
            )),
            m("div", {class: "fb-admin-scroll"}, m("table", {
                class: "pure-table fb-admin-table"
            }, [
                m("thead", m("tr", [
                    m("th", ""),
                    m("th", "Organization"),
                    m("th", "Instance"),
                    m("th", "Database"),
                    m("th", "State"),
                    m("th", "Carries"),
                    m("th", "People")
                ])),
                m("tbody", vm.fleet.map(fleetRow))
            ])),
            m("div", {class: "fb-admin-meta"}, m("a", {
                class: "fb-click-text",
                onclick: signOut
            }, "Sign out"))
            ])
        ];
    }

    const page = {
        oncreate: function () {
            document.getElementById("fb-title").text = "Featherbone";
            vm.error = denialFromHash();
            document.addEventListener("click", closeMenu);
            document.addEventListener("keydown", closeMenu);
            window.addEventListener("popstate", function () {
                vm.view = (
                    window.location.pathname.startsWith("/platform")
                    ? "platform"
                    : "picker"
                );
                load();
            });
            load();
        },

        onremove: function () {
            document.removeEventListener("click", closeMenu);
            document.removeEventListener("keydown", closeMenu);
        },

        view: function () {
            if (!vm.ready) {
                return m("div", {class: "fb-admin-note"}, "Signing in…");
            }
            if (!vm.identity) {
                return m("div", {
                    style: {margin: "0 auto", maxWidth: "48em", padding: "1em"}
                }, signInForm());
            }
            if (vm.view === "platform") {
                return m("div", console_());
            }

            return m("div", {
                style: {margin: "0 auto", maxWidth: "48em", padding: "1em"}
            }, instanceList());
        }
    };

    m.mount(document.getElementById("fb-picker"), page);
}());
