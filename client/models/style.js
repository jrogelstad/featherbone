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

function style(data, feather) {
    feather = feather || f.catalog().getFeather("Style");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        d.color.isReadOnly(!d.hasColor());
        d.backgroundColor.isReadOnly(!d.hasBackgroundColor());
    }

    model.onChange("name", function (prop) {
        prop.newValue(prop.newValue().toUpperCase());
    });

    model.onChanged("hasColor", handleReadOnly);
    model.onChanged("hasBackgroundColor", handleReadOnly);

    model.onLoad(function () {
        model.data.name.isReadOnly(true);
        handleReadOnly();
    });

    model.addCalculated({
        name: "modules",
        type: "array",
        function: f.catalog().store().data().modules
    });

    return model;
}

f.catalog().registerModel("Style", style);
