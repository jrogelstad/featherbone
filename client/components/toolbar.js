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

/*jslint this, browser, unordered*/
/*global f, m*/
/**
    @module Toolbar
*/

const toolbar = {};

/**
    Generate view model for a responsive toolbar.

    Takes two ordered lists of Button view models: `primaryButtons`
    always stay visible at the left (they're the actions a user is most
    likely to need -- typically Save/Apply/Done), while `overflowButtons`
    sit at the right, in the order given, and are collapsed starting
    from the END of the list into a "more" (ellipsis) menu whenever the
    toolbar isn't wide enough to show everything on one line -- so put
    the least important ones last. This replaces letting the buttons
    wrap to an ugly second row when the window (or a side panel) gets
    narrow.

    @class Toolbar
    @constructor
    @namespace ViewModels
    @param {Object} [options] Options
    @param {String} [options.id] Id
    @param {String} [options.class] Class for the outer toolbar element
    @param {Array} [options.primaryButtons] Button view models, always
        shown
    @param {Array} [options.overflowButtons] Button view models,
        collapsed into a "more" menu when space runs out
    @param {Function} [options.onkeydown] Passed through to the
        toolbar element (form-level hot key handling)
*/
toolbar.viewModel = function (options) {
    options = options || {};
    let vm = {};

    /**
        @method id
        @return {String}
    */
    vm.id = f.prop(options.id || f.createId());
    /**
        @method class
        @return {String}
    */
    vm.class = f.prop(options.class || "fb-toolbar");
    /**
        @method primaryButtons
        @return {Array}
    */
    vm.primaryButtons = f.prop(options.primaryButtons || []);
    /**
        @method overflowButtons
        @return {Array}
    */
    vm.overflowButtons = f.prop(options.overflowButtons || []);
    /**
        Number of buttons hidden from the end of `overflowButtons`
        into the "more" menu. Recomputed on every resize/redraw by
        the component -- not meant to be set directly.

        @method hiddenCount
        @param {Number} [count]
        @return {Number}
    */
    vm.hiddenCount = f.prop(0);
    /**
        Whether the "more" dropdown is currently open.

        @method showMenu
        @param {Boolean} [value]
        @return {Boolean}
    */
    vm.showMenu = f.prop(false);
    /**
        @method onkeydown
        @return {Function}
    */
    vm.onkeydown = f.prop(options.onkeydown);

    return vm;
};

f.catalog().register("viewModels", "toolbar", toolbar.viewModel);

/**
    Build a lightweight stand-in for a button, used only to measure
    how wide it would render -- never attached with the button's own
    id, so it can never collide with (or steal keyboard focus/hotkey
    lookups from) the real, interactive button rendered elsewhere.

    @method measureNode
    @private
    @param {ViewModels.Button} btn
    @return {Object} vnode
*/
function measureNode(btn) {
    let classes = ["pure-button"];
    let icon = btn.icon();
    let label = btn.label();

    if (btn.isDisabled()) {
        classes.push("fb-button-disabled");
    }
    if (icon && !label) {
        classes.push("fb-icon-only");
    }
    if (btn.class()) {
        classes.push(btn.class());
    }
    if (btn.primaryClass()) {
        classes.push(btn.primaryClass());
    }
    if (btn.hidden()) {
        classes.push(btn.hidden());
    }

    // Mirrors Button's own markup (see button.js) so it measures the
    // same width.
    return m("button", {
        type: "button",
        class: classes.join(" ")
    }, [
        (
            icon
            ? m("i", {
                class: "material-icons-outlined fb-button-icon"
            }, icon)
            : undefined
        ),
        (
            label
            ? m("span", {class: "fb-button-label"}, label)
            : undefined
        )
    ]);
}

/**
    Measure the container's available width against the natural width
    of every button (via the hidden measuring row) and work out how
    many overflow buttons -- counting backward from the END of the
    list, so the last ones given are the first to go -- have to move
    into the "more" menu for everything else to fit on one line beside
    the always-visible primary buttons. Accounts for the toolbar's own
    padding and the flex gap between buttons. Updates vm.hiddenCount()
    and triggers a redraw only when that number actually changes, so
    this is safe to call on every resize and every redraw without
    looping.

    @method fit
    @private
    @param {Object} vm Toolbar view model
*/
function fit(vm) {
    let container = document.getElementById(vm.id());
    let measureRow = document.getElementById(vm.id() + "-measure");
    let children;
    let widths = [];
    let style;
    let gap;
    let available;
    let primaryCount = vm.primaryButtons().length;
    let overflowCount = vm.overflowButtons().length;
    let ellipsisWidth;
    let used = 0;
    let fits = 0;
    let hiddenCount;
    let i = 0;

    if (!container || !measureRow) {
        return;
    }

    children = measureRow.children;
    while (i < children.length) {
        widths.push(children[i].getBoundingClientRect().width);
        i += 1;
    }

    style = window.getComputedStyle(container);
    gap = parseFloat(window.getComputedStyle(measureRow).columnGap) || 0;
    available = (
        container.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0)
    );
    ellipsisWidth = widths[widths.length - 1] || 0;

    // Primary group, plus the minimum space kept between the groups.
    i = 0;
    while (i < primaryCount) {
        used += widths[i] + gap;
        i += 1;
    }
    used += gap * 2;

    // Everything fits?
    i = primaryCount;
    while (i < primaryCount + overflowCount) {
        used += widths[i] + gap;
        i += 1;
    }

    if (used <= available) {
        hiddenCount = 0;
    } else {
        // Keep overflow buttons from the front while they fit next to
        // the "more" button.
        used -= gap;
        i = primaryCount;
        while (i < primaryCount + overflowCount) {
            used -= widths[i] + gap;
            i += 1;
        }
        used += ellipsisWidth;
        i = primaryCount;
        while (i < primaryCount + overflowCount) {
            if (used + widths[i] + gap > available) {
                break;
            }
            used += widths[i] + gap;
            fits += 1;
            i += 1;
        }
        hiddenCount = overflowCount - fits;
    }

    if (hiddenCount !== vm.hiddenCount()) {
        vm.hiddenCount(hiddenCount);
        m.redraw();
    }
}

