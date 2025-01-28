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
    @module AccountMenu
*/

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
    let user = f.currentUser();
    let firstName = f.prop(user.firstName);
    let lastName = f.prop(user.lastName);
    let phone = f.prop(user.phone);
    let email = f.prop(user.email);
    let pwdView;
    let infoView;
    let pathname = "/" + location.pathname.replaceAll("/", "");

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
        @method changePasswordDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.changeUserInfoDialog = f.prop();
     /**
        @method errorDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.errorDialog = f.prop();
    /**
        Create content for change password dialog.
        @method createPasswordContent
    */
    vm.createPasswordContent = function () {
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

    vm.createUserInfoContent = function () {
        infoView = m("form", {
            class: "pure-form pure-form-aligned",
            id: "changeUserInfoDialogForm"
        }, [
            m("fieldset", [
                m("div", {
                    class: "pure-control-group",
                    id: "changeUserInfoDialogGrp1"
                }, [
                    m("label", {
                        id: "userInfoFirstNameLabel",
                        for: "userInfoFirstName"
                    }, "First Name:"),
                    m("input", {
                        id: "userInfoFirstName",
                        value: firstName(),
                        onchange: (e) => firstName(e.target.value)
                    })
                ]),
                m("div", {
                    class: "pure-control-group",
                    id: "changeUserInfoDialogGrp2"
                }, [
                    m("label", {
                        id: "userInfoLastNameLabel",
                        for: "userInfoLastName"
                    }, "Last Name:"),
                    m("input", {
                        id: "userInfoLastName",
                        required: true,
                        value: lastName(),
                        onchange: (e) => lastName(e.target.value)
                    })
                ]),
                m("div", {
                    class: "pure-control-group",
                    id: "changeUserInfoDialogGrp3"
                }, [
                    m("label", {
                        id: "userInfoEmailLabel",
                        for: "userInfoEmail"
                    }, "Email:"),
                    m("input", {
                        type: "email",
                        id: "userInfoEmail",
                        value: email(),
                        onchange: (e) => email(e.target.value)
                    })
                ]),
                m("div", {
                    class: "pure-control-group",
                    id: "changeUserInfoDialogGrp3"
                }, [
                    m("label", {
                        id: "userInfoPhoneLabel",
                        for: "userInfoPhone"
                    }, "Phone:"),
                    m("input", {
                        type: "tel",
                        id: "userInfoPhone",
                        value: phone(),
                        onchange: (e) => phone(e.target.value)
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
                url: pathname + "/do/change-password",
                body: {
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

    vm.changeUserInfoDialog(f.createViewModel("Dialog", {
        title: "Edit my contact information",
        icon: "edit",
        onOk: function () {
            m.request({
                method: "POST",
                url: pathname + "/do/change-user-info",
                body: {
                    firstName: firstName(),
                    lastName: lastName(),
                    email: email(),
                    phone: phone()
                }
            }).then(function () {
                user.firstName = firstName();
                user.lastName = lastName();
                user.email = email();
                user.phone = phone();
            }).catch(function (err) {
                vm.errorDialog().message(err.message);
                vm.errorDialog().show();
            });
        },
        onCancel: function () {
            firstName(user.firstName);
            lastName(user.lastName);
            email(user.email);
            phone(user.phone);
        }
    }));

    vm.changeUserInfoDialog().content = () => infoView;

    vm.errorDialog(f.createViewModel("Dialog", {
        title: "Error",
        icon: "times"
    }));

    function validatePassword() {
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
    oldPwd.state().resolve("/Changing").exit(validatePassword);
    newPwd.state().resolve("/Changing").exit(validatePassword);
    cnfPwd.state().resolve("/Changing").exit(validatePassword);

    function validateInfo() {
        let dlg = vm.changeUserInfoDialog();
        let msg;

        dlg.okDisabled(true);

        if (!lastName()) {
            msg = "Last name cannot be blank";
        }

        if (msg) {
            dlg.okTitle(msg);
        } else {
            dlg.okTitle("");
            dlg.okDisabled(false);
        }
    }

    // Validate when fields edited
    firstName.state().resolve("/Changing").exit(validateInfo);
    lastName.state().resolve("/Changing").exit(validateInfo);
    email.state().resolve("/Changing").exit(validateInfo);
    phone.state().resolve("/Changing").exit(validateInfo);

    return vm;
};

f.catalog().register("viewModels", "accountMenu", accountMenu.viewModel);

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
        let menuButtonClass = (
            "pure-button " +
            "material-icons-outlined " +
            "fb-menu-button fb-menu-button-left-side"
        );

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
                    !ev || !ev.relatedTarget ||
                    !ev.relatedTarget.id ||
                    ev.relatedTarget.id.indexOf(
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
                viewModel: vm.changeUserInfoDialog()
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
                class: menuButtonClass
            }, "perm_identityarrow_drop_down"),
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
                    title: "Edit my contact information",
                    onclick: function () {
                        let cdlg = vm.changeUserInfoDialog();

                        vm.createUserInfoContent();
                        cdlg.okDisabled(true);
                        cdlg.show();
                    }
                }, [m("i", {
                    id: "nav-account-myinfo-icon",
                    class: (
                        "material-icons-outlined " +
                        "fb-menu-list-icon"
                    )
                }, "edit")], "Info"),
                m("li", {
                    id: "nav-account-password",
                    class: (
                        "pure-menu-link "
                    ),
                    title: "Change password",
                    onclick: function () {
                        let cdlg = vm.changePasswordDialog();

                        vm.createPasswordContent();
                        cdlg.okDisabled(true);
                        cdlg.show();
                    }
                }, [m("i", {
                    id: "nav-account-password-icon",
                    class: "material-icons fb-menu-list-icon"
                }, "key")], "Password"),
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
                        "material-icons " +
                        "fb-menu-list-icon"
                    )
                }, "logout")], "Sign out")
            ])
        ]);
    }
};

f.catalog().register("components", "accountMenu", accountMenu.component);

