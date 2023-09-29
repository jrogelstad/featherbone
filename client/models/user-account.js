/*
    Framework for building object relational database apps
    Copyright (C) 2023  John Rogelstad

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
/*global f*/

function userAccount(data, feather) {
    feather = feather || f.catalog().getFeather("UserAccount");
    // New roles are always members of everyone
    if (data === undefined) {
        data = {
            membership: [{
                role: "everyone"
            }]
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
    })

    return model;
}

f.catalog().registerModel("UserAccount", userAccount);
