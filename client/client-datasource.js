/*global window, m, f */

(function (f) {
  "use strict";

  f.dataSource = {
    /**
      Returns the base url used to fetch and post data
      @return {String}
    */
    baseUrl: function () {
      //TODO: Make this configurable
      return "http://localhost:10010/";
    },

    request: function (options) {
      options.url = f.baseUrl() + options.name.toSpinalCase() + "/";
      if (options.id) { options.url += options.id; }
      delete options.name;
      delete options.id;

      return m.request(options);
    }
  };
}(f));

