/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
/**
    Who may sign in, and to which instances.

    The manager database holds the answer and is not routable (tenant
    plan section 9), so this page runs inside whatever instance the
    administrator is signed in to and shows that instance's
    organization. Everything it does goes through `/:db/admin/...`,
    which decides what the caller is allowed to do; this page only
    hides what the answer says is not theirs (`tier`), so a disabled
    button is never the only thing standing between a reader and a
    change.

    @module AdminPage
*/
const adminPage = {};

const STATUS_ICON = {
    active: "check_circle",
    disabled: "block",
    locked: "lock"
};

/**
    View model for the identity administration page.

    @class AdminPage
    @constructor
    @namespace ViewModels
*/
adminPage.viewModel = function () {
    let vm = {};
    let pathname = "/" + location.pathname.replaceAll("/", "");
    let newUser = {
        email: f.prop(""),
        fullName: f.prop(""),
        password: f.prop(""),
        username: f.prop("")
    };
    let pwd = {
        confirm: f.prop(""),
        id: f.prop(""),
        password: f.prop(""),
        username: f.prop("")
    };
    let grant = {
        id: f.prop(""),
        instance: f.prop(""),
        username: f.prop("")
    };

    function request(method, path, body) {
        return m.request({
            body,
            method,
            url: pathname + path
        });
    }

    function fail(err) {
        vm.errorDialog().message(err.message || String(err));
        vm.errorDialog().show();
    }

    /**
        What the server last told us: organization, instances,
        identities, audit trail, the caller's tier and which sign-in
        strategy is in force.
        @method overview
        @return {Object}
    */
    vm.overview = f.prop();
    /**
        @method isLoading
        @return {Boolean}
    */
    vm.isLoading = f.prop(true);
    /**
        Why the page is empty, when it is: the registry could not be
        read. An empty organization and an unreadable one are different
        answers and must not look alike.
        @method loadError
        @return {String}
    */
    vm.loadError = f.prop("");
    /**
        @method errorDialog
        @return {ViewModels.Dialog}
    */
    vm.errorDialog = f.prop();
    /**
        @method addUserDialog
        @return {ViewModels.Dialog}
    */
    vm.addUserDialog = f.prop();
    /**
        @method passwordDialog
        @return {ViewModels.Dialog}
    */
    vm.passwordDialog = f.prop();
    /**
        @method grantDialog
        @return {ViewModels.Dialog}
    */
    vm.grantDialog = f.prop();
    /**
        @method buttonDone
        @return {ViewModels.Button}
    */
    vm.buttonDone = f.prop();

    /**
        Read everything again. Called on load and after every change,
        because a change to one identity can move another row (a grant
        that was the last one, an administrator who just lost the flag).
        @method refresh
        @return {Promise}
    */
    vm.refresh = function () {
        return request("GET", "/admin/overview").then(function (resp) {
            vm.loadError("");
            vm.overview(resp);
            vm.isLoading(false);
            m.redraw();
        }).catch(function (err) {
            vm.isLoading(false);
            vm.loadError(err.message || String(err));
            fail(err);
            m.redraw();
        });
    };

    /**
        Whether the caller may act on the whole organization, as
        against only the instance they are signed in to.
        @method isOrgWide
        @return {Boolean}
    */
    vm.isOrgWide = function () {
        let data = vm.overview() || {};

        return data.tier === "organization" || data.tier === "platform";
    };

    /**
        The instances this caller may grant: all of the organization's
        for an organization administrator, otherwise only the one they
        are signed in to.
        @method grantableInstances
        @return {Array}
    */
    vm.grantableInstances = function () {
        let data = vm.overview() || {};
        let instances = data.instances || [];

        if (vm.isOrgWide()) {
            return instances;
        }

        return instances.filter((row) => row.id === data.instance);
    };

    /**
        @method doAddUser
    */
    vm.doAddUser = function () {
        newUser.email("");
        newUser.fullName("");
        newUser.password("");
        newUser.username("");
        vm.addUserDialog().show();
    };

    /**
        @method doSetPassword
        @param {Object} identity
    */
    vm.doSetPassword = function (identity) {
        pwd.confirm("");
        pwd.id(identity.id);
        pwd.password("");
        pwd.username(identity.username);
        vm.passwordDialog().show();
    };

    /**
        @method doGrant
        @param {Object} identity
    */
    vm.doGrant = function (identity) {
        let first = vm.grantableInstances()[0];

        grant.id(identity.id);
        grant.instance(
            first
            ? first.id
            : ""
        );
        grant.username(identity.username);
        vm.grantDialog().show();
    };

    /**
        Release a locked account, or disable and re-enable one.
        @method doStatus
        @param {Object} identity
        @param {String} status
    */
    vm.doStatus = function (identity, status) {
        request("POST", "/admin/identity/status", {
            id: identity.id,
            status
        }).then(vm.refresh).catch(fail);
    };

    /**
        @method doRevoke
        @param {Object} identity
        @param {String} instance
    */
    vm.doRevoke = function (identity, instance) {
        request("POST", "/admin/grant", {
            id: identity.id,
            instance,
            isActive: false
        }).then(vm.refresh).catch(fail);
    };

    /**
        @method doOrgAdmin
        @param {Object} identity
        @param {Boolean} isOrgAdmin
    */
    vm.doOrgAdmin = function (identity, isOrgAdmin) {
        request("POST", "/admin/identity/org-admin", {
            id: identity.id,
            isOrgAdmin
        }).then(vm.refresh).catch(fail);
    };

    // ..........................................................
    // PRIVATE
    //

    vm.errorDialog(f.createViewModel("Dialog", {
        icon: "error",
        title: "Error"
    }));

    vm.addUserDialog(f.createViewModel("Dialog", {
        icon: "person_add",
        onOk: function () {
            request("POST", "/admin/identity", {
                email: newUser.email(),
                fullName: newUser.fullName(),
                password: newUser.password(),
                username: newUser.username()
            }).then(vm.refresh).catch(fail);
        },
        title: "Add user"
    }));
    vm.addUserDialog().content = function () {
        return m("div", {class: "pure-form pure-form-aligned"}, [
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbAdminNewName"}, "User name:"),
                m("input", {
                    id: "fbAdminNewName",
                    oninput: (e) => newUser.username(e.target.value),
                    required: true,
                    value: newUser.username()
                })
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbAdminNewFull"}, "Full name:"),
                m("input", {
                    id: "fbAdminNewFull",
                    oninput: (e) => newUser.fullName(e.target.value),
                    value: newUser.fullName()
                })
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbAdminNewEmail"}, "Email:"),
                m("input", {
                    id: "fbAdminNewEmail",
                    oninput: (e) => newUser.email(e.target.value),
                    type: "email",
                    value: newUser.email()
                })
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbAdminNewPwd"}, "Password:"),
                m("input", {
                    autocomplete: "new-password",
                    id: "fbAdminNewPwd",
                    oninput: (e) => newUser.password(e.target.value),
                    type: "password",
                    value: newUser.password()
                })
            ]),
            m("div", {class: "fb-admin-note"}, (
                "Creates the identity and grants it this instance. The " +
                "person also needs a user account here before they can " +
                "sign in, which is what the Users worksheet maintains."
            ))
        ]);
    };

    vm.passwordDialog(f.createViewModel("Dialog", {
        icon: "key",
        onOk: function () {
            if (pwd.password() !== pwd.confirm()) {
                fail(new Error("The passwords do not match"));
                return;
            }

            request("POST", "/admin/identity/password", {
                id: pwd.id(),
                password: pwd.password()
            }).then(vm.refresh).catch(fail);
        },
        title: "Set password"
    }));
    vm.passwordDialog().content = function () {
        return m("div", {class: "pure-form pure-form-aligned"}, [
            m("div", {class: "fb-admin-note"}, (
                "One password serves every instance " + pwd.username() +
                " can reach."
            )),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbAdminPwd"}, "New password:"),
                m("input", {
                    autocomplete: "new-password",
                    id: "fbAdminPwd",
                    oninput: (e) => pwd.password(e.target.value),
                    type: "password",
                    value: pwd.password()
                })
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbAdminPwd2"}, "Confirm:"),
                m("input", {
                    autocomplete: "new-password",
                    id: "fbAdminPwd2",
                    oninput: (e) => pwd.confirm(e.target.value),
                    type: "password",
                    value: pwd.confirm()
                })
            ])
        ]);
    };

    vm.grantDialog(f.createViewModel("Dialog", {
        icon: "key",
        onOk: function () {
            request("POST", "/admin/grant", {
                id: grant.id(),
                instance: grant.instance(),
                isActive: true
            }).then(vm.refresh).catch(fail);
        },
        title: "Grant an instance"
    }));
    vm.grantDialog().content = function () {
        return m("div", {class: "pure-form pure-form-aligned"}, [
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbAdminGrant"}, "Instance:"),
                m("select", {
                    id: "fbAdminGrant",
                    onchange: (e) => grant.instance(e.target.value),
                    value: grant.instance()
                }, vm.grantableInstances().map(
                    (row) => m("option", {value: row.id}, row.name)
                ))
            ]),
            m("div", {class: "fb-admin-note"}, (
                grant.username() + " will be able to sign in to it. The " +
                "account the instance keeps is made for them the first " +
                "time they do."
            ))
        ]);
    };

    vm.buttonDone(f.createViewModel("Button", {
        class: "fb-toolbar-button",
        label: "&Done",
        onclick: () => window.history.back()
    }));

    vm.refresh();

    return vm;
};

