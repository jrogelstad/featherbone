/**
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
**/
import catalog from "./catalog.js";
import model from "./model.js";

/*
  Role Membership model
*/
function roleMembership(data, feather) {
    feather = feather || catalog.getFeather("RoleMembership");
    let that = model(data, feather);

    function roleNames () {
        let roles = catalog.store().data().roles();
        let name;
        let result;
        
        result = roles.map(function (role) {
            name = role.data.name();
            return {
                value: name,
                label: name
            };
        });
        result.unshift({
            value: "",
            label: ""
        });
        return result;
    }

    that.addCalculated({
        name: "roleNames",
        type: "array",
        function: roleNames
    });

    return that;
}

catalog.registerModel("RoleMembership", roleMembership);
