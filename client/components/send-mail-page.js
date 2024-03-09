/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
            let d = vm.formWidget().model().data;
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

            await f.datasource().request({
                method: "POST",
                path: "/do/send-mail/",
                body: theBody
            });

            vm.formWidget().model().delete(true);
            m.route.set(url);
        } catch (e) {
            console.error(e);
            f.notify("Error: " + e.message, {
                icon: "warning",
                iconColor: "orange"
            });
        }
    };
    /**
        @method doCancel
    */
    vm.doCancel = async function () {
        let theModel = vm.formWidget().model();
        //let url = theModel.data.returnTo();
        await theModel.delete();

        window.history.back(2);
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

    /**
        @method model
        @param {Model} model
        @return {Model}
    */
    //vm.model = f.prop(theModel);

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
            })
        ]);
    }
};

f.catalog().register("components", "sendMailPage", sendMailPage.component);