/**
    Identity administration page component.

    @class AdminPage
    @static
    @namespace Components
*/
adminPage.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {ViewModels.AdminPage} [vnode.attrs.viewModel]
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || adminPage.viewModel()
        );
    },
    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;
        let data = vm.overview() || {};
        let identities = data.identities || [];
        let instances = data.instances || [];
        let audit = data.audit || [];
        let orgWide = vm.isOrgWide();

        function status(identity) {
            return m("span", {
                class: (
                    "fb-admin-status fb-admin-status-" + identity.status
                )
            }, [
                f.icon(
                    STATUS_ICON[identity.status] || "help",
                    "fb-admin-status-icon"
                ),
                identity.status
            ]);
        }

        function grants(identity) {
            if (!identity.grants.length) {
                return m("span", {class: "fb-admin-muted"}, "none");
            }

            return identity.grants.map(function (row) {
                return m("span", {
                    class: (
                        "fb-admin-grant" + (
                            row.isActive
                            ? ""
                            : " fb-admin-grant-off"
                        )
                    ),
                    onclick: (
                        row.isActive
                        ? () => vm.doRevoke(identity, row.instance)
                        : undefined
                    ),
                    title: (
                        row.isActive
                        ? "Revoke " + row.name
                        : "Revoked"
                    )
                }, row.name);
            });
        }

        function actions(identity) {
            let buttons = [];
            /*
                An instance administrator may only act on people who can
                already reach the instance they are signed in to. The
                server refuses the rest; showing the buttons anyway
                would make the refusal look like a fault.
            */
            let mine = identity.grants.some(
                (row) => row.instance === data.instance
            );
            let why = (
                "Only an organization administrator can change " +
                identity.username + ", who has no access to this instance"
            );

            function add(label, title, onclick) {
                buttons.push(m("button", {
                    class: (
                        "pure-button fb-admin-action" + (
                            (orgWide || mine)
                            ? ""
                            : " pure-button-disabled"
                        )
                    ),
                    disabled: !(orgWide || mine),
                    onclick: (
                        (orgWide || mine)
                        ? onclick
                        : undefined
                    ),
                    title: (
                        (orgWide || mine)
                        ? title
                        : why
                    )
                }, label));
            }

            if (identity.status === "locked") {
                add(
                    "Unlock",
                    "Release the lock and let them sign in again",
                    () => vm.doStatus(identity, "active")
                );
            } else if (identity.status === "active") {
                add(
                    "Disable",
                    "Stop this identity signing in anywhere",
                    () => vm.doStatus(identity, "disabled")
                );
            } else {
                add(
                    "Enable",
                    "Let this identity sign in again",
                    () => vm.doStatus(identity, "active")
                );
            }

            add(
                "Password",
                "Set this person's password",
                () => vm.doSetPassword(identity)
            );
            add(
                "Grant",
                "Give this person another instance",
                () => vm.doGrant(identity)
            );

            if (orgWide) {
                add(
                    (
                        identity.isOrgAdmin
                        ? "Unadmin"
                        : "Make admin"
                    ),
                    (
                        identity.isOrgAdmin
                        ? "Stop this person administering the organization"
                        : "Let this person administer the organization"
                    ),
                    () => vm.doOrgAdmin(identity, !identity.isOrgAdmin)
                );
            }

            return buttons;
        }

        return m("div", [
            m(f.getComponent("EnvBanner")),
            m("div", {
                class: "fb-toolbar",
                id: "toolbar"
            }, [
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonDone()
                }),
                m("button", {
                    class: "pure-button fb-toolbar-button",
                    onclick: vm.doAddUser,
                    title: "Add a user to this organization"
                }, "Add user"),
                m("button", {
                    class: "pure-button fb-toolbar-button",
                    onclick: vm.refresh,
                    title: "Read the registry again"
                }, "Refresh")
            ]),
            m("div", {class: "fb-title"}, [
                f.icon("manage_accounts", "fb-title-icon"),
                m("label", (
                    data.organization
                    ? "Users of " + data.organization.name
                    : "Users"
                ))
            ]),
            m(f.getComponent("Dialog"), {viewModel: vm.errorDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.addUserDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.passwordDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.grantDialog()}),
            (
                data.authStrategy === "role"
                ? m("div", {class: "fb-admin-banner"}, [
                    f.icon("info", "fb-admin-status-icon"),
                    (
                        "Sign-in is still checking passwords against " +
                        "Postgres roles. These records are real and are " +
                        "what identity sign-in will use; they do not " +
                        "decide sign-in until authStrategy is identity."
                    )
                ])
                : undefined
            ),
            (
                vm.isLoading()
                ? m("div", {class: "fb-admin-note"}, "Reading the registry…")
                : undefined
            ),
            (
                vm.loadError()
                ? m("div", {class: "fb-admin-note"}, (
                    "The registry could not be read: " + vm.loadError()
                ))
                : undefined
            ),
            (
                (
                    !vm.isLoading() &&
                    !vm.loadError() &&
                    !identities.length
                )
                ? m("div", {class: "fb-admin-note"}, (
                    "This organization has no identities yet. Users " +
                    "created here, or by the migration script, show up " +
                    "in this list."
                ))
                : undefined
            ),
            (
                data.organization
                ? m("div", {class: "fb-admin-meta"}, [
                    m("span", (
                        "You are signed in as " + (data.actor || "") +
                        " with " + (
                            data.tier === "platform"
                            ? "platform administrator"
                            : (
                                data.tier === "organization"
                                ? "organization administrator"
                                : "this instance's"
                            )
                        ) + " authority."
                    )),
                    (
                        orgWide
                        ? undefined
                        : m("span", {class: "fb-admin-muted"}, (
                            " Only people who can already reach this " +
                            "instance can be changed from here."
                        ))
                    )
                ])
                : undefined
            ),
            m("div", {class: "fb-table-scroll fb-admin-scroll"}, [
                m("table", {class: "fb-table fb-admin-table"}, [
                    m("thead", [
                        m("tr", [
                            m("th", {class: "fb-admin-col-user"}, "User"),
                            m("th", {class: "fb-admin-col-name"}, "Name"),
                            m("th", {class: "fb-admin-col-status"}, "Status"),
                            m("th", {class: "fb-admin-col-grants"}, "Instances"),
                            m("th", {class: "fb-admin-col-seen"}, "Last sign-in"),
                            m("th", {class: "fb-admin-col-actions"}, "")
                        ])
                    ]),
                    m("tbody", identities.map(function (identity) {
                        return m("tr", {key: identity.id}, [
                            m("td", {title: identity.username}, [
                                identity.username,
                                (
                                    identity.isPlatformAdmin
                                    ? m("span", {
                                        class: "fb-admin-tag"
                                    }, "platform")
                                    : undefined
                                ),
                                (
                                    identity.isOrgAdmin
                                    ? m("span", {
                                        class: "fb-admin-tag"
                                    }, "admin")
                                    : undefined
                                )
                            ]),
                            m("td", {
                                title: identity.email || ""
                            }, identity.fullName),
                            m("td", status(identity)),
                            m("td", grants(identity)),
                            m("td", (
                                identity.lastSignedIn
                                ? new Date(
                                    identity.lastSignedIn
                                ).toLocaleString()
                                : m("span", {class: "fb-admin-muted"}, "never")
                            )),
                            m("td", {
                                class: "fb-admin-col-actions"
                            }, actions(identity))
                        ]);
                    }))
                ])
            ]),
            m("div", {class: "fb-title fb-admin-subtitle"}, [
                f.icon("history", "fb-title-icon"),
                m("label", "Recent changes")
            ]),
            m("div", {class: "fb-table-scroll fb-admin-scroll"}, [
                m("table", {class: "fb-table fb-admin-table"}, [
                    m("thead", [
                        m("tr", [
                            m("th", {class: "fb-admin-col-seen"}, "When"),
                            m("th", {class: "fb-admin-col-status"}, "Action"),
                            m("th", {class: "fb-admin-col-user"}, "By"),
                            m("th", {class: "fb-admin-col-user"}, "To"),
                            m("th", "Detail")
                        ])
                    ]),
                    m("tbody", audit.map(function (row) {
                        return m("tr", {key: row.id}, [
                            m("td", new Date(row.occurred).toLocaleString()),
                            m("td", {title: row.action}, row.action),
                            m("td", row.actor || ""),
                            m("td", row.target || ""),
                            m("td", {title: row.detail || ""}, row.detail || "")
                        ]);
                    }))
                ])
            ]),
            m("div", {class: "fb-admin-note"}, (
                "Instances in this organization: " + (
                    instances.length
                    ? instances.map((row) => row.name).join(", ")
                    : "none"
                )
            ))
        ]);
    }
};

f.catalog().register("components", "adminPage", adminPage.component);
