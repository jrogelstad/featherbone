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

const catalog = f.catalog();
const m = window.m;
const accountMenu = {};

/**
    @class AccountMenu
    @namespace ViewModels
    @constructor
*/
accountMenu.viewModel = function () {
    const vm = {};
    let oldPwd = f.prop("");
    let newPwd = f.prop("");
    let cnfPwd = f.prop("");
    let pwdView;

    /**
        @method showMenuAccount
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.showMenuAccount = f.prop(false);
     /**
        @method changePasswordDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.changePasswordDialog = f.prop();
     /**
        @method errorDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.errorDialog = f.prop();
    /**
        Create content for change password dialog.
        @method createContent
    */
    vm.createContent = function () {
        pwdView = m("form", {
            class: "pure-form pure-form-aligned",
            id: "changePasswordDialogForm"
        }, [
            m("fieldset", [
                m("div", {
                    class: "pure-control-group",
                    id: "changePasswordDialogGrp1"
                }, [
                    m("label", {
                        id: "oldPasswordLabel",
                        for: "oldPassword"
                    }, "Old Password:"),
                    m("input", {
                        type: "password",
                        id: "oldPassword",
                        value: oldPwd(),
                        onchange: (e) => oldPwd(e.target.value)
                    })
                ]),
                m("div", {
                    class: "pure-control-group",
                    id: "changePasswordDialogGrp2"
                }, [
                    m("label", {
                        for: "newPassword",
                        id: "newPaswordLabel"
                    }, "New Password:"),
                    m("input", {
                        type: "password",
                        id: "newPassword",
                        value: newPwd(),
                        onchange: (e) => newPwd(e.target.value)
                    })
                ]),
                m("div", {
                    class: "pure-control-group",
                    id: "changePasswordDialogGrp3"
                }, [
                    m("label", {
                        for: "confirmPassword",
                        id: "confirmPasswordLabel"
                    }, "Confirm Password:"),
                    m("input", {
                        type: "password",
                        id: "confirmPassword",
                        value: cnfPwd(),
                        onchange: (e) => cnfPwd(e.target.value)
                    })
                ])
            ])
        ]);
    };

    // ..........................................................
    // PRIVATE
    //
    vm.changePasswordDialog(f.createViewModel("Dialog", {
        title: "Change Password",
        icon: "key",
        onOk: function () {
            m.request({
                method: "POST",
                url: "do/change-password",
                data: {
                    oldPassword: oldPwd(),
                    newPassword: newPwd()
                }
            }).catch(function (err) {
                vm.errorDialog().message(err.message);
                vm.errorDialog().show();
            });
            oldPwd("");
            newPwd("");
            cnfPwd("");
        },
        onCancel: function () {
            oldPwd("");
            newPwd("");
            cnfPwd("");
        }
    }));

    vm.changePasswordDialog().content = () => pwdView;

    vm.errorDialog(f.createViewModel("Dialog", {
        title: "Error",
        icon: "times"
    }));

    function validate() {
        let dlg = vm.changePasswordDialog();
        let msg;

        dlg.okDisabled(true);

        if (!oldPwd().length) {
            msg = "Old password cannot be blank";
        } else if (!newPwd().length) {
            msg = "New password cannot be blank";
        } else if (newPwd() !== cnfPwd()) {
            msg = "New password is not the same as confirmed password";
        } else if (newPwd() === oldPwd()) {
            msg = "New password cannot be the same as old password";
        }

        if (msg) {
            dlg.okTitle(msg);
        } else {
            dlg.okTitle("");
            dlg.okDisabled(false);
        }
    }

    // Validate when fields edited
    oldPwd.state().resolve("/Changing").exit(validate);
    newPwd.state().resolve("/Changing").exit(validate);
    cnfPwd.state().resolve("/Changing").exit(validate);

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
        const dlg = f.getComponent("Dialog");
        const dlgState = vm.changePasswordDialog().state().current()[0];

        return m("div", {
            id: "nav-account-div",
            class: (
                "pure-menu " +
                "custom-restricted-width " +
                "fb-menu fb-menu-setup"
            ),
            onclick: function (e) {
                if (
                    dlgState === "/Display/Closed" &&
                    e.srcElement.nodeName !== "BUTTON" &&
                    e.target.parentElement.nodeName !== "BUTTON"
                ) {
                    vm.showMenuAccount(true);
                }
            },
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
            m(dlg, {
                viewModel: vm.changePasswordDialog()
            }),
            m(dlg, {
                viewModel: vm.errorDialog()
            }),
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
                    title: "Change password",
                    onclick: function () {
                        let cdlg = vm.changePasswordDialog();

                        vm.createContent();
                        cdlg.okDisabled(true);
                        cdlg.show();
                    }
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
                    onclick: () => f.state().send("signOut")
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
