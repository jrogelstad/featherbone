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
/*jslint node, unordered*/
/*global document, window*/
/**
    Retakes the help's screenshots from a running server.

    Each help folder may carry a `shots.json` beside its `help.json`,
    naming the pictures in `images/` it knows how to take: the steps that
    put the screen in place, and what to capture. Pictures it does not
    name are left alone.

        node scripts/dev/help-shots.js [options] [name...]

        --base <url>       Instance to shoot (default
                           http://localhost:<clientPort>/<database>)
        --user <name>      Sign in as (default pgUser in config.json)
        --password <pw>    (default pgPassword in config.json)
        --package <dir>    Shoot a package's modules instead of Core's
        --setup <name>     Shoot the pictures that need that setup of the
                           demo data (default: the ones that need none);
                           help-shots-stage.js makes the setups
        --dry-run          Take nothing; list what would be taken

    A name narrows the run to the pictures whose file name contains it.
    Playwright is not a dependency: `npm install --no-save playwright`
    and `npx playwright install chromium` once.

    shots.json:

        {
            "viewport": {"width": 1024, "height": 538},
            "shots": {
                "<file>.png": {
                    "steps": [...],
                    "element": "<selector>",    // or several in an
                    "pad": 8                    //   array; or "below":
                }                               //   <selector>, the window
                                                //   from its top down; or
                                                //   "clip": {x, y, width,
                                                //   height}; else the
                                                //   window
            }
        }

    "callouts" draws labelled boxes over the picture before it is taken:
    [{"text": "...", "at": [x, y], "width": 150, "to": "<selector>" or
    [x, y], "dx": 0, "dy": 0, "color": "#e8742a"}], the line running from
    the box to the target. Points are as seen in the picture itself, from
    its top left corner; a selector is the element's middle.

    "setup" names the state the demo data must be in for the picture:
    "enterprise", "billing" or "locations", as help-shots-stage.js makes
    them; the run does not change the instance, it only chooses which
    pictures suit how it is set up.

    "pdf" takes the picture from a printed form instead of the screen:
    {"click": "<the button that downloads it>", "page": 1, "width": 1024}
    (needs poppler's pdftoppm; the form prints the company logo from
    files/upload, so the instance needs that file).

    "after" lists steps run once the picture is taken, to undo what
    the shot left behind: a filter or sort is remembered for the user,
    so a shot that sets one should revert the workbook.

    Steps, one key each, run in order: `go` route; `record`
    [feather, {property: value}] opens its form; `click`, `dblclick`,
    `rightclick`, `hover` selector; `clickif` selector clicks it only if
    it is there; `fill` [selector, text]; `select` [selector, value];
    `type` [selector, text] keys it in one press at a time, for the
    cells that ignore `fill`; `press` key; `drag` [from, over, dx]
    drops the element dx pixels to its right over another (widening a
    column is its grabber dropped over the next header); `wait` ms or
    selector;
    `eval` script run in the page. Selectors are Playwright's.
*/
"use strict";

const fsp = require("fs").promises;
const os = require("os");
const path = require("path");
const {execFile} = require("child_process");
const {promisify} = require("util");

const run = promisify(execFile);

const ROOT = path.join(__dirname, "..", "..");

function options() {
    let args = process.argv.slice(2);
    let opts = {names: []};
    let flags = ["base", "user", "password", "package", "setup"];

    while (args.length) {
        let arg = args.shift();
        let flag = arg.replace(/^--/, "");

        if (flags.includes(flag)) {
            opts[flag] = args.shift();
        } else if (arg === "--dry-run") {
            opts.dryRun = true;
        } else if (arg.startsWith("--")) {
            opts.unknown = arg;
        } else {
            opts.names.push(arg);
        }
    }
    if (opts.unknown) {
        throw new Error("Unknown option " + opts.unknown);
    }
    return opts;
}

async function exists(file) {
    try {
        await fsp.access(file);
        return true;
    } catch (ignore) {
        return false;
    }
}

async function config() {
    let file = path.join(ROOT, "server", "config.json");

    if (!await exists(file)) {
        return {};
    }
    return JSON.parse(await fsp.readFile(file, "utf8"));
}

