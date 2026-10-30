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
/*global marked*/
/**
    The help window (ADR-003): the page `/<database>/help` runs, which the
    app opens as one named pop-out and then sends topics to.

    It asks the server which page answers for a form or a feather, fetches
    that page from the module version this database deployed, and renders
    the Markdown here -- the reader installs nothing. Help pages are part
    of a package, so they are as trusted as the module's own code.

    The window keeps its own history, so Back goes back through the topics
    the reader has read rather than closing. It records its size and
    position as it goes, and the app asks for the same placement next
    time (client/help.js).
*/
(function () {
    "use strict";

    const PLACE = "fb-help-window";
    const main = document.getElementById("fb-help-main");
    const pages = document.getElementById("fb-help-pages");
    const where = document.getElementById("fb-help-where");
    const back = document.getElementById("fb-help-back");
    const contentsButton = document.getElementById("fb-help-contents");
    const forward = document.getElementById("fb-help-forward");
    // "/<database>/help" -- the window is served by the instance it is for
    const db = window.location.pathname.split("/")[1];

    // Where in its own history the window is, for the arrows
    let depth = 0;
    let deepest = 0;
    let current = {};

    function urlOf(module, path) {
        return (
            "/" + encodeURIComponent(db) + "/help/" +
            encodeURIComponent(module) + "/" + path.split("/").map(
                encodeURIComponent
            ).join("/")
        );
    }

    function say(message) {
        main.innerHTML = "";
        let p = document.createElement("p");

        p.className = "note";
        p.textContent = message;
        main.appendChild(p);
    }

    function arrows() {
        back.disabled = depth < 1;
        forward.disabled = depth >= deepest;
    }

    /*
        Links inside a page: another Markdown page is a topic to show
        here, a picture or anything else is resolved against the module
        the page came from, and an outside link opens in a tab of its own
        rather than taking the help window somewhere else.
    */
    function resolve(module, path) {
        let dir = path.split("/").slice(0, -1).join("/");
        // A scheme ("https:") or a leading slash means it is not ours
        const theirs = new RegExp("^[a-z]+:|^/", "i");
        const scheme = new RegExp("^[a-z]+:", "i");

        function within(src) {
            return (
                dir
                ? dir + "/" + src
                : src
            );
        }

        Array.from(main.querySelectorAll("img[src]")).forEach(function (img) {
            let src = img.getAttribute("src");

            if (!theirs.test(src)) {
                img.setAttribute("src", urlOf(module, within(src)));
            }
        });

        Array.from(main.querySelectorAll("a[href]")).forEach(function (a) {
            let href = a.getAttribute("href");

            if (href.startsWith("#")) {
                return;
            }
            if (scheme.test(href)) {
                a.setAttribute("target", "_blank");
                a.setAttribute("rel", "noopener");
                return;
            }
            if (href.endsWith(".md")) {
                a.addEventListener("click", function (e) {
                    e.preventDefault();
                    go({module, path: within(href)}, true);
                });
                return;
            }
            a.setAttribute("href", urlOf(module, within(href)));
        });
    }

    // The contents list of the module whose page is open
    function contents(topic) {
        pages.innerHTML = "";

        let list = topic.pages || [];

        if (list.length < 2) {
            pages.style.display = "none";
            return;
        }
        pages.style.display = "";
        list.forEach(function (page) {
            let option = document.createElement("option");

            option.value = page.path;
            option.textContent = page.title || page.path;
            option.selected = page.path === topic.path;
            pages.appendChild(option);
        });
    }

    function supplement(link) {
        if (!link || !link.resource) {
            return;
        }
        let box = document.createElement("div");
        let head = document.createElement("h4");
        let p = document.createElement("p");
        let a = document.createElement("a");

        box.className = "supplement";
        head.textContent = "From your organization";
        a.href = link.resource;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = link.label || link.resource;
        p.appendChild(a);
        box.appendChild(head);
        box.appendChild(p);
        main.insertBefore(box, main.firstChild);
    }

    /*
        Everything there is help for. How workbooks, filters and
        settings work is not about any one worksheet, so it has to be
        readable without being on the page it is about: this is that
        way in, and the app opens the window here from its own Help
        (client/help.js).
    */
    async function renderContents() {
        let resp = await window.fetch(
            "/" + encodeURIComponent(db) + "/help-contents"
        );

        if (!resp.ok) {
            say("Help could not be loaded.");
            return;
        }

        let shelves = await resp.json();

        main.innerHTML = "";
        pages.style.display = "none";
        where.textContent = "Contents";
        document.title = "Help - Contents";

        let head = document.createElement("h1");

        head.textContent = "Help";
        main.appendChild(head);

        shelves.forEach(function (shelf) {
            let box = document.createElement("div");
            let title = document.createElement("h2");
            let list = document.createElement("ul");

            box.className = "shelf";
            title.textContent = shelf.title;
            box.appendChild(title);

            shelf.pages.forEach(function (page) {
                let item = document.createElement("li");
                let link = document.createElement("a");

                link.href = "#";
                link.textContent = page.title || page.path;
                link.addEventListener("click", function (e) {
                    e.preventDefault();
                    go({module: shelf.module, path: page.path}, true);
                });
                item.appendChild(link);
                list.appendChild(item);
            });
            box.appendChild(list);
            main.appendChild(box);
        });
        window.scrollTo(0, 0);
    }

    async function render(topic) {
        let resp = await window.fetch(urlOf(topic.module, topic.path));

        if (!resp.ok) {
            say("That help page is not on this server.");
            return;
        }
        main.innerHTML = marked.parse(await resp.text());
        resolve(topic.module, topic.path);
        supplement(topic.supplement);
        contents(topic);
        where.textContent = topic.title || topic.module;
        document.title = (
            "Help" + (
                topic.title
                ? " - " + topic.title
                : ""
            )
        );
        window.scrollTo(0, 0);
    }

    /*
        Show a topic. `asked` is a topic the reader chose here, which
        moves the window's own history on; a topic the app sent replaces
        where the window is instead, so the arrows do not walk through
        every click the reader made in the app.
    */
    async function go(topic, asked) {
        current = topic;

        if (asked) {
            depth += 1;
            deepest = depth;
            window.history.pushState({depth, topic}, "");
        } else {
            window.history.replaceState({depth, topic}, "");
        }
        arrows();

        try {
            if (topic.contents) {
                await renderContents();
            } else if (topic.module && topic.path) {
                await render(topic);
            } else {
                await lookup(topic, asked);
            }
        } catch (err) {
            say(err.message || "Help could not be loaded.");
        }
    }

    // Which page answers for a form or a feather
    async function lookup(topic, asked) {
        let query = [];

        if (topic.form) {
            query.push("form=" + encodeURIComponent(topic.form));
        }
        if (topic.feather) {
            query.push("feather=" + encodeURIComponent(topic.feather));
        }

        let resp = await window.fetch(
            "/" + encodeURIComponent(db) + "/help-topic?" + query.join("&")
        );

        if (!resp.ok) {
            say(
                resp.status === 401
                ? "Sign in to the application to read help."
                : "Help could not be loaded."
            );
            return;
        }

        let found = await resp.json();

        if (!found || !found.path) {
            say("There is no help for this page yet.");
            contents({});
            return;
        }
        await go(Object.assign({}, topic, found), asked);
    }

    function asked() {
        let params = new window.URLSearchParams(window.location.search);
        let ret = {};

        if (params.get("contents")) {
            return {contents: true};
        }

        ["feather", "form", "module", "path"].forEach(function (key) {
            if (params.get(key)) {
                ret[key] = params.get(key);
            }
        });

        return ret;
    }

    /*
        Where the window is on the screen, for the app to ask for the
        same placement next time. Written as it moves rather than on
        close: a window closed by the operating system gets no event in
        every browser.
    */
    function remember() {
        try {
            window.localStorage.setItem(PLACE, JSON.stringify({
                height: window.outerHeight,
                left: window.screenX,
                top: window.screenY,
                width: window.outerWidth
            }));
        } catch (ignore) {
            return;
        }
    }

    marked.use({gfm: true});

    pages.addEventListener("change", function () {
        go({module: current.module, path: pages.value}, true);
    });
    contentsButton.addEventListener(
        "click",
        () => go({contents: true}, true)
    );
    back.addEventListener("click", () => window.history.back());
    forward.addEventListener("click", () => window.history.forward());
    document.getElementById("fb-help-print").addEventListener(
        "click",
        () => window.print()
    );

    window.addEventListener("popstate", function (event) {
        let state = event.state;

        if (!state || !state.topic) {
            return;
        }
        depth = state.depth;
        arrows();
        current = state.topic;

        let shown = (
            state.topic.contents
            ? renderContents()
            : render(state.topic)
        );

        shown.catch(function (err) {
            say(err.message || "Help could not be loaded.");
        });
    });

    /*
        The app sends the next topic here instead of opening another
        window. Only this origin may: the window is signed in.
    */
    window.addEventListener("message", function (event) {
        if (event.origin !== window.location.origin) {
            return;
        }
        let data = event.data || {};

        if (data.type !== "fb-help-topic") {
            return;
        }
        go(data.topic || {}, false);
    });

    window.addEventListener("resize", remember);
    window.addEventListener("pagehide", remember);
    window.setInterval(remember, 5000);

    go(asked(), false);
}());
