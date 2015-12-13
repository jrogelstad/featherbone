/*global window, m, f */
(function () {
  "use strict";

  var that = {};

  /**
    Returns the base url used to fetch and post data
    @return {String}
  */
  that.baseUrl = function () {
    //TODO: Make this configurable
    return "http://localhost:10001";
  };

  that.request = function (options) {
    options.url = that.baseUrl() + options.path;
    if (options.id) { options.url += options.id; }
    delete options.name;
    delete options.id;

    return m.request(options);
  };

  module.exports = that;

}());

