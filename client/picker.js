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

    // Served from "public", which is mounted above the ":db" routing,
    // so the address holds whatever instance the reader came from --
    // and holds from the console, which is in no instance at all.
    const HELP = "/help/platform-help.html";

    // Forms that act on the selected instance rather than an organization
    const INSTANCE_FORMS = ["drop", "move", "template"];

    // How often to poll for Upgrade/Deploy progress (sendTracked).
    const PROGRESS_POLL_MS = 750;

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
        note: "",
        organizations: [],
        instanceSelection: undefined,
        onlyOrg: false,
        packages: [],
        packagesUnknown: [],
        people: [],
        picked: {},
        pkgSelection: undefined,
        progress: undefined,
        screen: undefined,
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
            vm.people = data.people || [];
            vm.services = data.services;
            vm.templates = data.templates;
            vm.installed = data.installed || [];
            vm.providers = data.providers || [];
            vm.serverVersion = data.serverVersion;
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

    function loadPackages() {
        return request("GET", "/platform/packages").then(function (data) {
            vm.packages = data.packages || [];
            vm.packagesUnknown = data.unknown || [];
            vm.ready = true;
        }).catch(function (err) {
            vm.error = reason(err);
            vm.ready = true;
        }).then(m.redraw);
    }

    function load() {
        if (vm.view === "platform" && vm.screen === "packages") {
            return loadPackages();
        }
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
        vm.screen = undefined;
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

    /*
        The organization an instance belongs to, from the list the
        console shows. An action on one instance names it, because the
        server looks the instance up inside an organization and a
        platform administrator's own is only one of them (tenant plan
        A.4). Without it, the console listed an instance it could not
        close or drop: one made by `node install.js --instance` lands
        in an organization of its own (John, Oct 2026).
    */
    function organizationOf(instanceId) {
        let fleet = vm.fleet || [];
        let found = fleet.find((one) => one.id === instanceId);

        return (
            found
            ? found.organizationId
            : undefined
        );
    }

    function send(path, body, said) {
        if (
            path.startsWith("/platform/instance/") &&
            body && body.id && !body.organization
        ) {
            body = Object.assign(
                {organization: organizationOf(body.id)},
                body
            );
        }

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

    // No live subscription of its own here (ADR-002's progress plan),
    // so a process id this page makes up is what the new poll route
    // reads back by.
    function newProcessId() {
        return (
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 10)
        );
    }

    /*
        Like send(), but for Upgrade and Deploy: the server tracks one
        ServerProcess per instance, in the same order the fleet runs
        them, so this polls the one in its turn and moves on once it
        reads a terminal status -- an instance that ran to the end
        just as fast as this page's own next poll still leaves
        `vm.progress` to catch up on the following tick, the same way
        a page that missed a tick on a healthy connection does.
    */
    function sendTracked(path, body, instances, said) {
        let ids = instances.map(newProcessId);
        let index = 0;
        let live = true;
        let timer;

        function poll() {
            if (!live) {
                return;
            }
            request(
                "GET",
                (
                    "/platform/instance/process?id=" + instances[index] +
                    "&processId=" + ids[index] + (
                        organizationOf(instances[index])
                        ? "&organization=" + organizationOf(instances[index])
                        : ""
                    )
                )
            ).then(function (row) {
                if (!live) {
                    return;
                }
                if (row) {
                    vm.progress.percentComplete = row.percentComplete || 0;
                    if (row.status !== "P" && index < ids.length - 1) {
                        index += 1;
                        vm.progress.index = index + 1;
                        vm.progress.percentComplete = 0;
                    }
                }
                m.redraw();
            }).catch(function () {
                return;
            }).then(function () {
                if (live) {
                    timer = window.setTimeout(poll, PROGRESS_POLL_MS);
                }
            });
        }

        if (vm.isBusy) {
            return;
        }

        vm.isBusy = true;
        vm.error = "";
        vm.note = "";
        vm.progress = {index: 1, percentComplete: 0, total: ids.length};
        timer = window.setTimeout(poll, PROGRESS_POLL_MS);

        return request(
            "POST",
            path,
            Object.assign({processIds: ids}, body)
        ).then(function (resp) {
            /*
                The fleet routes answer 200 whatever happened to the
                instances: a failure is a result with `ok: false`, not
                an error status, so the answer has to be read. Taking
                any 200 for success is what said "Deployed" over an
                install that had rolled back (John, Oct 2026).
            */
            let answer = resp || {};
            let results = answer.results || [];
            let failures = results.filter((one) => one.ok === false);
            let skipped = answer.notAttempted || 0;

            live = false;
            window.clearTimeout(timer);
            vm.isBusy = false;
            vm.form = undefined;
            vm.progress = undefined;

            if (failures.length) {
                vm.error = failures.map(
                    (one) => one.name + ": " + one.message
                ).join(" ");
                vm.note = (
                    said + " " + (results.length - failures.length) +
                    " of " + instances.length + (
                        skipped
                        ? "; " + skipped + " not attempted"
                        : ""
                    ) + "."
                );
            } else {
                vm.note = said;
            }
            return load();
        }).catch(function (err) {
            live = false;
            window.clearTimeout(timer);
            vm.isBusy = false;
            vm.progress = undefined;
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
            password: fieldValue("password"),
            username: fieldValue("username")
        }).then(function () {
            vm.isBusy = false;
            return load();
        }).catch(function (err) {
            let data = (err || {}).data || {};

            vm.isBusy = false;
            vm.error = data.message || "Could not sign in";
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
                /*
                    The starting value is put in once, when the box is
                    made. Handing it over as an attribute makes Mithril
                    put it back on every redraw, and a keystroke is a
                    redraw, so typing would be undone as it happened.
                */
                oncreate: function (vnode) {
                    if (value !== undefined) {
                        vnode.dom.value = value;
                    }
                },
                onkeydown: function (e) {
                    if (e.which === 13 && onEnter) {
                        onEnter();
                        e.preventDefault();
                        return false;
                    }
                },
                type: type || "text"
            })
        ]);
    }

    function selector(id, label, options, value) {
        return m("div", {
            class: "pure-control-group fb-sign-in"
        }, [
            m("label", {class: "fb-sign-in-label", for: id}, label),
            m("select", {
                id,
                oncreate: function (vnode) {
                    if (value !== undefined) {
                        vnode.dom.value = value;
                    }
                }
            }, options.map(function (option) {
                return m("option", {value: option.value}, option.label);
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
                vm.menu = {left: e.pageX, top: e.pageY, of: "organization"};
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
            m("td", {class: "fb-admin-muted"}, instance.organization || ""),
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
                        m("th", "Organization"),
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
                    vm.form = {kind: "administrator", person: ""};
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

    // "jsmith -- Jane Smith (Acme)": enough to tell two people apart
    function personLabel(one) {
        let label = one.username;

        if (one.fullName && one.fullName !== one.username) {
            label += " -- " + one.fullName;
        }

        if (one.organization) {
            label += " (" + one.organization + ")";
        }

        return label;
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
                let existing = vm.form.person;

                send("/platform/organization/administrator", {
                    email: (
                        existing
                        ? ""
                        : fieldValue("email")
                    ),
                    fullName: (
                        existing
                        ? ""
                        : fieldValue("full-name")
                    ),
                    organization: organization.id,
                    password: (
                        existing
                        ? ""
                        : fieldValue("password")
                    ),
                    username: existing || fieldValue("username")
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
                        id: "two-factor",
                        oncreate: function (vnode) {
                            vnode.dom.checked = (
                                kind === "edit" &&
                                organization.isTwoFactorRequired === true
                            );
                        },
                        type: "checkbox"
                    })
                ])
            ];
        } else if (kind === "administrator") {
            let chosen = vm.people.find(
                (one) => one.username === vm.form.person
            );

            fields = [
                m("div", {class: "pure-control-group fb-sign-in"}, [
                    m("label", {
                        class: "fb-sign-in-label",
                        for: "person"
                    }, "Person"),
                    m("select", {
                        id: "person",
                        onchange: function (e) {
                            vm.form.person = e.target.value;
                        }
                    }, [
                        m("option", {
                            selected: vm.form.person === "",
                            value: ""
                        }, "A new person...")
                    ].concat(vm.people.map(function (one) {
                        return m("option", {
                            selected: vm.form.person === one.username,
                            value: one.username
                        }, personLabel(one));
                    })))
                ])
            ];

            if (chosen) {
                fields.push(m("div", {class: "fb-admin-note"}, (
                    chosen.username + " is appointed as they stand: " +
                    "their password and details are not changed, and " +
                    "the same account can administer other " +
                    "organizations too."
                )));
            } else {
                fields = fields.concat([
                    field("username", "Username", "text", submit),
                    field("full-name", "Full name", "text", submit),
                    field("email", "Email", "text", submit),
                    field("password", "Password", "password", submit),
                    m("div", {class: "fb-admin-note"}, (
                        "A new account, owned by this organization. " +
                        "Pick an existing person above to appoint them " +
                        "instead."
                    ))
                ]);
            }

            fields.push(m("div", {class: "fb-admin-note"}, (
                "They administer this organization: its people and " +
                "who reaches which of its instances. They are " +
                "granted no instance here."
            )));
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
                        id: "just-in-time",
                        oncreate: function (vnode) {
                            vnode.dom.checked = have.isJustInTime === true;
                        },
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
        let administrators = organization.administratorNames || [];

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
            m("td", {
                title: administrators.join("\n")
            }, (
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
    /*
        The framework itself, separate from the modules `carries()`
        reports on: ADR-002's packages are deployed to an instance one
        at a time, but Core comes from the manifest in the checkout, so
        its own column is the only place an operator sees whether an
        instance is behind it (John, Oct 2026: "I don't see an
        indicator column of the core version... also shows whether the
        core is behind").
    */
    function core(instance) {
        let version = instance.coreVersion;

        if (!version) {
            return {
                behind: true,
                text: "—",
                title: "No Core version recorded for this instance yet. " +
                    "Upgrade it to find out."
            };
        }

        return {
            behind: Boolean(instance.isCoreBehind),
            text: version,
            title: (
                instance.isCoreBehind
                ? version + ", behind " + vm.serverVersion + ". Upgrade " +
                    "to catch up."
                : version + ", current."
            )
        };
    }

    function carries(instance) {
        let modules = (instance.modules || {}).modules;

        if (!modules || !modules.length) {
            return {
                adrift: 0,
                adriftNames: "",
                behind: 0,
                behindNames: "",
                fromRows: 0,
                fromRowsNames: "",
                onDisk: 0,
                onDiskNames: "",
                text: "—"
            };
        }

        return {
            /*
                Named a version this server does not hold, so the
                instance runs the code in its own tables and nothing
                says so (ADR-002 section 2).
            */
            adrift: modules.filter((one) => one.isVersionMissing).length,
            /*
                Which ones, not just how many. A count alone leaves the
                operator to work out what is wrong by reading the whole
                module list in the cell's own tooltip -- and the cell
                stops showing that list as soon as anything is wrong
                (John, Oct 2026).
            */
            adriftNames: modules.filter(
                (one) => one.isVersionMissing
            ).map((one) => one.name + " " + one.version).join(", "),
            behind: modules.filter((one) => one.isBehind).length,
            behindNames: modules.filter((one) => one.isBehind).map(
                (one) => one.name + " " + one.version + " (" +
                one.newest + " is installed)"
            ).join(", "),
            fromRows: modules.filter((one) => !one.isOnDisk).length,
            fromRowsNames: modules.filter((one) => !one.isOnDisk).map(
                (one) => one.name + " " + one.version
            ).join(", "),
            onDisk: modules.filter((one) => one.isOnDisk).length,
            onDiskNames: modules.filter((one) => one.isOnDisk).map(
                (one) => one.name + " " + one.version
            ).join(", "),
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
        let is = core(instance);

        return m("tr", {
            class: (
                "fb-admin-row" + (
                    vm.instanceSelection === instance.id ||
                    vm.picked[instance.id] === true
                    ? " fb-table-row-selected"
                    : ""
                )
            ),
            oncontextmenu: function (e) {
                vm.instanceSelection = instance.id;
                vm.menu = {left: e.pageX, top: e.pageY, of: "instance"};
                e.preventDefault();
                return false;
            },
            onclick: function () {
                vm.instanceSelection = instance.id;
            }
        }, [
            m("td", m("input", {
                title: "Tick to deploy a package to this instance",
                checked: vm.picked[instance.id] === true,
                /*
                    The tick is the group deploy's, not the selection:
                    one ticks several instances, the other points at
                    one. Stopped here so a tick does not also move the
                    row the toolbar is acting on.
                */
                onclick: function (e) {
                    vm.picked[instance.id] = e.target.checked;
                    e.stopPropagation();
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
                    is.behind
                    ? undefined
                    : "fb-admin-muted"
                ),
                style: (
                    is.behind
                    ? {color: "var(--fb-danger)"}
                    : undefined
                ),
                title: is.title
            }, is.text),
            m("td", {
                class: (
                    what.behind || what.adrift
                    ? undefined
                    : "fb-admin-muted"
                ),
                title: what.text
            }, [
                /*
                    Where the code runs from, said plainly. It used to
                    be in the tooltip only, and the tooltip is also
                    where the per-module list goes -- so on exactly the
                    instances that had something wrong, the thing you
                    most want to know was the thing hidden behind a
                    hover (John, Oct 2026).
                */
                (
                    what.onDisk
                    ? m("span", {
                        title: "From a package on this server: " +
                            what.onDiskNames
                    }, what.onDisk + " disk")
                    : undefined
                ),
                (
                    what.onDisk && what.fromRows
                    ? " / "
                    : undefined
                ),
                (
                    what.fromRows
                    ? m("span", {
                        title: "No package on this server, so the " +
                            "code in the database's own rows runs: " +
                            what.fromRowsNames
                    }, what.fromRows + " rows")
                    : undefined
                ),
                (
                    what.onDisk || what.fromRows
                    ? m("br")
                    : undefined
                ),
                (
                    what.adrift
                    ? m("span", {
                        style: {color: "var(--fb-danger)"},
                        title: (
                            "Adrift: " + what.adriftNames + ". This " +
                            "server does not hold " + (
                                what.adrift === 1
                                ? "that version"
                                : "those versions"
                            ) + ", so the instance runs the code in " +
                            "its own tables instead. Install the " +
                            "package, or deploy a version this server " +
                            "has."
                        )
                    }, what.adrift + " adrift ")
                    : undefined
                ),
                (
                    what.behind
                    ? m("span", {
                        title: (
                            "Behind: " + what.behindNames + ". Deploy " +
                            (
                                what.behind === 1
                                ? "it"
                                : "them"
                            ) + " to catch up."
                        )
                    }, what.behind + " behind")
                    : undefined
                ),
                (
                    !what.behind && !what.adrift && !what.onDisk &&
                    !what.fromRows
                    ? what.text
                    : undefined
                )
            ]),
            m("td", instance.users)
        ]);
    }

    function selectedInstance() {
        return vm.fleet.find((one) => one.id === vm.instanceSelection);
    }

    /*
        What the toolbar over the instances offers. The same actions
        the per-instance Instances screen has carried since D.3, on
        the screen that spans every organization -- which is where an
        operator is when a build stops or a deployment leaves an
        instance held, and so the screen that could not do anything
        about either (John, Oct 2026).

        Nothing here is "the instance you are signed in to": the
        console is in no instance, which is what lets it close or drop
        any of them.
    */
    function instanceActions() {
        let one = selectedInstance();
        let none = one === undefined;
        let pending = !none && one.pending !== undefined;

        function entry(key, label, title, disabled, run) {
            return {disabled, key, label, run, title};
        }

        function act(path, body, said) {
            return function () {
                vm.menu = undefined;
                send(path, body, said);
            };
        }

        return {
            drop: entry(
                "drop",
                "Drop",
                (
                    none
                    ? "Select an instance"
                    : "Drop " + one.database + " and take it out of " +
                        "the registry. There is no undo."
                ),
                none,
                function () {
                    vm.menu = undefined;
                    vm.form = {kind: "drop"};
                }
            ),
            maintenance: entry(
                "maintenance",
                (
                    !none && one.isMaintenance
                    ? "End maintenance"
                    : "Maintenance"
                ),
                (
                    none
                    ? "Select an instance"
                    : (
                        one.isMaintenance
                        ? "Let " + one.name + " answer requests again. " +
                            "A deployment that failed leaves this on " +
                            "until somebody has checked the schema."
                        : "Hold " + one.name + " for a deployment: it " +
                            "answers 503 with an explanation, and only " +
                            "a platform administrator can sign in"
                    )
                ),
                none,
                act(
                    "/platform/instance/maintenance",
                    (
                        none
                        ? {}
                        : {id: one.id, isMaintenance: !one.isMaintenance}
                    ),
                    (
                        !none && one.isMaintenance
                        ? "Maintenance ended"
                        : "Held for maintenance"
                    )
                )
            ),
            move: entry(
                "move",
                "Move",
                (
                    none
                    ? "Select an instance"
                    : (
                        pending
                        ? "A build that stopped cannot be moved. Resume " +
                            "or drop it first."
                        : (
                            one.isMaintenance
                            ? "Held for maintenance. End that before " +
                                "moving " + one.name + "."
                            : "Move " + one.name + " to another " +
                                "organization. Its database is not " +
                                "touched; people that organization does " +
                                "not answer for lose access."
                        )
                    )
                ),
                none || pending || one.isMaintenance,
                function () {
                    delete vm.menu;
                    vm.form = {id: one.id, kind: "move"};
                }
            ),
            resume: entry(
                "resume",
                "Resume",
                (
                    none
                    ? "Select an instance"
                    : (
                        pending
                        ? "Pick the build up from " + one.pending.state
                        : "Only a build that stopped can be resumed"
                    )
                ),
                none || !pending,
                act(
                    "/platform/instance/provision/resume",
                    (
                        none
                        ? {}
                        : {id: one.id}
                    ),
                    "Build resumed"
                )
            ),
            status: entry(
                "status",
                (
                    none || one.isActive
                    ? "Close"
                    : "Open"
                ),
                (
                    none
                    ? "Select an instance"
                    : (
                        one.isActive
                        ? "Stop anyone signing in to " + one.name +
                            ". The database and its data stay."
                        : "Let people sign in to " + one.name + " again"
                    )
                ),
                none || pending,
                act(
                    "/platform/instance/status",
                    (
                        none
                        ? {}
                        : {id: one.id, isActive: !one.isActive}
                    ),
                    (
                        !none && one.isActive
                        ? "Closed"
                        : "Open"
                    )
                )
            ),
            template: entry(
                "template",
                "Template",
                (
                    none
                    ? "Select an instance"
                    : "Copy " + one.name + " into the template new " +
                        "instances are built from. It must be quiet: " +
                        "anyone else's connections make the copy refuse."
                ),
                none,
                function () {
                    vm.menu = undefined;
                    vm.form = {kind: "template"};
                }
            )
            /*
                No single-instance "upgrade" entry here: Deploy never
                had one either (tick the one instance and press the
                group button), and having both put two buttons
                labelled "Upgrade" in the same toolbar with no way to
                tell them apart (John, 2026-10-18).
            */
        };
    }

    function visibleFleet() {
        let organization = selectedOrganization();

        if (!vm.onlyOrg || !organization) {
            return vm.fleet;
        }
        return vm.fleet.filter(
            (one) => one.organizationId === organization.id
        );
    }

    /*
        Only what is on show. Ticking an instance and then narrowing the
        list to one organization must not leave the hidden ticks in the
        deployment.
    */
    function pickedInstances() {
        return visibleFleet().filter((i) => vm.picked[i.id] === true);
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
            let ids = chosen.map((i) => i.id);

            sendTracked("/platform/instances/deploy", {
                instances: ids,
                module: pick[0],
                stopOnError: !document.getElementById("carry-on").checked,
                version: pick[1]
            }, ids, "Deployed");
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

    function selectedPackage() {
        return vm.packages.find(
            (one) => one.name + "@" + one.version === vm.pkgSelection
        );
    }

    /*
        Install from here is the server half of ADR-002's two acts: the
        file is put where the server looks for packages, and no
        database changes. Deploy, on the instances list, is what
        reaches one.
    */
    function addPackage(file) {
        let body = new FormData();

        if (!file) {
            return;
        }

        vm.isBusy = true;
        vm.error = "";
        vm.note = "";
        body.append("package", file);

        m.request({
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
            method: "POST",
            url: "/platform/packages/install"
        }).then(function (done) {
            vm.isBusy = false;
            vm.note = (
                "Installed " + done.name + " " + done.version + (
                    done.libraries
                    ? " with its libraries"
                    : ""
                ) + ". Nothing is deployed yet."
            );
            vm.pkgSelection = done.name + "@" + done.version;
            return loadPackages();
        }).catch(function (err) {
            vm.isBusy = false;
            vm.error = reason(err);
            m.redraw();
        });
    }

    function removePackage() {
        let one = selectedPackage();

        if (!one) {
            return;
        }

        vm.isBusy = true;
        vm.error = "";
        vm.note = "";

        request("POST", "/platform/packages/remove", {
            name: one.name,
            version: one.version
        }).then(function () {
            vm.isBusy = false;
            vm.note = one.name + " " + one.version + " is off this server";
            vm.pkgSelection = undefined;
            return loadPackages();
        }).catch(function (err) {
            vm.isBusy = false;
            vm.error = reason(err);
            m.redraw();
        });
    }

    function packageRow(one) {
        let key = one.name + "@" + one.version;

        return m("tr", {
            class: (
                "fb-admin-row" + (
                    vm.pkgSelection === key
                    ? " fb-table-row-selected"
                    : ""
                )
            ),
            onclick: function () {
                vm.pkgSelection = key;
            }
        }, [
            m("td", {class: "fb-admin-col-name"}, one.name),
            m("td", one.version),
            m("td", {class: "fb-admin-col-status"}, (
                one.isNewest
                ? "newest"
                : m("span", {
                    class: "fb-admin-muted",
                    title: (
                        "This server also holds " + one.newest +
                        ", which is newer"
                    )
                }, one.newest + " is newer")
            )),
            m("td", (
                one.instances.length
                ? one.instances.join(", ")
                : m("span", {class: "fb-admin-muted"}, "nothing")
            ))
        ]);
    }

    function packagesScreen() {
        let one = selectedPackage();
        let why = "";

        if (!one) {
            why = "Select a package";
        } else if (one.isUsed) {
            why = (
                one.name + " " + one.version + " is deployed to " +
                one.instances.join(", ") + ". Deploy those instances " +
                "onto another version first."
            );
        } else if (one.isUncertain) {
            why = (
                "Cannot tell what " + vm.packagesUnknown.join(", ") +
                " carries, so nothing can be removed safely"
            );
        } else {
            why = "Take " + one.name + " " + one.version + " off this " +
                "server. No database changes.";
        }

        return m("div", {class: "fb-platform-panel"}, [
            m("div", {class: "fb-platform-section"}, (
                "Packages on this server"
            )),
            m("div", {class: "fb-list-toolbar"}, [
                m("input", {
                    id: "fb-package-file",
                    onchange: function (e) {
                        addPackage(e.target.files[0]);
                        e.target.value = "";
                    },
                    style: {display: "none"},
                    type: "file"
                }),
                toolbarButton({
                    disabled: vm.isBusy,
                    key: "add",
                    label: "Add package",
                    run: function () {
                        document.getElementById("fb-package-file").click();
                    },
                    title: (
                        "Put a package on this server. A zip, or an " +
                        "npm pack tarball."
                    )
                }),
                toolbarButton({
                    disabled: (
                        vm.isBusy || !one || one.isUsed || one.isUncertain
                    ),
                    key: "remove",
                    label: "Remove",
                    run: removePackage,
                    title: why
                }),
                m("div", {class: "fb-toolbar-fill"}),
                m("div", {class: "fb-admin-muted"}, (
                    vm.packages.length + " installed"
                ))
            ]),
            (
                vm.packagesUnknown.length
                ? m("div", {class: "fb-admin-note"}, (
                    "Nothing can be removed while " +
                    vm.packagesUnknown.join(", ") + " cannot be asked " +
                    "what " + (
                        vm.packagesUnknown.length === 1
                        ? "it carries"
                        : "they carry"
                    ) + ": an instance that cannot be seen may be " +
                    "running the version being removed."
                ))
                : undefined
            ),
            m("div", {class: "fb-admin-scroll"}, m("table", {
                class: "pure-table fb-admin-table"
            }, [
                m("thead", m("tr", [
                    m("th", "Module"),
                    m("th", "Version"),
                    m("th", "Standing"),
                    m("th", {
                        title: (
                            "The instances running this version. One " +
                            "that is in use cannot be removed."
                        )
                    }, "Used by")
                ])),
                m("tbody", vm.packages.map(packageRow))
            ])),
            (
                vm.packages.length
                ? undefined
                : m("div", {class: "fb-admin-note"}, (
                    "No packages are installed on this server, so " +
                    "Deploy has nothing to offer. Add one above, or " +
                    "run node install.js --package <file>."
                ))
            )
        ]);
    }

    /*
        Drop asks before it acts and Template asks what to call the
        copy. Neither is a dialog: the console has none, and a band
        above the list it belongs to says what is about to happen
        without taking the list off the screen.
    */
    /*
        A move is asked of the server as a dry run first, so who loses
        access and what changes are read before anything is done.
    */
    function moveForm(one) {
        let form = vm.form;
        let choices = vm.organizations.filter(
            (org) => org.id !== one.organizationId
        );
        let plan = form.plan;
        let ready = plan !== undefined && !vm.isBusy;

        function check(to) {
            form.to = to;
            delete form.plan;
            vm.error = "";
            if (!to) {
                return;
            }
            request("POST", "/platform/instance/move", {
                dryRun: true,
                id: one.id,
                organization: one.organizationId,
                to
            }).then(function (answer) {
                if (vm.form === form && form.to === to) {
                    form.plan = answer;
                }
            }).catch(function (err) {
                vm.error = reason(err);
            }).then(m.redraw);
        }

        // The selection moved under the form: start again
        if (form.id !== one.id) {
            vm.form = {id: one.id, kind: "move"};
            return moveForm(one);
        }

        return m("form", {
            class: "pure-form pure-form-aligned",
            id: "fb-platform-move-form",
            style: {
                background: "var(--fb-surface)",
                borderBottom: "1px solid var(--fb-border)",
                padding: "0.5em 0 1em 0"
            }
        }, [
            m("div", {class: "fb-sign-in fb-sign-in-header"}, (
                "Move " + one.name + " from " + (
                    one.organization || "no organization"
                )
            )),
            m("div", {class: "fb-admin-note"}, (
                "The database is not touched. Anyone the new " +
                "organization does not answer for loses access, is no " +
                "longer a super user in it, and is signed out of it. " +
                "Platform administrators keep theirs."
            )),
            m("div", {class: "pure-control-group fb-sign-in"}, [
                m("label", {class: "fb-sign-in-label", for: "move-to"}, (
                    "To"
                )),
                m("select", {
                    id: "move-to",
                    onchange: function (e) {
                        check(e.target.value);
                    }
                }, [
                    m("option", {value: ""}, "Choose an organization")
                ].concat(choices.map(function (org) {
                    return m("option", {value: org.id}, org.name);
                })))
            ]),
            (
                plan
                ? m("div", {
                    class: "fb-admin-note",
                    id: "fb-platform-move-revoked"
                }, (
                    plan.revoked.length
                    ? [
                        m("div", (
                            plan.revoked.length + (
                                plan.revoked.length === 1
                                ? " person loses"
                                : " people lose"
                            ) + " access:"
                        )),
                        m("ul", {style: {margin: "0.25em 0"}}, (
                            plan.revoked.map(function (who) {
                                return m("li", (
                                    who.username + " \u2014 " +
                                    who.fullName + " (" + (
                                        who.homeOrganization ||
                                        "no organization"
                                    ) + ")"
                                ));
                            })
                        ))
                    ]
                    : "Nobody loses access."
                ))
                : undefined
            ),
            (
                plan
                ? plan.warnings.map(function (text) {
                    return m("div", {
                        class: "fb-admin-note fb-platform-move-warning",
                        style: {color: "var(--fb-danger)"}
                    }, text);
                })
                : undefined
            ),
            m("div", {class: "pure-control-group fb-sign-in"}, [
                m("label", {class: "fb-sign-in-label"}, ""),
                m("button", {
                    class: (
                        "pure-button pure-button-primary" + (
                            ready
                            ? ""
                            : " fb-button-disabled"
                        )
                    ),
                    disabled: !ready,
                    id: "fb-platform-move-submit",
                    onclick: function () {
                        send("/platform/instance/move", {
                            id: one.id,
                            organization: one.organizationId,
                            to: form.to
                        }, one.name + " moved to " + plan.to.name);
                        return false;
                    },
                    style: {width: "110px"},
                    title: (
                        ready
                        ? "Move " + one.name + " to " + plan.to.name
                        : (
                            form.to
                            ? "Checking what the move would do"
                            : "Choose the organization to move it to"
                        )
                    )
                }, "Move"),
                m("button", {
                    class: "pure-button",
                    onclick: function () {
                        delete vm.form;
                        vm.error = "";
                        return false;
                    },
                    style: {marginLeft: "6px", width: "110px"}
                }, "Cancel")
            ])
        ]);
    }

    function instanceForm() {
        let one = selectedInstance();
        let kind = vm.form.kind;

        if (one && kind === "move") {
            return moveForm(one);
        }

        function cancel() {
            vm.form = undefined;
            vm.error = "";
        }

        function submit() {
            if (!one) {
                cancel();
                return;
            }
            if (kind === "drop") {
                if (fieldValue("confirm") !== one.database) {
                    vm.error = (
                        "Type " + one.database + " to confirm the drop"
                    );
                    return;
                }
                send(
                    "/platform/instance/drop",
                    {id: one.id},
                    one.name + " is dropped"
                );
                return;
            }
            send("/platform/template", {
                name: fieldValue("template-name"),
                source: one.database
            }, "Template built from " + one.name);
        }

        if (!one) {
            return;
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
                kind === "drop"
                ? "Drop " + one.name
                : "Copy " + one.name + " into a template"
            )),
            m("div", {class: "fb-admin-note"}, (
                kind === "drop"
                ? "The database " + one.database + " and everything in " +
                    "it goes, and the instance leaves the registry. " +
                    "There is no undo, and nothing here takes a backup."
                : "The source must be quiet while the copy runs. This " +
                    "server lets go of its own connections to it; " +
                    "anyone else's make the copy refuse rather than " +
                    "produce a torn clone."
            )),
            (
                kind === "drop"
                ? field(
                    "confirm",
                    "Type " + one.database,
                    "text",
                    submit
                )
                : field("template-name", "Template", "text", submit)
            ),
            m("div", {class: "pure-control-group fb-sign-in"}, [
                m("label", {class: "fb-sign-in-label"}, ""),
                m("button", {
                    class: (
                        "pure-button" + (
                            kind === "drop"
                            ? ""
                            : " pure-button-primary"
                        )
                    ),
                    disabled: vm.isBusy,
                    onclick: function () {
                        submit();
                        return false;
                    },
                    style: (
                        kind === "drop"
                        ? {
                            background: "var(--fb-danger)",
                            color: "white",
                            width: "110px"
                        }
                        : {width: "110px"}
                    )
                }, (
                    kind === "drop"
                    ? "Drop"
                    : "Build"
                )),
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

    function console_() {
        let actions = organizationActions();
        let rows = instanceActions();
        let organization = selectedOrganization();

        return [
            /*
                The page's own toolbar carries only what belongs to the
                page. Each list keeps its own actions over its own
                heading, because one shared toolbar gave no way to tell
                which buttons acted on an organization and which on an
                instance (John, Oct 2026).
            */
            m("div", {class: "fb-toolbar"}, [
                m("button", {
                    class: "pure-button",
                    onclick: function () {
                        go("picker");
                    },
                    title: "Back to the instances you can open"
                }, "My instances"),
                m("button", {
                    class: "pure-button",
                    onclick: load
                }, "Refresh"),
                m("button", {
                    class: "pure-button",
                    onclick: function () {
                        vm.screen = (
                            vm.screen === "packages"
                            ? undefined
                            : "packages"
                        );
                        vm.error = "";
                        vm.note = "";
                        vm.form = undefined;
                        load();
                    },
                    title: (
                        vm.screen === "packages"
                        ? "Back to the organizations and instances"
                        : "What this server holds, and which instances " +
                            "run it"
                    )
                }, (
                    vm.screen === "packages"
                    ? "Organizations"
                    : "Manage packages"
                )),
                m("div", {class: "fb-toolbar-fill"}),
                m("button", {
                    class: "pure-button",
                    onclick: function () {
                        window.open(HELP, "_blank");
                    },
                    title: (
                        "How platform administration works, in a page " +
                        "made to be read or printed"
                    )
                }, "Help")
            ]),
            (
                vm.screen === "packages"
                ? undefined
                : contextMenu(
                    (vm.menu || {}).of === "instance"
                    ? [
                        rows.status,
                        rows.maintenance,
                        rows.resume,
                        rows.move,
                        rows.template,
                        rows.drop
                    ]
                    : [
                        actions.edit,
                        actions.administrator,
                        actions.provider,
                        actions.instance,
                        actions.status
                    ]
                )
            ),
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
                vm.progress
                ? m("div", {class: "fb-admin-note"}, [
                    m("div", (
                        "Working: instance " + vm.progress.index + " of " +
                        vm.progress.total + "…"
                    )),
                    m("progress", {
                        class: "fb-admin-progress",
                        max: 100,
                        value: vm.progress.percentComplete
                    })
                ])
                : undefined
            ),
            (
                vm.form && vm.form.kind === "deploy"
                ? deployForm()
                : undefined
            ),
            (
                vm.form && INSTANCE_FORMS.indexOf(vm.form.kind) !== -1
                ? instanceForm()
                : undefined
            ),
            (
                vm.form && vm.form.kind !== "deploy" &&
                INSTANCE_FORMS.indexOf(vm.form.kind) === -1
                ? organizationForm()
                : undefined
            ),
            (
                vm.screen === "packages"
                ? packagesScreen()
                : undefined
            ),
            (
                vm.screen === "packages"
                ? undefined
                : m("div", {class: "fb-platform-panel"}, [
                m("div", {class: "fb-platform-section"}, "Organizations"),
                m("div", {class: "fb-list-toolbar"}, [
                    toolbarButton(actions.organization),
                    toolbarButton(actions.edit),
                    toolbarButton(actions.administrator),
                    toolbarButton(actions.provider),
                    toolbarButton(actions.instance),
                    toolbarButton(actions.status)
                ]),
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
                ]))
                ])
            ),
            (
                vm.screen === "packages"
                ? undefined
                : m("div", {class: "fb-platform-panel"}, [
                m("div", {class: "fb-platform-section"}, (
                    vm.onlyOrg && organization
                    ? "Instances \u2014 " + organization.name
                    : "Instances"
                )),
                m("div", {class: "fb-list-toolbar"}, [
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
                            ? "Deploy a package into the instances " +
                                "ticked below, one after another"
                            : "Tick the instances to deploy to"
                        )
                    }),
                    /*
                        The framework's counterpart of the group
                        deploy, and the same bargain: each instance is
                        held and let go in turn, so the outage rolls.
                    */
                    toolbarButton({
                        disabled: !pickedInstances().length,
                        key: "upgradeFleet",
                        label: "Upgrade",
                        run: function () {
                            let ids = pickedInstances().map(
                                (one) => one.id
                            );

                            vm.menu = undefined;
                            sendTracked(
                                "/platform/instances/upgrade",
                                {instances: ids},
                                ids,
                                "Upgraded"
                            );
                        },
                        title: (
                            pickedInstances().length
                            ? "Bring the instances ticked below up to " +
                                "Core " + vm.serverVersion + ", one " +
                                "after another. Each is held while its " +
                                "turn runs, and the first failure stops " +
                                "the rest."
                            : "Tick the instances to upgrade"
                        )
                    }),
                    toolbarButton(rows.status),
                    toolbarButton(rows.maintenance),
                    toolbarButton(rows.resume),
                    toolbarButton(rows.move),
                    toolbarButton(rows.template),
                    toolbarButton(rows.drop),
                    m("div", {class: "fb-toolbar-fill"}),
                    m("label", {
                        class: "fb-list-toolbar-check",
                        title: (
                            organization
                            ? "Show only the instances belonging to " +
                                organization.name
                            : "Select an organization above, and this " +
                                "narrows the list to its instances"
                        )
                    }, [
                        m("input", {
                            checked: vm.onlyOrg === true,
                            onclick: function (e) {
                                vm.onlyOrg = e.target.checked;
                            },
                            type: "checkbox"
                        }),
                        "Show selected organization's instances"
                    ])
                ]),
                m("div", {class: "fb-admin-scroll"}, m("table", {
                    class: "pure-table fb-admin-table"
                }, [
                    m("thead", m("tr", [
                        m("th", {
                            title: (
                                "Tick the instances to deploy a package " +
                                "to, then press Deploy"
                            )
                        }, "Deploy"),
                        m("th", "Organization"),
                        m("th", "Instance"),
                        m("th", "Database"),
                        m("th", "State"),
                        m("th", "Core"),
                        m("th", "Carries"),
                        m("th", "People")
                    ])),
                    m("tbody", visibleFleet().map(fleetRow))
                ]))
                ])
            ),
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
                return m("div", {class: "fb-platform-page"}, console_());
            }

            return m("div", {
                style: {margin: "0 auto", maxWidth: "48em", padding: "1em"}
            }, instanceList());
        }
    };

    m.mount(document.getElementById("fb-picker"), page);
}());
