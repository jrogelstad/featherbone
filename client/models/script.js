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
import f from "../core.js";
import catalog from "./catalog.js";
import model from "./model.js";

function script(data, feather) {
    let that;

    feather = feather || catalog.getFeather("Script");
    that = model(data, feather);

    that.addCalculated({
        name: "annotations",
        description: "Lint annotations",
        type: "Array",
        function: f.prop()
    });

    that.onValidate(function () {
        let annotations = that.data.annotations();

        if (annotations && annotations.length) {
            console.log(annotations);
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

    that.onLoad(function () {
        that.data.name.isReadOnly(true);
    });

    return that;
}

catalog.registerModel("Script", script);
