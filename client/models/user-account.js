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
/*jslint browser unordered*/
/*global f, m*/

function userAccount(data, feather) {
    feather = feather || f.catalog().getFeather("UserAccount");
    // New roles are always members of everyone
    if (data === undefined) {
        data = {
            membership: [{
                role: "everyone"
            }],
            password: f.createId() + f.createId()
        };
    }
    let model = f.createModel(data, feather);

    if (model.data.isSuper) {
        model.data.isSuper.isReadOnly(!f.currentUser().isSuper);
    }

    model.onLoad(function () {
        if (model.data.name) {
            model.data.name.isReadOnly(true);
        }
    });

    model.onValidate(function () {
        if (
            model.data.contact() &&
            !model.data.contact().data.email()
        ) {
            throw "Contact must have a primary email address";
        }
    });

    return model;
}

f.catalog().registerModel("UserAccount", userAccount);

const sessionFeather = {
    name: "SessionSignedIn",
    plural: "SessionsSignedIn",
    description: "Sessions signed in",
    inherits: "Object",
    isSystem: true,
    properties: {
        expires: {
            description: "Updated by user",
            type: "string",
            format: "dateTime"
        },
        user: {
            description: "User name",
            type: "string"
        }
    }
};
f.catalog().register("feathers", "SessionSignedIn", sessionFeather);

userAccount.static().sessions = async function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let twc = f.getComponent("TableWidget");
    let sessdata = await f.datasource().request({
        method: "GET",
        path: "/sessions"
    });
    let sessions = f.createList("SessionSignedIn", {fetch: false});

    sessdata.forEach(function (sess) {
        let mdl = f.createModel("SessionSignedIn", sess);
        mdl.state().goto("/Ready/Fetched/Clean");
        sessions.add(mdl);
    });

    let twvm = f.createViewModel("TableWidget", {
        config: {columns: [{
            attr: "id",
            width: 120
        }, {
            attr: "user"
        }, {
            attr: "expires",
            width: 200
        }]},
        feather: "SessionSignedIn",
        height: "150px",
        models: sessions
    });
    twvm.isMultiSelectEnabled(false);

    function onOk() {
        return f.datasource().request({
            method: "POST",
            path: "/do/disconnect/" + twvm.selection().id()
        }).then(function () {
            f.notify("Session disconnected");
        }).catch(function () {
            f.notify("Failed to disconnect");
        });
    }

    dialog.content = function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "pure-control-group"
            }, [
                m(twc, {viewModel: twvm})
            ])
        ]);
    };

    dialog.style().width = "700px";
    dialog.title("Sessions Signed In");
    dialog.buttonOk().label("Disconnect");
    dialog.buttonOk().title("Disconnect session");
    dialog.buttonOk().isDisabled = () => !Boolean(twvm.selection());
    dialog.icon("recent_actors");
    dialog.onOk(onOk);
    dialog.show();
};
