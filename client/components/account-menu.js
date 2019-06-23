/*
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
*/
/*jslint this, browser*/
/**
    @module AccountMenu
*/
import f from "../core.js";
import catalog from "../models/catalog.js";

const m = window.m;
const accountMenu = {};

/**
    @class AccountMenu
    @namespace ViewModels
    @constructor
*/
accountMenu.viewModel = function () {
    const vm = {};

    /**
        @method showMenuAccount
    */
    vm.showMenuAccount = f.prop(false);

    return vm;
};

catalog.register("viewModels", "accountMenu", accountMenu.viewModel);

/**
    @class AccountMenu
    @static
    @namespace Components
*/
accountMenu.component = {
    /**
        @method oninit
    */
    oninit: function () {
        this.viewModel = accountMenu.viewModel();
    },

    /**
        @method view
        @return {Object} View
    */
    view: function () {
        const vm = this.viewModel;

        return m("div", {
            id: "nav-account-div",
            class: (
                "pure-menu " +
                "custom-restricted-width " +
                "fb-menu fb-menu-setup"
            ),
            onclick: vm.showMenuAccount.bind(null, true),
            onmouseout: function (ev) {
                if (
                    !ev || !ev.toElement ||
                    !ev.toElement.id ||
                    ev.toElement.id.indexOf(
                        "nav-account"
                    ) === -1
                ) {
                    vm.showMenuAccount(false);
                }
            }
        }, [
            m("span", {
                id: "nav-account-button",
                title: "Signed in as: " + (
                    f.currentUser()
                    ? f.currentUser().name
                    : ""
                ),
                class: (
                    "pure-button " +
                    "fa fa-user-circle " +
                    "fb-menu-button"
                )
            }),
            m("ul", {
                id: "nav-account-list",
                class: (
                    "pure-menu-list fb-menu-list " +
                    "fb-menu-list-setup" + (
                        vm.showMenuAccount()
                        ? " fb-menu-list-show"
                        : ""
                    )
                )
            }, [
                m("li", {
                    id: "nav-account-myinfo",
                    class: "pure-menu-link",
                    title: "Edit my contact information"
                    //onclick: vm.revert
                }, [m("i", {
                    id: "nav-account-myinfo-icon",
                    class: (
                        "fa fa-pencil-alt " +
                        "fb-menu-list-icon"
                    )
                })], "Info"),
                m("li", {
                    id: "nav-account-password",
                    class: (
                        "pure-menu-link "
                    ),
                    title: "Change password"
                    //onclick: vm.goSettings
                }, [m("i", {
                    id: "nav-account-password-icon",
                    class: "fa fa-key fb-menu-list-icon"
                })], "Password"),
                m("li", {
                    id: "nav-account-signout",
                    class: (
                        "pure-menu-link " +
                        "fb-menu-list-separator"
                    ),
                    title: "Sign out of application",
                    onclick: function () {
                        vm.showMenuAccount(false);
                        f.state().send("signOut");
                    }
                }, [m("i", {
                    id: "nav-account-signout-icon",
                    class: (
                        "fa fa-sign-out-alt " +
                        "fb-menu-list-icon"
                    )
                })], "Sign out")
            ])
        ]);
    }
};

catalog.register("components", "accountMenu", accountMenu.component);

export default Object.freeze(accountMenu);
