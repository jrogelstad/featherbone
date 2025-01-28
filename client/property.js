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
/**
    @module Property
*/
/**
    @private
    @method enter
*/
function enter(fn) {
    this.enters.push(fn);
    return this;
}

/**
    @private
    @method exit
*/
function exit(fn) {
    this.exits.push(fn);
    return this;
}

function goto(str) {
    let name = str.slice(3);
    let current = this.resolve(this.current()[0]);
    current.exits.forEach((e) => e());
    this.current("/" + name);
    current = this.resolve("/" + name);
    current.enters.forEach((e) => e());
}

/**
    @private
    @method defineState
*/
function defineState() {
    let state;
    let subs = {};
    let current;

    state = {
        current: function (...args) {
            if (args.length) {
                current = state.resolve(args[0]);
            }
            return ["/" + current.name];
        },
        resolve: function (n) {
            return subs[n.slice(1)];
        },
        send: function (name) {
            if (current.events[name]) {
                current.events[name]();
            }
        },
        substateMap: subs
    };

    subs.Ready = {
        events: {
            change: goto.bind(state, "../Changing"),
            silence: goto.bind(state, "../Silent"),
            disable: goto.bind(state, "../Disabled")
        }
    };
    subs.Changing = {
        events: {
            changed: goto.bind(state, "../Ready")
        }
    };
    subs.Silent = {
        events: {
            report: goto.bind(state, "../Ready")
        }
    };
    subs.Disabled = {
        events: {
            enable: goto.bind(state, "../Ready")
        }
    };

    Object.keys(subs).forEach(function (key) {
        subs[key].name = key;
        subs[key].enters = [];
        subs[key].exits = [];
        subs[key].enter = enter.bind(subs[key]);
        subs[key].exit = exit.bind(subs[key]);
    });

    state.current("/Ready");

    return state;
}

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
        !p.type.parentOf
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
   @private
   @method defaultTransform
*/
function defaultTransform(value) {
    return value;
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

    function revert() {
        store = oldValue;
    }

    formatter.toType = formatter.toType || defaultTransform;
    formatter.fromType = formatter.fromType || defaultTransform;

    // Define state
    state = defineState();
    state.substateMap.Disabled.events.changed = revert;

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
    p.state = () => state;

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
    p.isToOne = isToOne.bind(null, p);

    /**
        @method isToMany
        @return {Boolean}
    */
    p.isToMany = isToMany.bind(null, p);

    /**
        @method isChild
        @return {Boolean}
    */
    p.isChild = isChild.bind(null, p);

    store = formatter.toType(store);

    return p;
}

export default Object.freeze(createProperty);