/**
    Toolbar component

    @class Toolbar
    @static
    @namespace Components
*/
toolbar.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
    */
    oninit: function (vnode) {
        this.viewModel = vnode.attrs.viewModel || toolbar.viewModel(
            vnode.attrs
        );
    },

    /**
        @method oncreate
        @param {Object} vnode Virtual node
    */
    oncreate: function (vnode) {
        let vm = this.viewModel;
        let container = vnode.dom;

        this.observer = new window.ResizeObserver(function () {
            fit(vm);
        });
        this.observer.observe(container);
        fit(vm);
    },

    /**
        @method onupdate
    */
    onupdate: function () {
        fit(this.viewModel);
    },

    /**
        @method onremove
    */
    onremove: function () {
        if (this.observer) {
            this.observer.disconnect();
        }
    },

    /**
        Re-syncs the button lists and class from the latest attrs on
        every redraw (only `hiddenCount`/`showMenu` are the
        component's own persistent state) -- so a caller that rebuilds
        its button view models each render, as form-page.js does,
        doesn't get stuck with whatever list happened to be passed in
        on the first render.

        @method view
        @param {Object} vnode Virtual node
        @return {Object} View
    */
    view: function (vnode) {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let primaryButtons = vnode.attrs.primaryButtons || [];
        let overflowButtons = vnode.attrs.overflowButtons || [];
        let hiddenCount;
        let hidden;
        let visible;
        let hasHidden;
        let allForMeasure = primaryButtons.concat(overflowButtons);

        vm.primaryButtons(primaryButtons);
        vm.overflowButtons(overflowButtons);
        if (vnode.attrs.class !== undefined) {
            vm.class(vnode.attrs.class);
        }
        hiddenCount = vm.hiddenCount();
        visible = overflowButtons.slice(
            0,
            overflowButtons.length - hiddenCount
        );
        hidden = overflowButtons.slice(overflowButtons.length - hiddenCount);
        hasHidden = hidden.length > 0;

        return m("div", {
            id: vm.id(),
            class: vm.class() + " fb-toolbar-responsive",
            onkeydown: vm.onkeydown()
        }, [
            m("div", {
                id: vm.id() + "-measure",
                class: "fb-toolbar-measure",
                "aria-hidden": "true"
            }, allForMeasure.map(measureNode).concat([
                m("button", {
                    type: "button",
                    class: "pure-button fb-icon-only"
                }, [m("i", {
                    class: "material-icons-outlined fb-button-icon"
                }, "more_horiz")])
            ])),
            m("div", {
                class: "fb-toolbar-visible"
            }, primaryButtons.map(function (b) {
                return m(btn, {viewModel: b});
            })),
            m("div", {
                class: "fb-toolbar-visible fb-toolbar-overflow-group"
            }, visible.map(function (b) {
                return m(btn, {viewModel: b});
            }).concat(
                hasHidden
                ? [m("div", {
                    class: "pure-menu fb-menu fb-toolbar-overflow-menu",
                    onmouseout: function (ev) {
                        if (
                            !ev || !ev.relatedTarget ||
                            !ev.relatedTarget.closest ||
                            !ev.relatedTarget.closest(
                                "#" + vm.id() + "-overflow-menu"
                            )
                        ) {
                            vm.showMenu(false);
                        }
                    },
                    id: vm.id() + "-overflow-menu"
                }, [
                    m("button", {
                        type: "button",
                        class: "pure-button fb-icon-only",
                        title: "More actions",
                        onclick: function () {
                            vm.showMenu(!vm.showMenu());
                        }
                    }, [m("i", {
                        class: "material-icons-outlined fb-button-icon"
                    }, "more_horiz")]),
                    m("ul", {
                        class: (
                            "pure-menu-list fb-menu-list " +
                            "fb-toolbar-overflow-list" + (
                                vm.showMenu()
                                ? " fb-menu-list-show"
                                : ""
                            )
                        )
                    }, hidden.map(function (b) {
                        return m("li", {
                            class: "fb-toolbar-overflow-item",
                            onclick: function () {
                                vm.showMenu(false);
                            }
                        }, [m(btn, {viewModel: b})]);
                    }))
                ])]
                : []
            ))
        ]);
    }
};

f.catalog().register("components", "toolbar", toolbar.component);
