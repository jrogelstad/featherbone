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
/*jslint browser, unordered*/
/*global f, m*/
/**
    The dashboard's drawing kit: the small set of marks every tile is built
    from, as inline SVG with no charting library -- the same approach
    Documents/ddom takes in its zone chart, and for the same reasons. Every
    colour is a CSS class rather than a literal, so dark mode and the theme
    tokens apply without this file knowing anything about them.

    Registered globally as "dashboardDraw" (the pattern sseState and
    connectionMonitor use) rather than exported, because component files in
    this codebase do not import one another.

    The three marks come from Stephen Few, *Information Dashboard Design*,
    which John set as the standard for this work (see the project docs
    `claude/dashboard-design-rules-few.md` and
    `claude/featherbone-dashboard-design.md`):

      - **bullet**, Few's own invention and his answer to the gauge. It says
        everything a gauge says in a fraction of the space, and a column of
        them can be scanned preattentively: where the measure passes its
        comparative marker, bar and marker form a cross.
      - **sparkline**, Tufte's "data-intense, design-simple, word-size
        graphic". Deliberately has no quantitative scale -- its job is
        historical context for a current value, not precision.
      - **bar**, zero-based, for ranked comparisons across a dimension.

    Deliberately absent: gauges, dials, pie and donut, area and radar. Not
    discouraged in a comment somewhere -- simply not provided, so the easy
    path is the one that communicates.
*/
const DASH_BAND_LIMIT = 5;

/**
    Clamps a value into 0..length along a zero-based scale.
*/
function dashScale(value, max, length) {
    let n = Number(value);

    if (!max || !Number.isFinite(n)) {
        return 0;
    }
    return Math.max(0, Math.min(1, n / max)) * length;
}

/**
    Rounds a scale maximum up to a readable number -- 1, 2, 2.5 or 5 times a
    power of ten. Without this, an axis over a raw maximum lands its ticks on
    values like 650,000 and 1,300,000, which round to the same label and
    print "$1M" twice. The tile should call this once and pass the result to
    every bullet in the group AND to the axis beneath them, so the bars stay
    comparable and the scale is stated once, correctly.

    @param {Number} value Largest value the scale must cover.
    @return {Number}
*/
function dashNiceMax(value) {
    let n = Number(value);
    let magnitude;
    let normalized;
    let step;

    if (!Number.isFinite(n) || n <= 0) {
        return 1;
    }
    magnitude = Math.pow(10, Math.floor(Math.log10(n)));
    normalized = n / magnitude;
    if (normalized <= 1) {
        step = 1;
    } else if (normalized <= 2) {
        step = 2;
    } else if (normalized <= 2.5) {
        step = 2.5;
    } else if (normalized <= 5) {
        step = 5;
    } else {
        step = 10;
    }
    return step * magnitude;
}

