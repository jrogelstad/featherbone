/*
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*jslint this, browser*/
import State from "./state.js";

/**
    @private
    @method isChild
*/
function isChild(p) {
    return p.type && typeof p.type === "object" && p.type.childOf;
}

/**
    @private
    @method isChild
*/
function isToOne(p) {
    return (
        p.type && typeof p.type === "object" &&
        !p.type.childOf && !p.type.parentOf
    );
}

/**
    @private
    @method isToMany
*/
function isToMany(p) {
    return p.type && typeof p.type === "object" && p.type.parentOf;
}

/**
    A get/set function.
    Includes state handling for events.

    __Example:__

        let p = f.prop();

        p() //
        p("foo") // foo
        p() // foo

        // Disable the property
        p.state().send("disable");
        p("bar") // foo
        p() // foo

        // Enable the property
        p.state().send("enable");
        p("bar") // bar
        p() // bar
 
        // Respond to change events
        p.state().resolve("/Changing").enter(function () {
            let msg = (
                "Value was \"" + p.oldValue() + "\", " +
                "will be \"" + p.newValue() + ".\""
            );
            console.log(msg);
        })
        p("Hello World"); // Value was "bar", will be "Hello World."
                          // Hello World

        // Silence change events
        p.send("silence");
        p("Foo bar)" // Foo bar

        // Enable change events again
        p.send("report");
        p("Moo") // Value was "Foo bar", will be "Moo."
                 // Moo
    @class Property
*/
function createProperty(store, formatter) {
    formatter = formatter || {};

    let newValue;
    let oldValue;
    let proposed;
    let p;
    let state;
    let alias;
    let isReadOnly = false;
    let isRequired = false;

    function defaultTransform(value) {
        return value;
    }

    function revert() {
        store = oldValue;
    }

    formatter.toType = formatter.toType || defaultTransform;
    formatter.fromType = formatter.fromType || defaultTransform;

    // Define state
    state = State.define(function () {
        this.state("Ready", function () {
            this.event("change", function () {
                this.goto("../Changing");
            });
            this.event("silence", function () {
                this.goto("../Silent");
            });
            this.event("disable", function () {
                this.goto("../Disabled");
            });
        });
        this.state("Changing", function () {
            this.event("changed", function () {
                this.goto("../Ready");
            });
        });
        this.state("Silent", function () {
            this.event("report", function () {
                this.goto("../Ready");
            });
            this.event("disable", function () {
                this.goto("../Disabled");
            });
        });
        this.state("Disabled", function () {
            // Attempts to make changes from disabled mode revert back
            this.event("changed", revert);
            this.event("enable", function () {
                this.goto("../Ready");
            });
        });
    });

    // Private function that will be returned
    p = function (...args) {
        let value = args[0];

        if (args.length) {
            if (p.state().current()[0] === "/Changing") {
                return p.newValue(value);
            }

            proposed = formatter.toType(value);

            if (proposed === store) {
                return;
            }

            newValue = value;
            oldValue = store;

            p.state().send("change");
            store = (
                value === newValue
                ? proposed
                : formatter.toType(newValue)
            );
            p.state().send("changed");
            newValue = undefined;
            oldValue = undefined;
            proposed = undefined;
        }

        return formatter.fromType(store);
    };

    /**
        Alternate user friendly name for property.

        @method alias
        @param {String} Alias name
        @return {String}
    */
    p.alias = function (...args) {
        if (args.length) {
            alias = args[0];
        }
        return alias;
    };
    /**
        @method newValue
        @return {Property.NewValue}
    */
    p.newValue = function (...args) {
        if (args.length && p.state().current()[0] === "/Changing") {
            newValue = args[0];
        }

        return newValue;
    };
    /**
        @method newValue.toJSON
        @return {Object}
    */
    p.newValue.toJSON = function () {
        if (
            typeof newValue === "object" && newValue !== null &&
            typeof newValue.toJSON === "function"
        ) {
            return newValue.toJSON();
        }

        return formatter.toType(newValue);
    };
    /**
        Use when in `changing` state.

        @method oldValue
        @for Property
        @return {Property.OldValue}
    */
    p.oldValue = function () {
        return formatter.fromType(oldValue);
    };
    /**
        @method oldValue.toJSON
        @return {Object}
    */
    p.oldValue.toJSON = function () {
        return oldValue;
    };
    /**
        @method state
        @for Property
        @return {State}
    */
    p.state = function () {
        return state;
    };

    /**
        @method toJSON
        @return {Object}
    */
    p.toJSON = function () {
        if (
            typeof store === "object" && store !== null &&
            typeof store.toJSON === "function"
        ) {
            return store.toJSON();
        }

        return store;
    };
    /**
        @method isReadOnly
        @param {Boolean} value Is read only
        @return {Boolean}
    */
    p.isReadOnly = function (value) {
        if (value !== undefined) {
            isReadOnly = Boolean(value);
        }
        return isReadOnly || state.current()[0] !== "/Ready";
    };
    /**
        @method isRequired
        @param {Boolean} value Is required
        @return {Boolean}
    */
    p.isRequired = function (value) {
        if (value !== undefined) {
            isRequired = Boolean(value);
        }
        return isRequired;
    };
    /**
        @method isToOne
        @return {Boolean}
    */
    p.isToOne = function () {
        return isToOne(p);
    };
    /**
        @method isToMany
        @return {Boolean}
    */
    p.isToMany = function () {
        return isToMany(p);
    };
    /**
        @method isChild
        @return {Boolean}
    */
    p.isChild = function () {
        return isChild(p);
    };

    store = formatter.toType(store);
    state.goto();

    return p;
}

export default Object.freeze(createProperty);
