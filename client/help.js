/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
/*jslint browser*/
/**
    Opening help (ADR-003).

    Help opens in one small window of its own, which the reader can put on
    another screen and leave open. Because the window is named, the
    browser keeps one: asking again sends the next topic to the window
    that is already there -- so it keeps its own Back history -- and
    brings it to the front, rather than opening a second window or a tab
    the app's own tabs then compete with.

    On a phone or a tablet there is nowhere to put a second window, so
    help opens as a tab, which is the right thing there.

    @module Help
*/

const NAME = "featherbone-help";
// Below this there is no room for a window beside the app
const SMALL = 820;
const DEFAULT_PLACE = {height: 820, width: 560};

function placement() {
    let place = DEFAULT_PLACE;

    // Where the reader last put it (client/help-window.js records it)
    try {
        let saved = JSON.parse(window.localStorage.getItem("fb-help-window"));

        if (saved && saved.width > 300 && saved.height > 300) {
            place = saved;
        }
    } catch (ignore) {
        place = DEFAULT_PLACE;
    }

    let features = [
        "popup",
        "width=" + Math.round(place.width),
        "height=" + Math.round(place.height)
    ];

    if (place.left !== undefined && place.top !== undefined) {
        features.push("left=" + Math.round(place.left));
        features.push("top=" + Math.round(place.top));
    }

    return features.join(",");
}

function address(topic) {
    let db = window.location.pathname.split("/")[1];
    let query = Object.keys(topic || {}).filter(
        (key) => topic[key]
    ).map(
        (key) => key + "=" + encodeURIComponent(topic[key])
    );

    return (
        "/" + encodeURIComponent(db) + "/help" + (
            query.length
            ? "?" + query.join("&")
            : ""
        )
    );
}

/**
    Show help for a form, a feather, or neither. Reached as `f.openHelp`,
    which client/core.js attaches before it freezes `f`.

    Nothing is looked up here: the window asks the server which page
    answers, so the app holds no help of its own and a worksheet saved
    years ago is never pointing at the wrong page.

    @method openHelp
    @param {Object} [topic]
    @param {String} [topic.form] Form name
    @param {String} [topic.feather] Feather name
    @param {Boolean} [topic.contents] Open the contents of everything
        there is help for, rather than one topic
    @return {Void}
*/
function openHelp(topic) {
    let url = address(topic);
    let held;
    let fresh;

    if (window.innerWidth < SMALL) {
        window.open(url, "_blank");
        return;
    }

    /*
        Opened with no address, so a window that is already there is
        handed back instead of being navigated, which would throw away
        the history the reader has built up in it.
    */
    held = window.open("", NAME, placement());

    if (!held) {
        window.open(url, "_blank");
        return;
    }

    fresh = (
        !held.location ||
        !held.location.href ||
        held.location.href === "about:blank"
    );

    if (fresh) {
        held.location.replace(url);
    } else {
        held.postMessage({
            topic: topic || {},
            type: "fb-help-topic"
        }, window.location.origin);
    }
    held.focus();
}

export default Object.freeze(openHelp);
