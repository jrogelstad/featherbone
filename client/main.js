/*global System, window */

(function () {
  "strict";

  System.config({
    baseURL: '/',
    map: {
      // Node modules
      "dialog-polyfill": "node_modules/dialog-polyfill/dialog-polyfill.js",
      "fast-json-patch": "node_modules/fast-json-patch/dist/json-patch-duplex.min.js",
      mathjs: "node_modules/mathjs/dist/math.min.js",
      mithril: "node_modules/mithril/mithril.js",
      statechartjs: "node_modules/statechartjs/lib/state.js",
      Qs: "node_modules/qs/dist/qs.js",
      // Featherbone core
      datasource: "/client/datasource.js",
      "feather-core": "/common/core.js",
      // Models
      list: "/client/models/list.js",
      model: "/client/models/model.js",
      settings: "/client/models/settings.js",
      workbook: "/client/models/workbook.js",
      catalog: "/client/models/catalog.js",
      // Components
      "component-core": "/client/components/core.js",
      button: "/client/components/button.js",
      checkbox: "/client/components/checkbox.js",
      dialog: "/client/components/dialog.js",
      "filter-dialog": "/client/components/table-dialog.js",
      "form-display": "/client/components/form-display.js",
      "relation-widget": "/client/components/relation-widget.js",
      "search-input": "/client/components/search-input.js",
      "sheet-configure-dialog": "/client/components/sheet-configure-dialog.js",
      "sort-dialog": "/client/components/sort-dialog.js",
      "table-dialog": "/client/components/table-dialog.js",
      "workbook-display": "/client/components/workbook-display.js"
    }
  });

  System.import("/common/extend-string.js").then(function () {
    System.import("/client/client.js");
  });

}());
