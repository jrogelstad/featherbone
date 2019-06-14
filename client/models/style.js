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
import model from "./model.js";

/*
  Style Model
*/
function style(data, feather) {
    feather = feather || catalog.getFeather("Style");
    let that = model(data, feather);
    let d = that.data;

    function handleReadOnly() {
        d.color.isReadOnly(!d.hasColor());
        d.backgroundColor.isReadOnly(!d.hasBackgroundColor());
    }

    that.onChange("name", function (prop) {
        prop.newValue(prop.newValue().toUpperCase());
    });

    that.onChanged("hasColor", handleReadOnly);
    that.onChanged("hasBackgroundColor", handleReadOnly);

    that.onLoad(function () {
        that.data.name.isReadOnly(true);
        handleReadOnly();
    });

    that.addCalculated({
        name: "modules",
        type: "array",
        function: catalog.store().data().modules
    });

    return that;
}

catalog.registerModel("Style", style, true);
