/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
*/
/*jslint browser, unordered*/
/*global f, m*/
/**
    Tells the person, immediately and persistently, when the browser can no
    longer reach the Featherbone server, so a failed save or an empty page
    is never a mystery. Mounted as a banner (`ConnectionBanner`, registered
    below as the "connectionBanner" component) at the top of every page
    that used to show a blocking "Connection Error" dialog on disconnect --
    main.js's home page, workbook-page.js and form-page.js.

    Ported from Documents/ddom's connection-monitor.js at John's request
    (Oct 2026), adapted to how Featherbone actually talks to its server:

      - ddom wraps `window.fetch`; Featherbone's datasource.js (and the few
        other direct callers -- table-widget.js, form-page.js) call
        `m.request()` instead, a wholly different, XHR-based function with
        its own failure signal (a rejected promise whose `error.code` is 0
        for a network failure or timeout, or the raw HTTP status otherwise
        -- see node_modules/mithril/request/request.js). So this wraps
        `m.request` once, the same "cover every call site with no changes
        to them" trick ddom plays on `fetch`, keyed on that `code` instead
        of ddom's response-status/TypeError check.
      - no module import for the "reconnected" toast (component files here
        don't import each other): `f.notify()` (core.js) instead of ddom's
        toast.js.
      - the live WebSocket signal (ddom's ws-client.js calling
        setSocketUp()) is Featherbone's existing `listen()` in main.js,
        wired to call setSocketUp() from the same onopen/onclose that
        already talk to `sseState` -- that machinery (also used to signal
        an intentional popup-window close, see form-page.js) is untouched.

    Three independent signals feed one "offline" verdict, exactly as in
    ddom:
      1. Any `m.request` call that rejects with `error.code` 0 (no HTTP
         response at all) or 502/503/504 (a proxy reporting the app behind
         it is down). Installed once, below, by wrapping `m.request` --
         so every existing call site is covered with no per-call changes.
      2. The live WebSocket (main.js's `listen()`) closing. A dropped
         socket is the fastest signal available; stays null (ignored)
         before the first sign-in, when there is no socket yet.
      3. A lightweight GET /api/ping probe (see server.js): every
         PROBE_ONLINE_MS while online (catches a silently dead connection
         no request has hit yet), every PROBE_OFFLINE_MS while offline
         (detects recovery), and immediately on the browser's own
         online/offline events or when the tab becomes visible again.

    The banner clears only when every signal that went bad is good again,
    and a short "Reconnected" notification confirms it.

    Registered under "global" (`f.catalog().store().global().
    connectionMonitor`), same as `sseState`, rather than importing/
    exporting between component files, which this codebase doesn't do.

    @module ConnectionMonitor
*/

const PROBE_ONLINE_MS = 10000;
const PROBE_OFFLINE_MS = 2000;
const PROBE_TIMEOUT_MS = 4000;

const connectionMonitor = {};

let nativeRequest;
let fetchDown = false; // a request or probe just failed at the network level
let socketUp = null;   // null = no socket yet; true/false once one opens
let probeTimer;
let installed = false;
let reconnectHandler; // set by main.js: "try the socket again now"
let offlineSince;

/**
    @method isOffline
    @return {Boolean}
*/
connectionMonitor.isOffline = function () {
    return fetchDown || socketUp === false;
};

function refresh(wasOffline) {
    let nowOffline = connectionMonitor.isOffline();

    if (nowOffline && !wasOffline) {
        offlineSince = new Date();
    } else if (!nowOffline && wasOffline) {
        offlineSince = undefined;
        f.notify("Reconnected to the server.", {icon: "cloud_done"});
    }

    if (nowOffline !== wasOffline) {
        m.redraw();
    }

    scheduleProbe();
}

function markDown() {
    let was = connectionMonitor.isOffline();

    fetchDown = true;
    refresh(was);
}

function markUp() {
    let was = connectionMonitor.isOffline();

    fetchDown = false;
    refresh(was);
}

/**
    Called by main.js's `listen()` when the WebSocket opens (true) or
    closes (false).
    @method setSocketUp
    @param {Boolean} up
*/
connectionMonitor.setSocketUp = function (up) {
    let was = connectionMonitor.isOffline();

    socketUp = up;
    refresh(was);
};

/**
    main.js registers how to retry its socket immediately (rather than
    waiting out its own sign-in flow) once a probe shows the server is
    back.
    @method setReconnectHandler
    @param {Function} fn
*/
connectionMonitor.setReconnectHandler = function (fn) {
    reconnectHandler = fn;
};

function wrappedRequest(url, args) {
    return nativeRequest(url, args).then(function (resp) {
        markUp();
        return resp;
    }, function (err) {
        let code = err && err.code;

        if (code === 0 || code === 502 || code === 503 || code === 504) {
            markDown();
        }

        throw err;
    });
}

function probe() {
    return nativeRequest("/api/ping", {
        method: "GET",
        background: true,
        timeout: PROBE_TIMEOUT_MS
    }).then(function () {
        markUp();
        if (socketUp === false && reconnectHandler) {
            reconnectHandler();
        }
    }).catch(markDown);
}

function scheduleProbe() {
    window.clearTimeout(probeTimer);
    probeTimer = window.setTimeout(probe, (
        connectionMonitor.isOffline()
        ? PROBE_OFFLINE_MS
        : PROBE_ONLINE_MS
    ));
}

function retryNow() {
    window.clearTimeout(probeTimer);
    probe();
}

/**
    Idempotent. Called once, below, at module load -- before the first
    `m.request` call main.js's own top-level `connect()` makes, since
    this script loads just ahead of main.js in index_debug.html.
    @method install
*/
connectionMonitor.install = function () {
    if (installed) {
        return;
    }
    installed = true;
    nativeRequest = m.request;
    m.request = wrappedRequest;
    window.addEventListener("offline", markDown);
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            retryNow();
        }
    });
    scheduleProbe();
};

function formatSince(date) {
    return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}

/**
    The banner -- mount once per page, at the top, alongside (not
    replacing) whatever dialogs that page still has. Renders nothing while
    online.
    @class ConnectionBanner
    @static
    @namespace Components
*/
const connectionBanner = {
    /**
        @method view
        @return {Object} View, or null while online
    */
    view: function () {
        if (!connectionMonitor.isOffline()) {
            return null;
        }

        return m("div", {
            class: "fb-conn-banner",
            role: "alert"
        }, [
            f.icon("cloud_off", "fb-conn-banner-icon", {
                "aria-hidden": "true"
            }),
            m("span", {
                class: "fb-conn-banner-text"
            }, [
                m("strong", "Disconnected from the server."),
                " Changes can't be saved or loaded until it's back" + (
                    offlineSince
                    ? " (since " + formatSince(offlineSince) + ")"
                    : ""
                ) + " — retrying automatically…"
            ]),
            m("button[type=button]", {
                class: "fb-conn-banner-retry",
                onclick: retryNow
            }, "Retry now")
        ]);
    }
};

f.catalog().register("global", "connectionMonitor", connectionMonitor);
f.catalog().register("components", "connectionBanner", connectionBanner);

connectionMonitor.install();