/**
    A bullet graph.

    Few's design spec, in order of what it encodes: qualitative range bands
    behind, the performance measure as a bar, the comparative measure as a
    symbol marker. The bands are intensities of ONE hue, never a red/amber/
    green set -- around a tenth of men cannot reliably separate those hues,
    while intensities of any single hue stay legible to everyone, and the
    same ramp survives a dark theme.

    @param {Object} opts
    @param {Number} opts.value Performance measure.
    @param {Number} [opts.comparison] Target, prior year or prior period.
        Omitted draws no marker, which is what an absent comparison must
        look like -- not a zero, and not a hidden row.
    @param {Number} opts.max Top of the quantitative scale.
    @param {Array} [opts.ranges] Up to four ascending fractions of max,
        giving up to five bands. Few's practical limit is five; beyond that
        the distinction stops being perceptible.
    @param {Boolean} [opts.zeroBased] Defaults true. A bar encodes value by
        LENGTH, so its scale must start at zero. When it cannot -- a scale
        narrowed to show detail -- pass false and the measure is drawn as a
        symbol marker instead, whose changed form is itself the warning that
        the scale does not start at zero.
    @param {String} [opts.title] Hover text.
    @return {Object} Mithril vnode
*/
function dashBullet(opts) {
    let o = opts || {};
    let width = o.width || 160;
    let height = o.height || 16;
    let given = o.ranges || [];
    let ranges = given.slice(0, DASH_BAND_LIMIT - 1);
    let barHeight = Math.max(4, Math.round(height / 3));
    let markHeight = Math.max(8, Math.round(height * 0.7));
    let parts = [];
    let previous = 0;
    let bands = ranges.concat(1);

    // Qualitative bands, worst (darkest) first, lightening rightwards.
    bands.forEach(function (fraction, index) {
        let from = dashScale(previous, 1, width);
        let to = dashScale(fraction, 1, width);

        parts.push(m("rect", {
            class: "fb-dash-band fb-dash-band-" + (index + 1),
            x: from,
            y: 0,
            width: Math.max(0, to - from),
            height
        }));
        previous = fraction;
    });

    // The performance measure.
    if (o.zeroBased === false) {
        parts.push(m("circle", {
            class: "fb-dash-bullet-point",
            cx: dashScale(o.value, o.max, width),
            cy: height / 2,
            r: Math.max(3, barHeight / 2)
        }));
    } else {
        parts.push(m("rect", {
            class: "fb-dash-bullet-value",
            x: 0,
            y: (height - barHeight) / 2,
            width: dashScale(o.value, o.max, width),
            height: barHeight
        }));
    }

    // The comparative measure. Absent means absent.
    if (o.comparison !== undefined && o.comparison !== null) {
        let at = dashScale(o.comparison, o.max, width);

        parts.push(m("line", {
            class: "fb-dash-bullet-marker",
            x1: at,
            x2: at,
            y1: (height - markHeight) / 2,
            y2: (height + markHeight) / 2
        }));
    }

    if (o.title) {
        parts.push(m("title", o.title));
    }

    return m("svg", {
        class: "fb-dash-bullet",
        viewBox: "0 0 " + width + " " + height,
        width,
        height,
        role: "img",
        preserveAspectRatio: "none"
    }, parts);
}

/**
    A sparkline: the recent history of one measure, word-sized.

    No axis and no scale by design. The series is scaled to its own range
    rather than to zero, because the point is the SHAPE -- whether the thing
    is rising, falling or lumpy -- and a zero-based sparkline flattens that
    shape into a straight line whenever the values sit well above zero.

    @param {Object} opts
    @param {Array} opts.points Numbers, oldest first.
    @param {Object} [opts.band] {from, to} acceptable range, drawn behind.
    @param {Boolean} [opts.showDot] Defaults true. Marks the final value,
        tying the line's end to the number printed beside it.
    @return {Object} Mithril vnode
*/
function dashSparkline(opts) {
    let o = opts || {};
    let width = o.width || 90;
    let height = o.height || 18;
    let raw = o.points || [];
    let given = raw.map(Number);
    let points = given.filter(Number.isFinite);
    let parts = [];
    let low;
    let high;
    let span;
    let step;
    let coords;

    if (points.length < 2) {
        // One point has no shape to show, and an empty series must not
        // draw a misleading flat line at zero.
        return m("svg", {
            class: "fb-dash-spark",
            viewBox: "0 0 " + width + " " + height,
            width,
            height,
            role: "img"
        }, []);
    }

    low = Math.min.apply(null, points);
    high = Math.max.apply(null, points);
    span = high - low;
    if (span === 0) {
        // A genuinely flat series: draw it down the middle rather than
        // dividing by zero.
        low -= 1;
        span = 2;
    }
    step = width / (points.length - 1);

    function plot(value, index) {
        return {
            x: index * step,
            y: height - ((value - low) / span) * height
        };
    }

    coords = points.map(plot);

    if (o.band && o.band.to !== undefined) {
        let top = plot(o.band.to, 0).y;
        let bottom = plot(o.band.from || low, 0).y;

        parts.push(m("rect", {
            class: "fb-dash-spark-band",
            x: 0,
            y: Math.min(top, bottom),
            width,
            height: Math.abs(bottom - top)
        }));
    }

    parts.push(m("polyline", {
        class: "fb-dash-spark-line",
        points: coords.map(function (c) {
            return c.x + "," + c.y;
        }).join(" "),
        fill: "none"
    }));

    if (o.showDot !== false) {
        let last = coords[coords.length - 1];

        parts.push(m("circle", {
            class: "fb-dash-spark-dot",
            cx: last.x,
            cy: last.y,
            r: 1.8
        }));
    }

    if (o.title) {
        parts.push(m("title", o.title));
    }

    return m("svg", {
        class: "fb-dash-spark",
        viewBox: "0 0 " + width + " " + height,
        width,
        height,
        role: "img",
        preserveAspectRatio: "none"
    }, parts);
}

