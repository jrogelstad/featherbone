/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*jslint browser*/
/*global f*/

/*
  Link Model
*/

function resourceLink(data, feather) {
    feather = feather || f.catalog().getFeather("ResourceLink");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleLink() {
       d.displayValue(d.label() || d.resource());
    }

    model.onChanged("icon", handleLink);
    model.onChanged("resource", handleLink);
    model.onChanged("label", handleLink)

    model.naturalKey = model.data.displayValue;

    return model;
}

f.catalog().registerModel("ResourceLink", resourceLink);
