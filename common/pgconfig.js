var fs = require("fs"),
  path = require("path");

module.exports = function (callback) {
  var filename = path.format({root: "/", base: "config/pg.json"});

  fs.readFile(filename, function (err, data) {
    if (err) {
      console.error(err);
      return;
    }

    callback(JSON.parse(data.toString()));
  });
};
