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
import f from "../core.js";
import catalog from "./catalog.js";

function script(data, feather) {
    let model;

    feather = feather || catalog.getFeather("Script");
    model = f.createModel(data, feather);

    model.addCalculated({
        name: "annotations",
        description: "Lint annotations",
        type: "Array",
        function: f.prop()
    });

    model.onValidate(function () {
        let annotations = model.data.annotations();

        if (annotations && annotations.length) {
            throw new Error(
                "Script has " + annotations.length +
                " lint violation" + (
                    annotations.length > 1
                    ? "s"
                    : ""
                ) +
                " starting on line " + (annotations[0].from.line + 1)
            );
        }
    });

    model.onLoad(function () {
        model.data.name.isReadOnly(true);
    });

    return model;
}

catalog.registerModel("Script", script);