/**
    A single zero-based bar, for ranked comparisons across a dimension.

    The scale starts at zero because a bar encodes its value as a LENGTH;
    starting anywhere else produces a bar whose length does not correspond
    to its value, which is the most common way a chart lies. Use `emphasis`
    to pick out one member of the ranking -- Few's "Our Company" treatment,
    done with intensity rather than a second hue.

    @param {Object} opts
    @return {Object} Mithril vnode
*/
function dashBar(opts) {
    let o = opts || {};
    let width = o.width || 160;
    let height = o.height || 12;
    let parts = [m("rect", {
        class: (
            o.emphasis
            ? "fb-dash-bar fb-dash-bar-emphasis"
            : "fb-dash-bar"
        ),
        x: 0,
        y: 0,
        width: dashScale(o.value, o.max, width),
        height
    })];

    if (o.title) {
        parts.push(m("title", o.title));
    }

    return m("svg", {
        class: "fb-dash-bar-svg",
        viewBox: "0 0 " + width + " " + height,
        width,
        height,
        role: "img",
        preserveAspectRatio: "none"
    }, parts);
}

/**
    An axis drawn once beneath a group of bullets or bars, never per row.
    Few's small-multiples rule: repeating the scale on every row spends
    non-data pixels to say the same thing many times, and makes the rows
    harder to compare rather than easier.

    @param {Object} opts
    @return {Object} Mithril vnode
*/
function dashAxis(opts) {
    let o = opts || {};
    let width = o.width || 160;
    let height = o.height || 14;
    // Five intervals suit the maxima dashNiceMax produces: a 2.5M scale
    // ticks every 500k, a 2M scale every 400k, both of which label cleanly.
    let ticks = o.ticks || 5;
    let format = o.format || function (n) {
        return String(n);
    };
    let parts = [m("line", {
        class: "fb-dash-axis-line",
        x1: 0,
        x2: width,
        y1: 0.5,
        y2: 0.5
    })];
    let index = 0;

    while (index <= ticks) {
        let at = (index / ticks) * width;

        parts.push(m("text", {
            class: "fb-dash-axis-text",
            x: Math.min(width - 1, Math.max(1, at)),
            y: height - 3,
            "text-anchor": (
                index === 0
                ? "start"
                : (
                    index === ticks
                    ? "end"
                    : "middle"
                )
            )
        }, format((o.max || 0) * (index / ticks))));
        index += 1;
    }

    return m("svg", {
        class: "fb-dash-axis",
        viewBox: "0 0 " + width + " " + height,
        width,
        height,
        role: "presentation"
    }, parts);
}

f.catalog().register("global", "dashboardDraw", {
    axis: dashAxis,
    bar: dashBar,
    bullet: dashBullet,
    niceMax: dashNiceMax,
    scale: dashScale,
    sparkline: dashSparkline
});
