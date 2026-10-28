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
/*jslint browser unordered*/
/*global f, m*/
/**
    What this instance runs: the framework, the modules it deployed and
    the software underneath, with the way to the REST API reference.
    Opened from the ribbon's Info button.

    @module AboutDialog
*/

const aboutDialog = {};

/**
    @class AboutDialog
    @namespace ViewModels
    @constructor
*/
aboutDialog.viewModel = function () {
    let vm = f.createViewModel("Dialog", {
        icon: "info",
        title: "About",
        isTitleLiteral: true
    });
    let info;
    let failed;
    let db = location.pathname.split("/")[1];

    function row(name, version, cls) {
        return m("tr", {class: cls}, [
            m("td", name),
            m("td", {class: "fb-about-version"}, version)
        ]);
    }

    function table(caption, rows) {
        return m("table", {class: "fb-about-table"}, [
            m("caption", caption),
            m("tbody", rows)
        ]);
    }

    function framework() {
        let version = info.version;

        // Code ahead of the instance until it is upgraded
        if (info.deployedVersion && info.deployedVersion !== version) {
            version += " (instance at " + info.deployedVersion + ")";
        }

        return version;
    }

    /**
        Fetch and show.
        @method open
    */
    vm.open = function () {
        info = undefined;
        failed = undefined;
        vm.show();
        m.request({
            method: "GET",
            url: "/" + db + "/about"
        }).then(function (resp) {
            info = resp;
        }).catch(function (err) {
            failed = (
                (err && err.response) ||
                "Could not read version information"
            );
        });
    };

    /**
        Open the REST API reference in its own tab.
        @method openApi
    */
    vm.openApi = function () {
        window.open("/" + db + "/api", "featherbone-api");
    };

    vm.content = function () {
        if (failed) {
            return m("p", {class: "fb-about-error"}, String(failed));
        }
        if (!info) {
            return m("p", {class: "fb-about-loading"}, "Loading…");
        }

        return m("div", {class: "fb-about"}, [
            m("h4", {class: "fb-about-name"}, info.name),
            m("p", {class: "fb-about-description"}, info.description),
            table("Framework", [row(info.name, framework())]),
            (
                info.modules.length
                ? table("Modules", info.modules.map((mod) => row(
                    mod.name,
                    mod.version,
                    (
                        mod.parent
                        ? "fb-about-child"
                        : undefined
                    )
                )))
                : undefined
            ),
            table("Infrastructure", info.infrastructure.map(
                (item) => row(item.name, item.version)
            )),
            m("button[type=button]", {
                class: "pure-button fb-about-api",
                title: "Open the REST API reference in a new tab",
                onclick: vm.openApi
            }, [f.icon("code"), "REST API"])
        ]);
    };

    vm.buttonOk().label("&Close");
    vm.buttons([vm.buttonOk]);
    vm.style({width: "480px", maxWidth: "calc(100vw - 32px)"});

    return vm;
};

f.catalog().register("viewModels", "aboutDialog", aboutDialog.viewModel);
