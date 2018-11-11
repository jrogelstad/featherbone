/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
/*global System*/
/*jslint white*/
(function () {

  "use strict";

  System.config({
    baseURL: '/',
    map: {
      // Node modules
      "dialog-polyfill": "node_modules/dialog-polyfill/dialog-polyfill.js",
      "fast-json-patch": "node_modules/fast-json-patch/dist/json-patch-duplex.min.js",
      "mithril": "node_modules/mithril/mithril.js",
      "stream": "common/stream.js",
      "statechartjs": "node_modules/statechartjs/lib/state.js",
      "Qs": "node_modules/qs/dist/qs.js",
      // Featherbone core
      "datasource": "/client/datasource.js",
      "common-core": "/common/core.js",
      // Models
      "contact": "/client/models/contact.js",
      "currency": "/client/models/currency.js",
      "currency-conversion": "/client/models/currency-conversion.js",
      "currency-unit": "/client/models/currency-unit.js",
      "list": "/client/models/list.js",
      "model": "/client/models/model.js",
      "settings": "/client/models/settings.js",
      "table": "/client/models/table.js",
      "form": "/client/models/form.js",
      "workbook": "/client/models/workbook.js",
      "catalog": "/client/models/catalog.js",
      // Components
      "address-relation": "/client/components/address-relation.js",
      "component-core": "/client/components/core.js",
      "contact-relation": "/client/components/contact-relation.js",
      "button": "/client/components/button.js",
      "checkbox": "/client/components/checkbox.js",
      "child-table": "/client/components/child-table.js",
      "dialog": "/client/components/dialog.js",
      "filter-dialog": "/client/components/filter-dialog.js",
      "form-dialog": "/client/components/form-dialog.js",
      "form-page": "/client/components/form-page.js",
      "form-widget": "/client/components/form-widget.js",
      "money-relation": "/client/components/money-relation.js",
      "relation-widget": "/client/components/relation-widget.js",
      "search-input": "/client/components/search-input.js",
      "settings-page": "/client/components/settings-page.js",
      "sheet-configure-dialog": "/client/components/sheet-configure-dialog.js",
      "sort-dialog": "/client/components/sort-dialog.js",
      "search-page": "/client/components/search-page.js",
      "table-dialog": "/client/components/table-dialog.js",
      "table-widget": "/client/components/table-widget.js",
      "workbook-page": "/client/components/workbook-page.js"
    }
  });
 
  System.import("/client/main.js");

}());

