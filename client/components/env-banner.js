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
    @module EnvBanner
*/

const envBanner = {};

/**
    Persistent, high-contrast banner warning that the current session
    is pointed at a test or development system rather than production.
    Deliberately styled distinctly from the muted inline warning/error
    message styling used for transient, per-action messages elsewhere
    (see the ".fb-message" classes) -- those fade after an action
    completes, but this is meant to stay loud and visible for as long
    as the mode is active, so nobody mistakes a staging/demo/dev
    database for the real one just by glancing at the screen.

    Mounted at the top of every screen a signed-in user can land on
    (home, workbook, edit-form, traverse-form, search and settings
    pages) so it's visible no matter how the user got there. There's
    no equivalent on the sign-in screen itself, since the server
    doesn't expose the current mode until after authentication.

    Reads f.currentUser().mode directly on every render rather than
    keeping its own state, since the mode can't change without a
    fresh sign-in.

    @class EnvBanner
    @static
    @namespace Components
*/
envBanner.component = {
    /**
        @method view
        @return {Object} View, or null when not in test or dev mode
    */
    view: function () {
        let mode = f.currentUser().mode;
        let label;

        if (mode !== "test" && mode !== "dev") {
            return null;
        }

        label = (
            mode === "test"
            ? (
                "TEST SYSTEM — this is not the production " +
                "database. Anything entered here is test data."
            )
            : (
                "DEVELOPMENT SYSTEM — this is not the " +
                "production database."
            )
        );

        return m("div", {
            class: "fb-env-banner fb-env-banner-" + mode
        }, [
            f.icon("warning", "fb-env-banner-icon", {
                "aria-hidden": "true"
            }),
            m("span", label)
        ]);
    }
};

f.catalog().register("components", "envBanner", envBanner.component);
