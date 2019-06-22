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
import catalog from "./catalog.js";
import f from "../core.js";

/*
  Role model
*/
function role(data, feather) {
    feather = feather || catalog.getFeather("Role");
    let model = f.createModel(data, feather);
    let re = new RegExp(" ", "g");

    model.onChange("name", function (prop) {
        prop.newValue(prop.newValue().toLowerCase().replace(re, "_"));
    });

    model.onLoad(function () {
        model.data.name.isReadOnly(true);
    });

    model.onValidate(function () {
        model.data.membership().forEach(function (item) {
            if (!item.data.role()) {
                throw new Error("Role must be selected for membership");
            }
        });
    });

    return model;
}

catalog.registerModel("Role", role, true);
