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
/*global f*/

function role(data, feather) {
    feather = feather || f.catalog().getFeather("Role");
    let model = f.createModel(data, feather);
    let re = new RegExp(" ", "g");

    model.onChange("name", function (prop) {
        prop.newValue(prop.newValue().toLowerCase().replace(re, "_"));
    });

    model.onLoad(function () {
        model.data.name.isReadOnly(true);
    });

    model.onValidate(function () {
        if (model.data.membership) {
            model.data.membership().forEach(function (item) {
                if (!item.data.role()) {
                    throw new Error("Role must be selected for membership");
                }
            });
        }
    });

    return model;
}

f.catalog().registerModel("Role", role);

function roleMembership(data, feather) {
    feather = feather || f.catalog().getFeather("RoleMembership");
    let model = f.createModel(data, feather);

    function roleNames() {
        let roles = f.catalog().store().data().roles().slice();
        let result;

        result = roles.filter(function (role) {
            return (
                role.data.objectType() !== "UserAccount" &&
                !role.data.isDeleted()
            );
        });
        result = result.map((role) => role.data.name()).sort();
        result = result.map(function (role) {
            return {
                value: role,
                label: role
            };
        });
        result.unshift({
            value: "",
            label: ""
        });
        return result;
    }

    /**
        Role names datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.roleNames
        @for Models.RoleMembership
        @type Property
    */
    model.addCalculated({
        name: "roleNames",
        type: "array",
        function: roleNames
    });

    return model;
}

f.catalog().registerModel("RoleMembership", roleMembership);
