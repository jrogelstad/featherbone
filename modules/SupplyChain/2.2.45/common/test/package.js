/*
    What this package carries, read from the package itself: the modules
    its manifests name, and the feathers its feathers.json files declare.
    The catalog and schema tests use it to snapshot the package's part of
    the database and nothing else.
*/
/*jslint node*/
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function carried() {
    let modules = new Set();
    let feathers = [];

    fs.readdirSync(ROOT, {withFileTypes: true}).filter(
        (ent) => ent.isDirectory()
    ).forEach(function (ent) {
        let manifest = path.join(ROOT, ent.name, "manifest.json");
        let list = path.join(ROOT, ent.name, "feathers.json");

        if (fs.existsSync(manifest)) {
            modules.add(read(manifest).module);
        }
        if (fs.existsSync(list)) {
            read(list).forEach((f) => feathers.push(f.name));
        }
    });
    return {feathers: feathers.sort(), modules};
}

function toSnake(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

module.exports = {carried, toSnake};