// The help folders to shoot: Core's own, or each module's in a package
async function folders(pkg) {
    let dirs;
    let has;

    if (!pkg) {
        return [path.join(ROOT, "help")];
    }
    dirs = (await fsp.readdir(pkg, {withFileTypes: true})).filter(
        (d) => d.isDirectory()
    ).map(
        (d) => path.join(pkg, d.name, "help")
    );
    has = await Promise.all(dirs.map(
        (dir) => exists(path.join(dir, "shots.json"))
    ));
    return dirs.filter((ignore, i) => has[i]);
}

function spinal(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

async function route(page, hash) {
    await page.evaluate(function (where) {
        window.location.hash = where;
    }, hash);
}

async function openRecord(page, base, feather, where) {
    let def = await page.request.get(base + "/feather/" + feather);
    let resp;
    let rows;

    def = await def.json();
    resp = await page.request.post(base + "/data/" + spinal(def.plural), {
        data: {
            filter: {
                criteria: Object.keys(where).map(
                    (property) => ({property, value: where[property]})
                )
            }
        }
    });
    rows = await resp.json();
    if (!Array.isArray(rows) || !rows.length) {
        throw new Error("No " + feather + " " + JSON.stringify(where));
    }
    await route(page, "#!/edit/" + spinal(feather) + "/" + rows[0].id);
}

async function settle(page) {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
}

// Keys one at a time, for the cells that only hear key presses (`fill`
// sets the value without them)
async function typeInto(page, selector, text) {
    let field = page.locator(selector).first();

    await field.click();
    await field.press("Control+a");
    await field.pressSequentially(text, {delay: 60});
}

// Drag one element and drop it `dx` pixels to the right, over another
async function drag(page, from, over, dx) {
    let source = page.locator(from).first();
    let target = page.locator(over).first();
    let a = await source.boundingBox();
    let b = await target.boundingBox();
    let startX = a.x + a.width / 2;

    await source.dragTo(target, {
        sourcePosition: {x: a.width / 2, y: a.height / 2},
        targetPosition: {x: startX + dx - b.x, y: b.height / 2}
    });
}

async function step(page, base, s) {
    let kind = Object.keys(s)[0];
    let arg = s[kind];

    switch (kind) {
    case "go":
        await route(page, "#!" + arg);
        break;
    case "record":
        await openRecord(page, base, arg[0], arg[1]);
        break;
    case "click":
    case "dblclick":
    case "hover":
        await page.locator(arg).first()[kind]();
        break;
    case "clickif":
        // Only when it is there: for a setting that is remembered, so
        // it may or may not be on already
        if (await page.locator(arg).count()) {
            await page.locator(arg).first().click();
        }
        break;
    case "rightclick":
        await page.locator(arg).first().click({button: "right"});
        break;
    case "drag":
        await drag(page, arg[0], arg[1], arg[2]);
        break;
    case "fill":
        await page.locator(arg[0]).first().fill(arg[1]);
        break;
    case "type":
        await typeInto(page, arg[0], arg[1]);
        break;
    case "select":
        await page.locator(arg[0]).first().selectOption(arg[1]);
        break;
    case "press":
        await page.keyboard.press(arg);
        break;
    case "wait":
        if (typeof arg === "number") {
            await page.waitForTimeout(arg);
        } else {
            await page.locator(arg).first().waitFor();
        }
        break;
    case "eval":
        await page.evaluate(arg);
        break;
    default:
        throw new Error("Unknown step " + kind);
    }
    await settle(page);
}

// One after another, in order
function runSteps(page, base, steps) {
    let list = steps || [];

    return list.reduce(function (prev, s, i) {
        return prev.then(
            () => step(page, base, s)
        ).catch(function (e) {
            // Say which step, so a long recipe is not guesswork; the
            // steps after it each see the same failure, and leave it be
            if (!e.step) {
                e.step = i + 1;
                e.message = (
                    "step " + e.step + " " + JSON.stringify(s) + ": " +
                    e.message
                );
            }
            return Promise.reject(e);
        });
    }, Promise.resolve());
}

// The box around one element, or several, padded
async function around(page, selectors, pad) {
    let boxes = await Promise.all(selectors.map(
        (sel) => page.locator(sel).first().boundingBox()
    ));
    let left = Math.min(...boxes.map((b) => b.x)) - pad;
    let top = Math.min(...boxes.map((b) => b.y)) - pad;
    let right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
    let bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;

    left = Math.max(0, left);
    top = Math.max(0, top);
    return {x: left, y: top, width: right - left, height: bottom - top};
}

// The window from an element's top edge down, leaving the ribbon out
async function below(page, selector, viewport) {
    let box = await page.locator(selector).first().boundingBox();
    let top = Math.max(0, Math.floor(box.y));

    return {
        x: 0,
        y: top,
        width: viewport.width,
        height: viewport.height - top
    };
}

// A run that cannot sign in would photograph the sign-in page 100 times
async function signInOrStop(browser, opts) {
    let context = await browser.newContext();
    let resp = await context.request.post(opts.base + "/sign-in", {
        data: {username: opts.user, password: opts.password}
    });

    await context.close();
    if (!resp.ok()) {
        throw new Error(
            "Cannot sign in to " + opts.base + " as " + opts.user + ": " +
            resp.status()
        );
    }
}

// Callouts drawn over the page before the picture is taken: a labelled
// box at `at` [x, y], width `width`, joined by a line to `to`, which is
// an element's selector or a point [x, y]
async function callouts(page, list, origin) {
    let marks = [];
    let i = 0;
    let c;
    let box;
    let to;

    while (i < list.length) {
        c = list[i];
        i += 1;
        if (typeof c.to === "string") {
            box = await page.locator(c.to).first().boundingBox();
            to = [
                box.x + box.width / 2 + (c.dx || 0),
                box.y + box.height / 2 + (c.dy || 0)
            ];
        } else {
            to = [c.to[0] + origin[0], c.to[1] + origin[1]];
        }
        marks.push({
            at: [c.at[0] + origin[0], c.at[1] + origin[1]],
            color: c.color || "#e8742a",
            text: c.text,
            to,
            width: c.width || 150
        });
    }

    await page.evaluate(function (items) {
        let svgNs = "http://www.w3.org/2000/svg";
        let layer = document.createElement("div");
        let svg = document.createElementNS(svgNs, "svg");

        layer.style.cssText = (
            "position:fixed;left:0;top:0;width:100%;height:100%;" +
            "z-index:2147483647;pointer-events:none;"
        );
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.cssText = "position:absolute;left:0;top:0;";
        layer.appendChild(svg);
        // In the page first, or the boxes have no measure to draw from
        document.body.appendChild(layer);
        items.forEach(function (m) {
            let div = document.createElement("div");
            let line = document.createElementNS(svgNs, "line");
            let rect;
            let sx;
            let sy;

            div.textContent = m.text;
            div.style.cssText = (
                "position:absolute;left:" + m.at[0] + "px;top:" +
                m.at[1] + "px;width:" + m.width + "px;padding:8px 10px;" +
                "box-sizing:border-box;border-radius:3px;color:#fff;" +
                "font:600 15px/1.25 Arial,Helvetica,sans-serif;" +
                "text-align:center;background:" + m.color + ";"
            );
            layer.appendChild(div);
            rect = div.getBoundingClientRect();
            // Leave from the middle of the side nearest the target
            sx = Math.min(Math.max(m.to[0], rect.left), rect.right);
            sy = Math.min(Math.max(m.to[1], rect.top), rect.bottom);
            if (m.to[0] > rect.left && m.to[0] < rect.right) {
                sx = rect.left + rect.width / 2;
            }
            if (m.to[1] > rect.top && m.to[1] < rect.bottom) {
                sy = rect.top + rect.height / 2;
            }
            line.setAttribute("x1", sx);
            line.setAttribute("y1", sy);
            line.setAttribute("x2", m.to[0]);
            line.setAttribute("y2", m.to[1]);
            line.setAttribute("stroke", "#7b3a1c");
            line.setAttribute("stroke-width", "1.5");
            svg.appendChild(line);
        });
    }, marks);
}

async function capture(page, shot, viewport, file) {
    let opts = {animations: "disabled", caret: "hide", path: file};
    let origin;

    if (shot.element) {
        opts.clip = await around(
            page,
            (
                Array.isArray(shot.element)
                ? shot.element
                : [shot.element]
            ),
            shot.pad || 0
        );
    } else if (shot.below) {
        opts.clip = await below(page, shot.below, viewport);
        if (shot.height) {
            opts.clip.height = shot.height;
        }
    } else if (shot.clip) {
        opts.clip = shot.clip;
    }
    if (shot.callouts) {
        // Positions are as seen in the picture, so shift by its origin
        origin = opts.clip || {};
        await callouts(
            page,
            shot.callouts,
            [origin.x || 0, origin.y || 0]
        );
    }
    await page.screenshot(opts);
}

/*
    A printed form is a PDF the app hands over as a download, so the
    picture is its page, rasterised with pdftoppm (poppler): the shot's
    "pdf" is {"click": "<the Download button>", "page": 1, "width": 1024}
*/
async function printed(page, pdf, file) {
    let dir = await fsp.mkdtemp(path.join(os.tmpdir(), "help-shot-"));
    let src = path.join(dir, "form.pdf");
    let [download] = await Promise.all([
        page.waitForEvent("download", {timeout: 30000}),
        page.click(pdf.click)
    ]);

    await download.saveAs(src);
    await run("pdftoppm", [
        "-png", "-singlefile",
        "-f", String(pdf.page || 1), "-l", String(pdf.page || 1),
        "-scale-to-x", String(pdf.width || 1024), "-scale-to-y", "-1",
        src, path.join(dir, "page")
    ]);
    await fsp.copyFile(path.join(dir, "page.png"), file);
    await fsp.rm(dir, {recursive: true});
}

async function shoot(browser, opts, list, name, file) {
    let shot = list.shots[name];
    let viewport = shot.viewport || list.viewport || {
        width: 1024,
        height: 640
    };
    let context = await browser.newContext({
        acceptDownloads: true,
        viewport
    });
    let page = await context.newPage();
    let failure;

    try {
        await page.request.post(opts.base + "/sign-in", {
            data: {username: opts.user, password: opts.password}
        });
        await page.goto(opts.base + "/");
        await settle(page);
        await runSteps(page, opts.base, shot.steps);
        if (shot.pdf) {
            await printed(page, shot.pdf, file);
        } else {
            await capture(page, shot, viewport, file);
        }
    } catch (e) {
        failure = e;
    }
    // Undo what the shot left behind, such as a remembered filter, even
    // when the shot itself failed, or the next try starts from a mess
    try {
        await runSteps(page, opts.base, shot.after);
    } catch (e) {
        failure = failure || e;
    }
    await context.close();
    if (failure) {
        return Promise.reject(failure);
    }
}

function loadPlaywright() {
    try {
        return require("playwright");
    } catch (ignore) {
        return undefined;
    }
}

async function jobsFor(opts) {
    let jobs = [];
    let dirs = await folders(opts.package);
    let lists = await Promise.all(dirs.map(
        (dir) => fsp.readFile(path.join(dir, "shots.json"), "utf8")
    ));

    dirs.forEach(function (dir, i) {
        let list = JSON.parse(lists[i]);

        Object.keys(list.shots).filter(
            (name) => (list.shots[name].setup || "") === (
                opts.setup || ""
            )
        ).filter(
            (name) => !opts.names.length || opts.names.some(
                (n) => name.includes(n)
            )
        ).forEach(function (name) {
            jobs.push({list, name, file: path.join(dir, "images", name)});
        });
    });
    return jobs;
}

async function main() {
    let opts = options();
    let conf = await config();
    let playwright;
    let browser;
    let taken = 0;
    let failed = [];
    let jobs;
    let failure;

    opts.base = opts.base || (
        "http://localhost:" + (conf.clientPort || 80) + "/" +
        (conf.pgDatabase || "demo")
    );
    opts.base = opts.base.replace(/\/$/, "");
    opts.user = opts.user || conf.pgUser;
    opts.password = opts.password || conf.pgPassword;
    jobs = await jobsFor(opts);

    if (opts.dryRun) {
        jobs.forEach(function (j) {
            console.log(path.relative(process.cwd(), j.file));
        });
        return;
    }

    playwright = loadPlaywright();
    if (!playwright) {
        throw new Error(
            "Needs Playwright: npm install --no-save playwright && " +
            "npx playwright install chromium"
        );
    }
    browser = await playwright.chromium.launch();
    try {
        await signInOrStop(browser, opts);
        await jobs.reduce(function (prev, j) {
            return prev.then(async function () {
                try {
                    await shoot(browser, opts, j.list, j.name, j.file);
                    taken += 1;
                    console.log("took " + j.name);
                } catch (e) {
                    failed.push(j.name);
                    console.log(
                        "FAILED " + j.name + ": " + e.message.split("\n")[0]
                    );
                }
            });
        }, Promise.resolve());
    } catch (e) {
        failure = e;
    }
    await browser.close();
    if (failure) {
        return Promise.reject(failure);
    }
    console.log(taken + " taken, " + failed.length + " failed");
    if (failed.length) {
        process.exitCode = 1;
    }
}

main().catch(function (e) {
    console.error(e.message);
    process.exitCode = 1;
});
