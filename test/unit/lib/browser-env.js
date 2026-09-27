/*
    Minimal browser environment for unit testing Featherbone client code
    in Node without a DOM or server.

    What it does (mirrors the boot order of index_debug.html):
      1. Installs globals the client reads: window (= globalThis), m
         (mithril), Qs, jsonpatch, f (common/core.js), location, a tiny
         document shim, requestAnimationFrame.
      2. Loads common/string.js, common/date.js, common/number.mjs.
      3. Dynamically imports client ES modules (catalog, model, models/*,
         and optionally components/*) through an ESM loader hook
         (esm-hooks.mjs) so .js files under client/ load as ES modules.

    Network: m.request is replaced by a recorder. Every request the client
    makes is pushed on env.requests ({method, path, url, body, ...}) and
    answered by env.respond(handler): handler(req) returns a value, a
    Promise, or throws (-> rejected request). Default answers are
    undefined. datasource.request() builds url from location + path and
    calls m.request, so both datasource and list requests are captured.

    m.redraw is replaced by a counter (env.redraws()); m.route.set/get/
    param by a recorder (env.routes(), env.setRoute(route, params)).

    The document shim only supports what module top-level code and view
    functions touch (createElement, getElementById -> null, body,
    add/removeEventListener). It is not a DOM: render tests build vnode
    trees by calling component view() functions directly.
*/
/*jslint node*/
"use strict";

const path = require("path");
const nodeModule = require("module");
const {pathToFileURL} = require("url");

const ROOT = path.resolve(__dirname, "..", "..", "..");

const MODEL_FILES = [
    "catalog", "model", "feather", "form", "contact", "currency",
    "resource-link", "data-service", "module", "role", "route", "script",
    "style", "user-account", "workbook", "data-list-option", "document"
];

const COMPONENT_FILES = [
    "relation-widget", "address-relation", "autonumber", "button",
    "checkbox", "child-form-page", "child-table", "contact-relation",
    "data-list", "data-type", "dialog", "filter-dialog",
    "resource-link-relation", "aggregate-dialog", "form-dialog",
    "form-widget", "money-relation", "search-input", "search-page",
    "sort-dialog", "settings-page", "table-dialog", "table-widget",
    "url-widget", "gantt", "sign-in-page", "form-page", "workbook-page",
    "account-menu", "navigator-menu", "send-mail-page"
];

// Object feather as the server's /settings/catalog returns it
// (scripts/tables.js objectDef)
const OBJECT_FEATHER = {
    name: "Object",
    description: "Abstract object class from which all feathers will inherit",
    module: "Core",
    discriminator: "objectType",
    plural: "Objects",
    isSystem: true,
    properties: {
        id: {
            description: "Surrogate key",
            type: "string",
            default: "createId()",
            isRequired: true,
            isReadOnly: true,
            isAlwaysLoad: true
        },
        created: {
            description: "Create time of the record",
            type: "string",
            format: "dateTime",
            default: "now()",
            isReadOnly: true
        },
        createdBy: {
            description: "User who created the record",
            type: "string",
            isReadOnly: true
        },
        updated: {
            description: "Last time the record was updated",
            type: "string",
            format: "dateTime",
            default: "now()",
            isReadOnly: true
        },
        updatedBy: {
            description: "User who last updated the record",
            type: "string",
            isReadOnly: true
        },
        isDeleted: {
            description: "Indicates the record is no longer active",
            type: "boolean",
            isReadOnly: true,
            isAlwaysLoad: true
        },
        lock: {
            description: "Record lock information",
            type: "object",
            format: "lock",
            isReadOnly: true,
            isAlwaysLoad: true
        },
        objectType: {
            description: "Discriminates object type",
            type: "string",
            isReadOnly: true,
            isAlwaysLoad: true
        }
    }
};

let installed = false;
let requests = [];
let handler = function () {
    return undefined;
};
let redrawCount = 0;
let clientCache;
let routes = [];
let currentRoute = "/home";
let routeParams = {};

