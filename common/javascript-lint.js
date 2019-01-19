// This file is the shim layer to connect jslint to CodeMirror editor
import jslint from "./jslint.js";

(function(mod) {
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  function validator(text, options) {
    let data = jslint(text, options, options.globals);
    let result = [];
    if (data) parse(data, result);
    return result;
  }

  CodeMirror.registerHelper("lint", "javascript", validator);

    function parse(data, output) {
        let warnings = data.warnings;

        if (data.stop) {
            output.push({
                message: "JSLint was unable to finish.",
                severity: "error",
                from: CodeMirror.Pos(0, 0),
                to: CodeMirror.Pos(0, 0)
            })
        };

        warnings.forEach(function (warning) {
            if (warning.line < 0) {
              if (window.console) {
                window.console.warn("Cannot display jslint error (invalid line " + warning.line + ")", warning);
              }
              return;
            }

            let start = warning.column - 1;
            let end = start + 1;

            // Convert to format expected by validation service
            let lint = {
              message: warning.message,
              severity: "warning",
              from: CodeMirror.Pos(warning.line, start),
              to: CodeMirror.Pos(warning.line, end)
            };

            output.push(lint);
        });
    }
});
