/*jslint browser*/
// This file is the shim layer to connect jslint to CodeMirror editor
import jslint from "./jslint.mjs";

const CodeMirror = window.CodeMirror;

function validator(text, options) {
    let data = jslint(text, options, options.globals);
    let warnings = data.warnings;
    let output = [];

    if (data.stop) {
        output.push({
            message: "JSLint was unable to finish.",
            severity: "warning",
            from: new CodeMirror.Pos(0, 0),
            to: new CodeMirror.Pos(0, 0)
        });
    }

    warnings.forEach(function (warning) {
        output.push({
            message: warning.message,
            severity: "error",
            from: new CodeMirror.Pos(warning.line - 1, warning.column - 1),
            to: new CodeMirror.Pos(warning.line - 1, warning.column + 1)
        });
    });

    return output;
}

CodeMirror.registerHelper("lint", "javascript", validator);
