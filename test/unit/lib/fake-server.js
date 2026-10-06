/*
    In-memory stand-in for the Featherbone REST API, used by unit tests
    that drive client models and lists. Install with
    env.respond(server.handle). It answers the requests client/models
    make (see server/services/crud.js for the real behavior it mimics):

      GET    /data/<feather>/<id>        -> stored record (404 if absent)
      POST   /data/<feather>             -> JSON patch: sent vs stored
      PATCH  /data/<feather>/<id>?...    -> JSON patch: sent vs stored

    Like crud.js, POST/PATCH answer with jsonpatch.compare(what the client
    sent, the record as stored), where storing sets created/updated/etag,
    drops null (deleted) child rows and adds a property the client
    feather does not have ("serverOnly") on PATCH.
      DELETE /data/<feather>/<id>?...    -> deleted record
      POST   /data/<plural>              -> server.list(plural, fn) rows,
                                            [] for other list queries
      POST   /do/lock, /do/unlock        -> true
      GET    /do/is-authorized?...       -> true
      POST   /do/subscribe/..., /do/unsubscribe/... -> true

    server.failNext(method, pathPrefix, error) makes the next matching
    request reject with error (e.g. a lock conflict). server.hold(...)
    makes the next matching request wait until release() is called.
*/
/*jslint node*/
"use strict";

const jsonpatch = require("fast-json-patch");

function copy(o) {
    return JSON.parse(JSON.stringify(o));
}

// Like the database: child rows set to null (deleted) disappear
function normalize(rec) {
    Object.keys(rec).forEach(function (k) {
        if (Array.isArray(rec[k])) {
            rec[k] = rec[k].filter((r) => r !== null).map(function (r) {
                return (
                    (r && typeof r === "object")
                    ? normalize(r)
                    : r
                );
            });
        }
    });
    return rec;
}

function createServer() {
    let records = {};
    let failures = [];
    let holds = [];
    let seq = 0;
    let lists = {};

    function next(tag) {
        seq += 1;
        return tag + seq;
    }

    function take(list, req) {
        let i = list.findIndex(
            (x) => x.method === req.method && req.path.startsWith(x.prefix)
        );
        if (i === -1) {
            return undefined;
        }
        return list.splice(i, 1)[0];
    }

    function answer(req) {
        let p = req.path.split("?")[0];
        let parts = p.split("/").filter(Boolean);
        let rec;
        let id;
        let cache;

        if (parts[0] === "do") {
            return true;
        }
        if (parts[0] !== "data") {
            return undefined;
        }
        id = parts[2];
        switch (req.method) {
        case "GET":
            rec = records[id];
            if (!rec) {
                throw new Error("Record not found");
            }
            return JSON.parse(JSON.stringify(rec));
        case "POST":
            if (lists[parts[1]]) {
                return lists[parts[1]]().map(
                    (r) => JSON.parse(JSON.stringify(r))
                );
            }
            // Any other list query (has showDeleted) finds nothing
            if (req.body && Object.hasOwn(req.body, "showDeleted")) {
                return [];
            }
            cache = copy(req.body);
            rec = normalize(copy(req.body));
            // The database fills in the object type from the table
            rec.objectType = rec.objectType || parts[1].replace(
                /-(.)/g,
                (ignore, c) => c.toUpperCase()
            );
            rec.created = next("c-");
            rec.createdBy = "tester";
            rec.updated = next("u-");
            rec.updatedBy = "tester";
            if (Object.hasOwn(rec, "etag")) {
                rec.etag = next("e-");
            }
            records[rec.id] = rec;
            return jsonpatch.compare(cache, rec);
        case "PATCH":
            rec = records[id];
            if (!rec) {
                throw new Error("Record not found");
            }
            cache = copy(rec);
            jsonpatch.applyPatch(cache, copy(req.body));
            rec = normalize(copy(cache));
            rec.updated = next("u-");
            if (Object.hasOwn(rec, "etag")) {
                rec.etag = next("e-");
            }
            // A server-side property the client does not know about
            rec.serverOnly = 1;
            records[id] = rec;
            return jsonpatch.compare(cache, rec);
        case "DELETE":
            rec = records[id];
            if (!rec) {
                throw new Error("Record not found");
            }
            rec.isDeleted = true;
            delete records[id];
            return JSON.parse(JSON.stringify(rec));
        }
        return undefined;
    }

    return {
        records,
        put: function (rec) {
            records[rec.id] = JSON.parse(JSON.stringify(rec));
            return records[rec.id];
        },
        // Answer POST /data/<plural> list queries with fn()
        list: function (plural, fn) {
            lists[plural] = fn;
        },
        failNext: function (method, prefix, error) {
            failures.push({method, prefix, error});
        },
        hold: function (method, prefix) {
            let h = {method, prefix};
            h.promise = new Promise(function (resolve) {
                h.release = resolve;
            });
            holds.push(h);
            return h;
        },
        handle: function (req) {
            let fail = take(failures, req);
            let hold = take(holds, req);
            if (fail) {
                return Promise.reject(fail.error);
            }
            if (hold) {
                return hold.promise.then(() => answer(req));
            }
            return answer(req);
        }
    };
}

module.exports = {createServer};
