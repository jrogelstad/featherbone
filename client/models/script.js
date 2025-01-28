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
/**
    @module Core
*/

function script(data, feather) {
    let model;

    feather = feather || f.catalog().getFeather("Script");
    model = f.createModel(data, feather);

    /**
        Lint errors.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.annotations
        @for Models.Script
        @type Property
    */
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

    model.onCopy(function () {
        model.data.name.isReadOnly(false);
    });

    return model;
}

f.catalog().registerModel("Script", script);
