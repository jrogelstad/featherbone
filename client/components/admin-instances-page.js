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
/*jslint this, browser, unordered*/
/*global f, m*/
/**
    Which databases this installation serves, and which organization
    they belong to.

    The manager holds the registry and is never routable (tenant plan
    section 9), so this page runs inside whatever instance the
    administrator is signed in to, next to the Users screen. Everything
    it does goes through `/:db/admin/...`, which decides what the
    caller may do; the page only hides what the answer says is not
    theirs.

    Registering here does not build a database: `node install.js
    --instance <name>` does that, and provisioning from the screen
    waits on tenant plan D.1.

    @module AdminInstancesPage
*/
const adminInstancesPage = {};

/**
    View model for the instances page.

    @class AdminInstancesPage
    @constructor
    @namespace ViewModels
*/
adminInstancesPage.viewModel = function () {
    let vm = {};
    let pathname = "/" + location.pathname.replaceAll("/", "");
    let entry = {
        database: f.prop(""),
        name: f.prop(""),
        service: f.prop("")
    };
    let build = {
        database: f.prop(""),
        name: f.prop(""),
        service: f.prop(""),
        template: f.prop("")
    };
    let dropEntry = {
        confirm: f.prop(""),
        instance: f.prop()
    };
    let tpl = {
        name: f.prop(""),
        source: f.prop("")
    };

    /*
        What a deployment is about to do: which installed package goes
        into which instance (ADR-002 section 6).
    */
    let dep = {
        instance: f.prop(),
        pick: f.prop("")
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
        What the server last told us: the organization, its instances,
        what this process is serving, the databases nothing is
        registered for, and the recent changes.
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
        Why the page is empty, when it is. An organization with no
        instances and a registry that could not be read are different
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
        @method registerDialog
        @return {ViewModels.Dialog}
    */
    vm.registerDialog = f.prop();
    /**
        @method createDialog
        @return {ViewModels.Dialog}
    */
    vm.createDialog = f.prop();
    /**
        @method dropDialog
        @return {ViewModels.Dialog}
    */
    vm.dropDialog = f.prop();
    /**
        @method templateDialog
        @return {ViewModels.Dialog}
    */
    vm.templateDialog = f.prop();
    /**
        @method deployDialog
        @return {ViewModels.Dialog}
    */
    vm.deployDialog = f.prop();
    /**
        @method buttonDone
        @return {ViewModels.Button}
    */
    vm.buttonDone = f.prop();

    /**
        Read everything again. Called on load and after every change:
        registering an instance changes what the server serves, so the
        answer moves more than one row.
        @method refresh
        @return {Promise}
    */
    vm.refresh = function () {
        return request("GET", "/admin/instances").then(function (resp) {
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
        Whether the caller may change the registry, as against only
        read the instance they are signed in to.
        @method isOrgWide
        @return {Boolean}
    */
    vm.isOrgWide = function () {
        let data = vm.overview() || {};

        return data.tier === "organization" || data.tier === "platform";
    };

    /**
        Whether the caller may build and drop databases, which is a
        platform administrator's power alone (ADR-001): the cluster is
        Featherbone's, not a tenant's.
        @method isPlatform
        @return {Boolean}
    */
    vm.isPlatform = function () {
        let data = vm.overview() || {};

        return data.tier === "platform";
    };

    /**
        @method doRegister
    */
    vm.doRegister = function () {
        let data = vm.overview() || {};
        let databases = data.databases || [];
        let services = data.services || [];

        entry.database(databases[0] || "");
        entry.name("");
        entry.service(
            services.length
            ? services[0].id
            : ""
        );
        vm.registerDialog().show();
    };

    /**
        @method doAttach
        @param {Object} instance
    */
    vm.doAttach = function (instance) {
        request("POST", "/admin/instance/organization", {
            id: instance.id
        }).then(vm.refresh).catch(fail);
    };

    /**
        Open an instance for sign-in, or close it. The database is
        left alone either way.
        @method doStatus
        @param {Object} instance
        @param {Boolean} isActive
    */
    vm.doStatus = function (instance, isActive) {
        request("POST", "/admin/instance/status", {
            id: instance.id,
            isActive
        }).then(vm.refresh).catch(fail);
    };

    /**
        Put an instance into maintenance, or take it out again. A
        deployment is not run under live traffic (ADR-002 question 7),
        so the state is thrown here when one is done by hand.
        @method doMaintenance
        @param {Object} instance
        @param {Boolean} isMaintenance
    */
    vm.doMaintenance = function (instance, isMaintenance) {
        request("POST", "/admin/instance/maintenance", {
            id: instance.id,
            isMaintenance
        }).then(vm.refresh).catch(fail);
    };

    /**
        @method doCreate
    */
    vm.doCreate = function () {
        let data = vm.overview() || {};
        let services = data.services || [];
        let templates = data.templates || [];

        build.name("");
        build.database("");
        build.template(templates[0] || "");
        build.service(
            services.length
            ? services[0].id
            : ""
        );
        vm.createDialog().show();
    };

    /**
        @method doDrop
        @param {Object} instance
    */
    vm.doDrop = function (instance) {
        dropEntry.instance(instance);
        dropEntry.confirm("");
        vm.dropDialog().show();
    };

    /**
        Pick an unfinished build up from the step it stopped at.
        @method doResume
        @param {Object} instance
    */
    vm.doResume = function (instance) {
        request("POST", "/admin/instance/provision/resume", {
            id: instance.id
        }).then(vm.refresh).catch(fail);
    };

    /**
        Build or rebuild the template copy of an instance.
        @method doTemplate
        @param {Object} instance
    */
    vm.doTemplate = function (instance) {
        tpl.source(instance.database);
        tpl.name(instance.database.slice(0, 52) + "_template");
        vm.templateDialog().show();
    };

    /**
        Apply an installed package to this instance. The instance is
        held while it runs and let go afterwards; a deployment that
        fails leaves it held, because the schema is then in a state
        nobody has checked (ADR-002 question 7).
        @method doDeploy
        @param {Object} instance
    */
    vm.doDeploy = function (instance) {
        let data = vm.overview() || {};
        let offered = data.packages || [];

        dep.instance(instance);
        dep.pick(
            offered.length
            ? offered[0].name + "@" + offered[0].version
            : ""
        );
        vm.deployDialog().show();
    };

    // ..........................................................
    // PRIVATE
    //

    vm.errorDialog(f.createViewModel("Dialog", {
        icon: "error",
        title: "Error"
    }));

    vm.registerDialog(f.createViewModel("Dialog", {
        icon: "storage",
        onOk: function () {
            request("POST", "/admin/instance", {
                database: entry.database(),
                name: entry.name(),
                service: entry.service()
            }).then(vm.refresh).catch(fail);
        },
        title: "Register a database"
    }));
    vm.registerDialog().content = function () {
        let data = vm.overview() || {};
        let databases = data.databases || [];
        let services = data.services || [];

        if (!databases.length) {
            return m("div", {class: "fb-admin-note"}, (
                "Every database in this cluster already has an instance " +
                "registered for it. Build one with \"node install.js " +
                "--instance <name>\" and it will show up here."
            ));
        }

        return m("div", {class: "pure-form pure-form-aligned"}, [
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbInstanceDb"}, "Database:"),
                m("select", {
                    id: "fbInstanceDb",
                    onchange: (e) => entry.database(e.target.value),
                    value: entry.database()
                }, databases.map(
                    (name) => m("option", {value: name}, name)
                ))
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbInstanceName"}, "Name:"),
                m("input", {
                    id: "fbInstanceName",
                    oninput: (e) => entry.name(e.target.value),
                    required: true,
                    value: entry.name()
                })
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbInstanceSvc"}, "Connection:"),
                m("select", {
                    id: "fbInstanceSvc",
                    onchange: (e) => entry.service(e.target.value),
                    value: entry.service()
                }, services.map(
                    (row) => m("option", {value: row.id}, (
                        row.name + " (" + row.user + "@" + row.host + ")"
                    ))
                ))
            ]),
            m("div", {class: "fb-admin-note"}, (
                "The database must already be a Featherbone instance. " +
                "This registers it so the server serves it at /" +
                entry.database() + "/ and the organization's users can " +
                "be granted access to it."
            ))
        ]);
    };

    vm.createDialog(f.createViewModel("Dialog", {
        icon: "add_circle",
        onOk: function () {
            request("POST", "/admin/instance/provision", {
                database: build.database(),
                name: build.name(),
                service: build.service(),
                template: build.template()
            }).then(function (resp) {
                if (resp && resp.state !== "active") {
                    fail(new Error(
                        "Provisioning stopped at \"" + resp.state +
                        "\": " + (resp.detail || "see the registry") +
                        ". Resume it from the instance row."
                    ));
                }
                return vm.refresh();
            }).catch(fail);
        },
        title: "Create an instance"
    }));
    vm.createDialog().content = function () {
        let data = vm.overview() || {};
        let services = data.services || [];
        let templates = data.templates || [];
        let instances = data.instances || [];
        let sources = templates.concat(
            (data.databases || []).filter(
                (name) => templates.indexOf(name) === -1
            ),
            instances.map((row) => row.database).filter(
                (name) => templates.indexOf(name) === -1
            )
        );

        return m("div", {class: "pure-form pure-form-aligned"}, [
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbBuildName"}, "Name:"),
                m("input", {
                    id: "fbBuildName",
                    oninput: (e) => build.name(e.target.value),
                    required: true,
                    value: build.name()
                })
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbBuildDb"}, "Database:"),
                m("input", {
                    id: "fbBuildDb",
                    oninput: (e) => build.database(e.target.value),
                    placeholder: "lowercase, letters and underscores",
                    required: true,
                    value: build.database()
                })
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbBuildTpl"}, "Template:"),
                m("select", {
                    id: "fbBuildTpl",
                    onchange: (e) => build.template(e.target.value),
                    value: build.template()
                }, sources.map(
                    (name) => m("option", {value: name}, name)
                ))
            ]),
            m("div", {class: "pure-control-group"}, [
                m("label", {for: "fbBuildSvc"}, "Connection:"),
                m("select", {
                    id: "fbBuildSvc",
                    onchange: (e) => build.service(e.target.value),
                    value: build.service()
                }, services.map(
                    (row) => m("option", {value: row.id}, (
                        row.name + " (" + row.user + "@" + row.host + ")"
                    ))
                ))
            ]),
            m("div", {class: "fb-admin-note"}, (
                "Clones the template into a new database, checks the " +
                "clone is an instance, grants every organization " +
                "administrator access, and opens it for sign-in. Each " +
                "step is recorded, so a build that stops can be " +
                "resumed from where it left off. A template that is a " +
                "live instance must be quiet while it is cloned."
            ))
        ]);
    };

    vm.dropDialog(f.createViewModel("Dialog", {
        icon: "delete",
        onOk: function () {
            let instance = dropEntry.instance() || {};

            request("POST", "/admin/instance/drop", {
                id: instance.id
            }).then(vm.refresh).catch(fail);
        },
        title: "Drop an instance"
    }));
    vm.dropDialog().content = function () {
        let instance = dropEntry.instance() || {};

        vm.dropDialog().okDisabled(
            dropEntry.confirm() !== instance.database
        );

        return m("div", [
            m("div", {class: "fb-admin-note"}, (
                "This drops the database \"" + instance.database +
                "\" and removes \"" + instance.name + "\" from the " +
                "registry. There is no undo short of a backup."
            )),
            m("div", {class: "pure-form"}, [
                m("label", {for: "fbDropConfirm"}, (
                    "Type the database name to confirm: "
                )),
                m("input", {
                    id: "fbDropConfirm",
                    oninput: (e) => dropEntry.confirm(e.target.value),
                    value: dropEntry.confirm()
                })
            ])
        ]);
    };

    vm.templateDialog(f.createViewModel("Dialog", {
        icon: "content_copy",
        onOk: function () {
            request("POST", "/admin/template", {
                name: tpl.name(),
                source: tpl.source()
            }).then(vm.refresh).catch(fail);
        },
        title: "Build a template"
    }));
    vm.templateDialog().content = function () {
        return m("div", [
            m("div", {class: "pure-form"}, [
                m("label", {for: "fbTplName"}, "Template name: "),
                m("input", {
                    id: "fbTplName",
                    oninput: (e) => tpl.name(e.target.value),
                    value: tpl.name()
                })
            ]),
            m("div", {class: "fb-admin-note"}, (
                "Copies \"" + tpl.source() + "\" into a frozen " +
                "database new instances are provisioned from, " +
                "replacing any template of that name in place. The " +
                "source must be quiet while it is copied: this server " +
                "lets go of its own connections, anyone else's make " +
                "the copy refuse."
            ))
        ]);
    };

    vm.deployDialog(f.createViewModel("Dialog", {
        icon: "publish",
        onOk: function () {
            let instance = dep.instance() || {};
            let pick = String(dep.pick());
            let at = pick.lastIndexOf("@");

            request("POST", "/admin/instance/deploy", {
                id: instance.id,
                module: pick.slice(0, at),
                version: pick.slice(at + 1)
            }).then(vm.refresh).catch(fail);
        },
        title: "Deploy a package"
    }));
    vm.deployDialog().content = function () {
        let data = vm.overview() || {};
        let offered = data.packages || [];
        let instance = dep.instance() || {};
        let carried = instance.modules || [];

        vm.deployDialog().okDisabled(!dep.pick());

        if (!offered.length) {
            return m("div", {class: "fb-admin-note"}, (
                "This server holds no packages. Install one with " +
                "`node install.js --package <file>`; nothing is " +
                "deployed by installing it."
            ));
        }

        return m("div", [
            m("div", {class: "pure-form"}, [
                m("label", {for: "fbDeployPick"}, "Package: "),
                m("select", {
                    id: "fbDeployPick",
                    onchange: (e) => dep.pick(e.target.value),
                    value: dep.pick()
                }, offered.map(function (one) {
                    let here = carried.find(
                        (mod) => mod.name === one.name
                    );

                    return m("option", {
                        key: one.name + "@" + one.version,
                        value: one.name + "@" + one.version
                    }, (
                        one.name + " " + one.version + (
                            here && here.version === one.version
                            ? " (deployed here)"
                            : ""
                        ) + (
                            here && here.version !== one.version
                            ? " (here: " + here.version + ")"
                            : ""
                        )
                    ));
                }))
            ]),
            m("div", {class: "fb-admin-note"}, (
                "Applies the package to \"" + instance.database +
                "\" and records the version there. The instance is " +
                "held while it runs: it answers 503 with an " +
                "explanation and only a platform administrator can " +
                "sign in. A deployment that fails leaves it held, " +
                "because the schema is then in a state nobody has " +
                "checked -- end the maintenance once you have."
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
    Instance administration page component.

    @class AdminInstancesPage
    @static
    @namespace Components
*/
adminInstancesPage.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {ViewModels.AdminInstancesPage} [vnode.attrs.viewModel]
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || adminInstancesPage.viewModel()
        );
    },
    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;
        let data = vm.overview() || {};
        let instances = data.instances || [];
        let orphans = data.orphans || [];
        let databases = data.databases || [];
        let audit = data.audit || [];
        let orgWide = vm.isOrgWide();
        let platform = vm.isPlatform();
        let provisioning = data.provisioning || {};

        /*
            What this server is doing with the instance, which is not
            the same as what the registry says: an instance registered
            a moment ago on another node, or one whose database cannot
            be reached, is registered and not being served here.
        */
        function served(instance) {
            if (!instance.isServed) {
                return m("span", {
                    class: "fb-admin-status fb-admin-status-disabled",
                    title: (
                        "This server has not loaded it. Registering is " +
                        "enough for this server; another one picks it " +
                        "up when it reads the registry."
                    )
                }, [
                    f.icon("cloud_off", "fb-admin-status-icon"),
                    "not loaded"
                ]);
            }

            if (!instance.isListening) {
                return m("span", {
                    class: "fb-admin-status fb-admin-status-locked",
                    title: (
                        "Loaded, but no event connection: changes in it " +
                        "will not reach anybody's screen until it is."
                    )
                }, [
                    f.icon("cloud_off", "fb-admin-status-icon"),
                    "no events"
                ]);
            }

            return m("span", {
                class: "fb-admin-status fb-admin-status-active",
                title: "Loaded, with its event connection open"
            }, [
                f.icon("cloud_done", "fb-admin-status-icon"),
                "serving"
            ]);
        }

        function status(instance) {
            let pending = provisioning[instance.id];

            if (pending) {
                return m("span", {
                    class: "fb-admin-status fb-admin-status-locked",
                    title: (
                        pending.detail
                        ? (
                            "Provisioning stopped at \"" + pending.state +
                            "\": " + pending.detail
                        )
                        : "Being built; stopped at \"" + pending.state + "\""
                    )
                }, [
                    f.icon("schedule", "fb-admin-status-icon"),
                    pending.state
                ]);
            }

            if (instance.isMaintenance) {
                return m("span", {
                    class: "fb-admin-status fb-admin-status-locked",
                    title: (
                        "Down for a deployment: it answers nothing but " +
                        "its sign-in and these screens, and only a " +
                        "platform administrator can sign in"
                    )
                }, [
                    f.icon("build", "fb-admin-status-icon"),
                    "maintenance"
                ]);
            }

            return m("span", {
                class: (
                    "fb-admin-status fb-admin-status-" + (
                        instance.isActive
                        ? "active"
                        : "disabled"
                    )
                )
            }, [
                f.icon(
                    (
                        instance.isActive
                        ? "check_circle"
                        : "block"
                    ),
                    "fb-admin-status-icon"
                ),
                (
                    instance.isActive
                    ? "open"
                    : "closed"
                )
            ]);
        }

        /*
            What this instance carries, and whether the server holds a
            newer package for it (ADR-002: the fleet view). An upgrade
            across many instances is a rolling outage, which is why
            this says how many are behind rather than offering to do
            them all at once.
        */
        function modules(instance) {
            let carried = instance.modules;

            if (!carried) {
                return m("span", {
                    class: "fb-admin-muted",
                    title: instance.modulesError || ""
                }, "unknown");
            }

            if (!carried.length) {
                return m("span", {class: "fb-admin-muted"}, "none");
            }

            return m("span", {
                title: carried.map(function (mod) {
                    return mod.name + " " + mod.version + (
                        mod.isBehind
                        ? " (server holds " + mod.newest + ")"
                        : ""
                    ) + (
                        mod.isOnDisk
                        ? ""
                        : " -- code from the database"
                    );
                }).join("\n")
            }, [
                String(carried.length) + (
                    carried.length === 1
                    ? " module"
                    : " modules"
                ),
                (
                    instance.behind
                    ? m("span", {
                        class: "fb-admin-tag",
                        title: (
                            instance.behind +
                            " behind the packages on this server"
                        )
                    }, instance.behind + " behind")
                    : undefined
                )
            ]);
        }

        /*
            fb-button-disabled restores the pointer events Pure takes
            away from a disabled .pure-button. Without it the browser
            never hovers the button, so the title saying why it is
            disabled is never seen.
        */
        function action(label, title, disabled, onclick) {
            return m("button", {
                class: (
                    "pure-button fb-admin-action" + (
                        disabled
                        ? " fb-button-disabled"
                        : ""
                    )
                ),
                disabled,
                onclick,
                title
            }, label);
        }

        function actions(instance) {
            let list = [];
            let pending = provisioning[instance.id];

            if (!orgWide) {
                return list;
            }

            if (pending) {
                list.push(action(
                    "Resume",
                    "Pick the build up from where it stopped",
                    !platform,
                    () => vm.doResume(instance)
                ));
            } else if (instance.isActive) {
                list.push(action(
                    "Close",
                    (
                        instance.isCurrent
                        ? (
                            "This is the instance you are signed in " +
                            "to. Close it from another one."
                        )
                        : "Stop anyone signing in to this instance"
                    ),
                    instance.isCurrent,
                    () => vm.doStatus(instance, false)
                ));
            } else {
                list.push(action(
                    "Open",
                    "Let people sign in to this instance again",
                    false,
                    () => vm.doStatus(instance, true)
                ));
            }

            if (instance.isMaintenance) {
                list.push(action(
                    "End maintenance",
                    (
                        platform
                        ? "Let the instance answer requests again"
                        : "Only a platform administrator may do this"
                    ),
                    !platform,
                    () => vm.doMaintenance(instance, false)
                ));
            } else {
                list.push(action(
                    "Maintenance",
                    (
                        platform
                        ? (
                            "Hold the instance for a deployment: it " +
                            "answers 503 with an explanation, and only " +
                            "a platform administrator can sign in"
                        )
                        : "Only a platform administrator may do this"
                    ),
                    !platform,
                    () => vm.doMaintenance(instance, true)
                ));
            }

            list.push(action(
                "Deploy",
                (
                    platform
                    ? (
                        "Apply a package this server holds to this " +
                        "instance, holding it while that runs"
                    )
                    : "Only a platform administrator may deploy"
                ),
                !platform,
                () => vm.doDeploy(instance)
            ));

            list.push(action(
                "Template",
                (
                    platform
                    ? (
                        "Copy this instance into the template new " +
                        "instances are built from"
                    )
                    : "Only a platform administrator may build a template"
                ),
                !platform,
                () => vm.doTemplate(instance)
            ));

            list.push(action(
                "Drop",
                (
                    !platform
                    ? (
                        "Only a platform administrator may drop a " +
                        "database"
                    )
                    : (
                        instance.isCurrent
                        ? (
                            "This is the instance you are signed in " +
                            "to. Drop it from another one."
                        )
                        : (
                            "Drop the database and remove it from " +
                            "the registry"
                        )
                    )
                ),
                !platform || instance.isCurrent,
                () => vm.doDrop(instance)
            ));

            return list;
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
                    class: (
                        "pure-button fb-toolbar-button" + (
                            orgWide
                            ? ""
                            : " fb-button-disabled"
                        )
                    ),
                    disabled: !orgWide,
                    onclick: vm.doRegister,
                    title: (
                        orgWide
                        ? "Register a database in this cluster as an instance"
                        : (
                            "Only an organization administrator may " +
                            "change the registry"
                        )
                    )
                }, "Register database"),
                m("button", {
                    class: (
                        "pure-button fb-toolbar-button" + (
                            platform
                            ? ""
                            : " fb-button-disabled"
                        )
                    ),
                    disabled: !platform,
                    onclick: vm.doCreate,
                    title: (
                        platform
                        ? "Build a new instance database from a template"
                        : (
                            "Only a platform administrator may create " +
                            "a database"
                        )
                    )
                }, "Create instance"),
                m("button", {
                    class: "pure-button fb-toolbar-button",
                    onclick: vm.refresh,
                    title: "Read the registry again"
                }, "Refresh")
            ]),
            m("div", {class: "fb-title"}, [
                f.icon("storage", "fb-title-icon"),
                m("label", (
                    data.organization
                    ? "Instances of " + data.organization.name
                    : "Instances"
                ))
            ]),
            m(f.getComponent("Dialog"), {viewModel: vm.errorDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.registerDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.createDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.deployDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.dropDialog()}),
            m(f.getComponent("Dialog"), {viewModel: vm.templateDialog()}),
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
                data.manager
                ? m("div", {class: "fb-admin-meta"}, [
                    m("span", (
                        "The manager is \"" + data.manager.database +
                        "\". It holds this registry, the identities and " +
                        "the sessions, and is never served at a URL."
                    )),
                    (
                        orgWide
                        ? undefined
                        : m("span", {class: "fb-admin-muted"}, (
                            " You are seeing the instance you are signed " +
                            "in to; the rest of the registry is an " +
                            "organization administrator's to see."
                        ))
                    )
                ])
                : undefined
            ),
            m("div", {class: "fb-table-scroll fb-admin-scroll"}, [
                m("table", {class: "fb-table fb-admin-table"}, [
                    m("thead", [
                        m("tr", [
                            m("th", {class: "fb-admin-col-user"}, "Name"),
                            m("th", {class: "fb-admin-col-name"}, "Database"),
                            m("th", {class: "fb-admin-col-name"}, "Connection"),
                            m("th", {class: "fb-admin-col-status"}, "Users"),
                            m("th", {class: "fb-admin-col-grants"}, "Serving"),
                            m("th", {class: "fb-admin-col-name"}, "Modules"),
                            m("th", {class: "fb-admin-col-status"}, "Sign-in"),
                            m("th", {class: "fb-admin-col-actions"}, "")
                        ])
                    ]),
                    m("tbody", instances.map(function (instance) {
                        return m("tr", {key: instance.id}, [
                            m("td", [
                                instance.name,
                                (
                                    instance.isCurrent
                                    ? m("span", {
                                        class: "fb-admin-tag"
                                    }, "you are here")
                                    : undefined
                                ),
                                (
                                    instance.isDemo
                                    ? m("span", {
                                        class: "fb-admin-tag"
                                    }, "demo")
                                    : undefined
                                ),
                                (
                                    (
                                        instance.isDemo &&
                                        instance.expiration &&
                                        new Date(
                                            instance.expiration
                                        ) < new Date()
                                    )
                                    ? m("span", {
                                        class: "fb-admin-tag",
                                        title: (
                                            "Expired " + new Date(
                                                instance.expiration
                                            ).toLocaleString() +
                                            "; the sweep closes it"
                                        )
                                    }, "expired")
                                    : undefined
                                )
                            ]),
                            m("td", {title: instance.database}, (
                                instance.database
                            )),
                            m("td", (
                                instance.service
                                ? m("span", {
                                    title: (
                                        instance.service.user + "@" +
                                        instance.service.host + ":" +
                                        instance.service.port
                                    )
                                }, instance.service.name)
                                : m("span", {
                                    class: "fb-admin-muted"
                                }, "none")
                            )),
                            m("td", instance.users),
                            m("td", served(instance)),
                            m("td", modules(instance)),
                            m("td", status(instance)),
                            m("td", {
                                class: "fb-admin-col-actions"
                            }, actions(instance))
                        ]);
                    }))
                ])
            ]),
            (
                (
                    !vm.isLoading() &&
                    !vm.loadError() &&
                    !instances.length
                )
                ? m("div", {class: "fb-admin-note"}, (
                    "No instance is registered to this organization yet."
                ))
                : undefined
            ),
            (
                orphans.length
                ? m("div", [
                    m("div", {class: "fb-title fb-admin-subtitle"}, [
                        f.icon("help", "fb-title-icon"),
                        m("label", "Registered to no organization")
                    ]),
                    m("div", {class: "fb-admin-note"}, (
                        "These were registered before organizations " +
                        "existed. Attaching one does not touch its " +
                        "database; it decides whose users can be granted " +
                        "access to it."
                    )),
                    m("div", {class: "fb-table-scroll fb-admin-scroll"}, [
                        m("table", {class: "fb-table fb-admin-table"}, [
                            m("thead", [
                                m("tr", [
                                    m("th", {
                                        class: "fb-admin-col-user"
                                    }, "Name"),
                                    m("th", {
                                        class: "fb-admin-col-name"
                                    }, "Database"),
                                    m("th", {
                                        class: "fb-admin-col-actions"
                                    }, "")
                                ])
                            ]),
                            m("tbody", orphans.map(function (row) {
                                return m("tr", {key: row.id}, [
                                    m("td", row.name),
                                    m("td", row.database),
                                    m("td", {
                                        class: "fb-admin-col-actions"
                                    }, [
                                        action(
                                            "Attach",
                                            (
                                                "Make this an instance of " +
                                                (
                                                    data.organization
                                                    ? data.organization.name
                                                    : "this organization"
                                                )
                                            ),
                                            false,
                                            () => vm.doAttach(row)
                                        )
                                    ])
                                ]);
                            }))
                        ])
                    ])
                ])
                : undefined
            ),
            (
                (orgWide && databases.length)
                ? m("div", {class: "fb-admin-note"}, (
                    "Databases in this cluster with no instance " +
                    "registered for them: " + databases.join(", ") + "."
                ))
                : undefined
            ),
            (
                audit.length
                ? m("div", [
                    m("div", {class: "fb-title fb-admin-subtitle"}, [
                        f.icon("history", "fb-title-icon"),
                        m("label", "Recent changes")
                    ]),
                    m("div", {class: "fb-table-scroll fb-admin-scroll"}, [
                        m("table", {class: "fb-table fb-admin-table"}, [
                            m("thead", [
                                m("tr", [
                                    m("th", {
                                        class: "fb-admin-col-seen"
                                    }, "When"),
                                    m("th", {
                                        class: "fb-admin-col-status"
                                    }, "Action"),
                                    m("th", {
                                        class: "fb-admin-col-user"
                                    }, "By"),
                                    m("th", "Detail")
                                ])
                            ]),
                            m("tbody", audit.map(function (row) {
                                return m("tr", {key: row.id}, [
                                    m("td", (
                                        new Date(
                                            row.occurred
                                        ).toLocaleString()
                                    )),
                                    m("td", {title: row.action}, row.action),
                                    m("td", row.author || ""),
                                    m("td", {
                                        title: row.detail || ""
                                    }, row.detail || "")
                                ]);
                            }))
                        ])
                    ])
                ])
                : undefined
            ),
            m("div", {class: "fb-admin-note"}, (
                "\"node install.js --instance <name>\" still works " +
                "from the command line and registers what it builds " +
                "here."
            ))
        ]);
    }
};

f.catalog().register(
    "components",
    "adminInstancesPage",
    adminInstancesPage.component
);