function makeElement(tag) {
    let el = {
        tagName: String(tag || "div").toUpperCase(),
        style: {},
        children: [],
        attributes: {},
        offsetWidth: 100,
        offsetHeight: 20,
        clientWidth: 100,
        clientHeight: 20,
        scrollTop: 0,
        scrollLeft: 0,
        value: "",
        parentNode: null,
        appendChild: function (child) {
            el.children.push(child);
            child.parentNode = el;
            return child;
        },
        removeChild: function (child) {
            let i = el.children.indexOf(child);
            if (i > -1) {
                el.children.splice(i, 1);
            }
            child.parentNode = null;
            return child;
        },
        setAttribute: function (k, v) {
            el.attributes[k] = String(v);
        },
        getAttribute: (k) => el.attributes[k],
        addEventListener: function () {
            return;
        },
        removeEventListener: function () {
            return;
        },
        getBoundingClientRect: () => ({
            top: 0,
            left: 0,
            width: 100,
            height: 20
        }),
        focus: function () {
            return;
        },
        click: function () {
            return;
        }
    };
    return el;
}

/**
    Install browser globals and prototype helpers. Idempotent.
    opts.stableIds: make f.createId return "fbid1", "fbid2", ... so
    rendered trees are reproducible (lib/render.js masks them as <id>).
    Must be passed on the first install/loadClient call of a process.
*/
function install(opts) {
    opts = opts || {};
    if (installed) {
        return;
    }
    installed = true;

    // Mithril schedules redraws with requestAnimationFrame
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

    // Load mithril before `window` exists so it does not probe a DOM
    const m = require("mithril");

    globalThis.window = globalThis;
    globalThis.location = {
        protocol: "http:",
        hostname: "localhost",
        port: "",
        host: "localhost",
        origin: "http://localhost",
        pathname: "/demo/",
        hash: "",
        search: "",
        href: "http://localhost/demo/",
        reload: function () {
            return;
        }
    };
    globalThis.document = {
        body: makeElement("body"),
        documentElement: makeElement("html"),
        location: globalThis.location,
        createElement: makeElement,
        getElementById: () => null,
        getSelection: () => ({removeAllRanges: () => undefined}),
        addEventListener: function () {
            return;
        },
        removeEventListener: function () {
            return;
        }
    };
    globalThis.history = {
        pushState: () => undefined,
        replaceState: () => undefined,
        back: () => undefined
    };
    globalThis.innerHeight = 800;
    globalThis.innerWidth = 1200;
    globalThis.open = () => null;

    // Same boot order as index_debug.html
    require(path.join(ROOT, "common", "string.js"));
    require(path.join(ROOT, "common", "date.js"));
    require(path.join(ROOT, "common", "number.js"));
    globalThis.m = m;
    globalThis.Qs = require("qs");
    globalThis.jsonpatch = require("fast-json-patch");
    globalThis.f = require(path.join(ROOT, "common", "core.js"));
    if (opts.stableIds) {
        let n = 0;
        globalThis.f.createId = function () {
            n += 1;
            return "fbid" + n;
        };
    }

    // Request recorder
    m.request = function (options, extra) {
        let req = Object.assign({}, options);
        req.url = req.url || "";
        req.path = req.path || req.url.replace(/^\/demo/, "").replace(
            /^http:\/\/localhost\/demo/,
            ""
        );
        if (extra) {
            req.extra = extra;
        }
        requests.push(req);
        try {
            return Promise.resolve(handler(req));
        } catch (e) {
            return Promise.reject(e);
        }
    };
    m.redraw = function () {
        redrawCount += 1;
    };
    m.redraw.sync = function () {
        return;
    };
    // Router: record route changes instead of touching window.location
    m.route.set = function (route, params, options) {
        routes.push({route, params, options});
        currentRoute = route;
    };
    m.route.get = () => currentRoute;
    m.route.param = function (key) {
        return (
            key === undefined
            ? routeParams
            : routeParams[key]
        );
    };

    if (typeof nodeModule.register === "function") {
        nodeModule.register(pathToFileURL(
            path.join(__dirname, "esm-hooks.mjs")
        ));
    }
}

