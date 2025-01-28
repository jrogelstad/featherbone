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
/*jslint this, browser, devel, unordered*/
/*global f, m*/
/**
    @module SendMailPage
*/
const sendMailPage = {};

/**
    View model for send mail page.

    @class SendMailPage
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {String} [options.key] Model key
*/
sendMailPage.viewModel = function (options) {
    options = options || {};
    let vm = {};

    // ..........................................................
    // PUBLIC
    //

    /**
        @method buttonSend
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSend = f.prop();

    /**
        @method buttonCancel
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonCancel = f.prop();
    /**
        @method doCancel
    */
    vm.doSend = async function () {
        try {
            let theModel = vm.formWidget().model();
            let d = theModel.data;
            let url = d.returnTo();
            let theBody = {
                message: {
                    from: d.from(),
                    to: d.to(),
                    subject: d.subject(),
                    html: d.text()
                },
                pdf: d.pdf()
            };

            vm.waitDialog().show();
            await f.datasource().request({
                method: "POST",
                path: "/do/send-mail/",
                body: theBody
            });

            await theModel.delete(true);

            m.route.set(url);
        } catch (e) {
            console.error(e);
            f.notify("Error: " + e.message, {
                icon: "warning",
                iconColor: "orange"
            });
        } finally {
            vm.waitDialog().cancel();
        }
    };
    /**
        @method doCancel
    */
    vm.doCancel = async function () {
        let theModel = vm.formWidget().model();
        let url = theModel.data.returnTo();

        try {
            await theModel.delete(true);
        } catch (e) {
            f.notify(e);
        } finally {
            m.route.set(url);
        }
    };

    /**
        @method formWidget
        @param {ViewModels.FormWidget} widget
        @return {ViewModels.FormWidget}
    */
    vm.formWidget = f.prop(f.createViewModel("FormWidget", {
        model: "SendMail",
        id: options.key,
        config: {
            attrs: [{
                attr: "to"
            }, {
                attr: "subject"
            }, {
                attr: "text",
                showLabel: false
            }]
        },
        outsideElementIds: ["toolbar"]
    }));



    // ..........................................................
    // PRIVATE
    //

    vm.buttonSend(f.createViewModel("Button", {
        onclick: vm.doSend,
        label: "&Send",
        class: "fb-toolbar-button",
        icon: "send"
    }));
    vm.buttonSend().isPrimary(true);

    vm.buttonCancel(f.createViewModel("Button", {
        onclick: vm.doCancel,
        label: "&Cancel",
        class: "fb-toolbar-button"
    }));

    /**
        @method waitDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.waitDialog = f.prop(f.createViewModel("Dialog"));
    let wd = vm.waitDialog();
    wd.style().width = "300px";
    wd.style().height = "300px";
    wd.style().border = "none";
    wd.style().background = "none";
    wd.style().boxShadow = "none";
    wd.content = function () {
        return m("div", {class: "lds-large-dual-ring"});
    };
    wd.buttonCancel().hide();
    wd.buttonOk().hide();

    return vm;
};

/**
    Send mail page component

    @class SendMailPage
    @static
    @namespace Components
*/
sendMailPage.component = {
    /**
        Must pass view model instance or settings to build one.
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {ViewModels.SendMailPage} [vnode.attrs.viewModel]
        @param {Function} [vnode.attrs.settings]
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || sendMailPage.viewModel(vnode.attrs)
        );
    },
    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;
        let dlg = f.getComponent("Dialog");

        // Build view
        return m("div", [
            m("div", {
                id: "toolbar",
                class: "fb-toolbar"
            }, [
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonCancel()
                }),
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonSend()
                })
            ]),
            m("div", {
                class: "fb-title"
            }, [
                m("i", {
                    class: "material-icons fb-title-icon"
                }, "mail"),
                m("label", "Send Mail")
            ]),
            m(f.getComponent("FormWidget"), {
                viewModel: vm.formWidget()
            }),
            f.snackbar(),
            m(dlg, {
                viewModel: vm.waitDialog()
            })
        ]);
    }
};

f.catalog().register("components", "sendMailPage", sendMailPage.component);