function importClient(rel) {
    return import(pathToFileURL(path.join(ROOT, "client", rel)).href);
}

/**
    Register a feather definition in the client catalog and, like
    client/main.js initApp, a generic model factory for it when no model
    file registered a specialized one.
*/
function registerFeather(def) {
    let f = globalThis.f;
    let catalog = f.catalog();
    let models = catalog.store().models();
    let name = def.name.toCamelCase();

    def = JSON.parse(JSON.stringify(def));
    def.inherits = def.inherits || "Object";
    if (def.name === "Object") {
        delete def.inherits;
    }
    catalog.register("feathers", def.name, def);
    if (typeof models[name] !== "function") {
        models[name] = function (data, spec) {
            return clientCache.createModel(
                data,
                spec || f.copy(catalog.getFeather(def.name))
            );
        };
        models[name].calculated = f.prop({});
        models[name].static = f.prop({});
        Object.freeze(models[name]);
    }
}

/**
    Load the client (core, models; components when opts.components;
    deterministic ids when opts.stableIds, see install).
    Returns {f, m, catalog, State, createModel, createProperty,
    datasource}. Cached per process.
*/
async function loadClient(opts) {
    opts = opts || {};
    install(opts);
    if (!clientCache) {
        let f;
        let catalog;
        let i;

        await import(pathToFileURL(
            path.join(ROOT, "common", "number.mjs")
        ).href);
        for (i = 0; i < MODEL_FILES.length; i += 1) {
            await importClient("models/" + MODEL_FILES[i] + ".js");
        }
        f = globalThis.f;
        catalog = f.catalog();
        clientCache = {
            f,
            m: globalThis.m,
            catalog,
            State: (await importClient("state.js")).default,
            createModel: (await importClient("models/model.js")).default,
            createProperty: (await importClient("property.js")).default,
            datasource: (await importClient("datasource.js")).default,
            componentsLoaded: false
        };

        // Base data the app registers at start up (main.js)
        catalog.eventKey("test-event-key");
        f.currentUser({name: "tester", isSuper: true, mode: "prod"});
        registerFeather(OBJECT_FEATHER);
        ["forms", "modules", "currencies", "baseCurrencies"].forEach(
            (k) => catalog.register("data", k, f.prop([]))
        );
        catalog.register("data", "profile", f.prop({data: {}}));
        // Global server-sent-events state chart, as in main.js
        let sseState = clientCache.State.define(function () {
            this.state("Ok", function () {
                this.event("error", function (error) {
                    this.goto("/Error", {context: error});
                });
                this.event("close", function () {
                    this.goto("/Closed");
                });
            });
            this.state("Closed");
            this.state("Error");
        });
        sseState.goto();
        catalog.register("global", "sseState", sseState);
        catalog.register("workbooks");
        catalog.register("formInstances");
        catalog.register("config");
        catalog.register("receivers");
    }
    if (opts.components && !clientCache.componentsLoaded) {
        let i;
        for (i = 0; i < COMPONENT_FILES.length; i += 1) {
            await importClient("components/" + COMPONENT_FILES[i] + ".js");
        }
        clientCache.componentsLoaded = true;
    }
    return clientCache;
}

/**
    Settle pending promise callbacks (datasource requests resolve on
    microtasks, model callbacks chain a few deep).
*/
function flush(times) {
    let n = times || 10;
    let p = Promise.resolve();
    let i;
    for (i = 0; i < n; i += 1) {
        p = p.then(() => new Promise((resolve) => setImmediate(resolve)));
    }
    return p;
}

module.exports = {
    ROOT,
    OBJECT_FEATHER,
    COMPONENT_FILES,
    MODEL_FILES,
    install,
    loadClient,
    registerFeather,
    flush,
    requests: () => requests,
    clearRequests: function () {
        requests.length = 0;
    },
    respond: function (fn) {
        handler = fn || function () {
            return undefined;
        };
    },
    redraws: () => redrawCount,
    // m.route.set calls ({route, params, options}) and route params
    routes: () => routes,
    setRoute: function (route, params) {
        currentRoute = route;
        routeParams = params || {};
    },
    makeElement
};
