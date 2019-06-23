// Acknowledgement:
// Original codebase from https://github.com/burrows/statechart.js
// Commit: 1e834e167bea4709034056703652b7d802d74979
// License: MIT
// Alterations: Convert to ES6 module and lint

/*jslint for, this, browser*/
/*global console*/
/**
    @module State
*/
let slice = Array.prototype.slice;
let trace;
let exit;
let enter;

// Internal: Returns a boolean indicating whether the given object is an
// Array.
function isArray(o) {
    return Object.prototype.toString.call(o) === "[object Array]";
}

// Internal: Flattens the given array by removing all nesting.
function flatten(array) {
    let result = [];
    let i = 0;
    let n;

    for (n = array.length; i < n; i += 1) {
        if (isArray(array[i])) {
            result = result.concat(flatten(array[i]));
        } else {
            result.push(array[i]);
        }
    }

    return result;
}

// Internal: Returns an array containing the unique states in the given array.
function uniqStates(states) {
    let seen = {};
    let a = [];
    let path;
    let i = 0;
    let n;

    for (n = states.length; i < n; i += 1) {
        if (states[i]) {
            path = states[i].path();
            if (!seen[path]) {
                a.push(states[i]);
                seen[path] = true;
            }
        }
    }

    return a;
}

// Internal: Calculates and caches the path from the root state to the
// receiver state. Subsequent calls will return the cached path array.
//
// Returns an array of `State` objects.
function path() {
    this.cache.path = (
        this.cache.path || (
            this.superstate
            ? path.call(this.superstate).concat(this)
            : [this]
        )
    );

    return this.cache.path;
}

// Internal: Returns an array of all current leaf states.
function _current() {
    let a = [];
    let i = 0;
    let n;

    if (!this.isCurrent) {
        return [];
    }
    if (this.substates.length === 0) {
        return [this];
    }

    for (n = this.substates.length; i < n; i += 1) {
        if (this.substates[i].isCurrent) {
            a = a.concat(_current.call(this.substates[i]));
        }
    }

    return a;
}

// Internal: Finds the pivot state between the receiver and the given state.
// The pivot state is the first common ancestor between the two states.
//
// Returns a `State` object.
// Throws `Error` if the two states do not belong to the same statechart.
function findPivot(other) {
    let p1 = path.call(this);
    let p2 = path.call(other);
    let i = 0;
    let len;
    let p;

    for (
        len = (
            p1.length < p2.length
            ? p1.length
            : p2.length
        );
        i < len;
        i += 1
    ) {
        if (p1[i] === p2[i]) {
            p = p1[i];
        } else {
            break;
        }
    }

    if (!p) {
        throw new Error(
            "State#findPivot: states " + this + " and " + other +
            " do not belong to the same statechart"
        );
    }

    return p;
}

// Internal: Queues up a transition for later processing. Transitions are
// queued instead of happening immediately because we need to allow all
// current states to receive an event before any transitions actually occur.
//
// pivot  - The pivot state between the start state and destination states.
// states - An array of destination states.
// opts   - The options object passed to the `goto` method.
//
// Returns nothing.
function queueTransition(pivot, states, opts) {
    this.transitions.push({
        pivot: pivot,
        states: states,
        opts: opts
    });
}

// Internal: Performs all queued transitions. This is the method that actually
// takes the statechart from one set of current states to another.
function transition() {
    let ts = this.transitions;
    let i = 0;
    let len;

    if (!ts || ts.length === 0) {
        return;
    }

    for (len = ts.length; i < len; i += 1) {
        enter.call(ts[i].pivot, ts[i].states, ts[i].opts);
    }

    this.transitions = [];
}

// Internal: Invokes all registered enter handlers.
function callEnterHandlers(context) {
    let i = 0;
    let n;

    for (n = this.enters.length; i < n; i += 1) {
        this.enters[i].call(this, context);
    }
}

// Internal: Invokes all registered exit handlers.
function callExitHandlers(context) {
    let i = 0;
    let n;

    for (n = this.exits.length; i < n; i += 1) {
        this.exits[i].call(this, context);
    }
}

// Internal: Enters a clustered state. Entering a clustered state involves
// exiting the current substate (if one exists and is not a destination
// state), invoking the `enter` callbacks on the receiver state, and
// recursively entering the new destination substate. The new destination
// substate is determined as follows:
//
// 1. the substate indicated in the `states` argument if its not empty
// 2. the result of invoking the condition function defined with the `C`
//    method if it exists and returns a substate path
// 3. the most recently exited substate if the state was defined with the
//    `H` option and has been previously entered
// 4. the first substate
//
// states - An array of destination states (may be empty to indicate that
//          a condition, history, or default substate should be entered).
// opts   - The options passed to `goto`.
//
// Returns the receiver.
// Throws an `Error` if the given destination states include multiple
//   substates.
function enterClustered(states, opts) {
    let selflen = path.call(this).length;
    let nexts = [];
    let state;
    let paths;
    let cur;
    let next;
    let i = 0;
    let n;

    for (n = this.substates.length; i < n; i += 1) {
        if (this.substates[i].isCurrent) {
            cur = this.substates[i];
            break;
        }
    }

    i = 0;

    for (n = states.length; i < n; i += 1) {
        nexts.push(path.call(states[i])[selflen]);
    }

    if (uniqStates(nexts).length > 1) {
        throw new Error(
            "State#enterClustered: attempted to enter multiple substates of "
            + this + ": " + nexts.join(", ")
        );
    }

    next = nexts[0];

    if (!next && this.substates.length > 0) {
        if (this.condition) {
            paths = this.condition.call(this, opts.context);

            if (paths) {
                paths = flatten([paths]);
                states = [];
                i = 0;

                for (n = paths.length; i < n; i += 1) {
                    state = this.resolve(paths[i]);

                    if (!state) {
                        throw new Error(
                            "State#enterClustered: could not resolve path '" +
                            paths[i] + "' returned by condition function " +
                            "from " + this
                        );
                    }
                    states.push(state);
                }

                return enterClustered.call(this, states, opts);
            }
        }

        if (this.history) {
            next = this.previous;
        }

        if (!next) {
            next = this.substates[0];
        }
    }

    if (cur && cur !== next) {
        exit.call(cur, opts);
    }

    if (!this.isCurrent || opts.force) {
        trace.call(
            this,
            (
                "State: [ENTER]  : " + this.path() + (
                    this.isCurrent
                    ? " (forced)"
                    : ""
                )
            )
        );
        this.isCurrent = true;
        callEnterHandlers.call(this, opts.context);
    }

    if (next) {
        enter.call(next, states, opts);
    }

    return this;
}

// Internal: Enters a concurrent state. Entering a concurrent state simply
// involves calling the `enter` method on the receiver and recursively
// entering each substate.
//
// states - An array of destination states.
// opts   - The options passed to `goto`.
//
// Returns the receiver.
function enterConcurrent(states, opts) {
    let sstate;
    let dstates;
    let i = 0;
    let j;
    let ni;
    let nj;

    if (!this.isCurrent || opts.force) {
        trace.call(
            this,
            (
                "State: [ENTER]  : " + this.path() + (
                    this.isCurrent
                    ? " (forced)"
                    : ""
                )
            )
        );
        this.isCurrent = true;
        callEnterHandlers.call(this, opts.context);
    }

    for (ni = this.substates.length; i < ni; i += 1) {
        sstate = this.substates[i];
        dstates = [];
        j = 0;

        for (nj = states.length; j < nj; j += 1) {
            if (findPivot.call(sstate, states[j]) === sstate) {
                dstates.push(states[j]);
            }

        }
        enter.call(sstate, dstates, opts);
    }

    return this;
}

// Internal: Enters the receiver state. The actual entering logic is in the
// `enterClustered` and `enterConcurrent` methods.
//
// states - An array of destination states.
// opts   - The options passed to `goto`.
//
// Returns the receiver.
enter = function (states, opts) {
    return (
        this.concurrent
        ? enterConcurrent.call(this, states, opts)
        : enterClustered.call(this, states, opts)
    );
};

// Internal: Exits a clustered state. Exiting happens bottom to top, so we
// recursively exit the current substate and then invoke the `exit` method on
// each state as the stack unwinds.
//
// opts - The options passed to `goto`.
//
// Returns the receiver.
function exitClustered(opts) {
    let cur;
    let i = 0;
    let n;

    for (n = this.substates.length; i < n; i += 1) {
        if (this.substates[i].isCurrent) {
            cur = this.substates[i];
            break;
        }
    }

    if (this.history) {
        this.previous = cur;
    }

    if (cur) {
        exit.call(cur, opts);
    }

    callExitHandlers.call(this, opts.context);
    this.isCurrent = false;
    trace.call(this, "State: [EXIT]   : " + this.path());

    return this;
}

// Internal: Exits a concurrent state. Similiar to `exitClustered` we
// recursively exit each substate and invoke the `exit` method as the stack
// unwinds.
//
// opts - The options passed to `goto`.
//
// Returns the receiver.
function exitConcurrent(opts) {
    let root = this.root();
    let i = 0;
    let n;

    for (n = this.substates.length; i < n; i += 1) {
        exit.call(this.substates[i], opts);
    }

    callExitHandlers.call(this, opts.context);
    this.isCurrent = false;
    if (this !== root) {
        trace.call(this, "State: [EXIT]   : " + this.path());
    }

    return this;
}

// Internal: Exits the receiver state. The actual exiting logic is in the
// `exitClustered` and `exitConcurrent` methods.
//
// opts   - The options passed to `goto`.
//
// Returns the receiver.
exit = function (opts) {
    return (
        this.concurrent
        ? exitConcurrent.call(this, opts)
        : exitClustered.call(this, opts)
    );
};

// Internal: Asks the receiver state if it can exit.
//
// destStates - The destination states.
// opts       - The options passed to `goto`.
//
// Returns boolean.
function canExit(destStates, opts) {
    let i = 0;
    let n;

    for (n = this.substates.length; i < n; i += 1) {
        if (this.substates[i].isCurrent) {
            if (canExit.call(this.substates[i], destStates, opts) === false) {
                return false;
            }
        }
    }

    return this.canExit(destStates, opts.context);
}

// Internal: Sends an event to a clustered state.
//
// Returns a boolean indicating whether or not the event was handled by the
//   current substate.
function sendClustered(...args) {
    let handled = false;
    let i = 0;
    let n;
    let cur;

    for (n = this.substates.length; i < n; i += 1) {
        if (this.substates[i].isCurrent) {
            cur = this.substates[i];
            break;
        }
    }

    if (cur) {
        handled = Boolean(cur.send.apply(cur, slice.call(args)));
    }

    return handled;
}

// Internal: Sends an event to a concurrent state.
//
// Returns a boolean indicating whether or not the event was handled by all
//   substates.
function sendConcurrent(...ary) {
    let args = slice.call(ary);
    let handled = true;
    let state;
    let i = 0;
    let n;

    for (n = this.substates.length; i < n; i += 1) {
        state = this.substates[i];
        handled = state.send.apply(state, args) && handled;
    }

    return handled;
}

/**
    The `State` constructor.

    Throws `Error` if both the `concurrent` and `H` options are set.
    
    @class State
    @constructor
    @param {String} name A string containing the name of the state.
    @param {Object} [opts] An object containing zero or more of the following keys (default:`null`).
    @param {Boolean} [opts.concurrent] Makes the state's substates concurrent.
    @param {Boolean} [opts.H] Causes the state to keep track of its history state.
    Set to `true` to track just the history of this state
    or `'*'` to track the history of all substates.
    @param {Function} [f] function to invoke in the context of the newly
    created state (default: `null`)
*/
function State(name, opts, f) {
    if (typeof opts === "function") {
        f = opts;
        opts = {};
    }

    opts = opts || {};

    if (opts.concurrent && opts.H) {
        throw new Error(
            "State: history states are not allowed on concurrent states"
        );
    }

    this.name = name;
    this.substateMap = {};
    this.substates = [];
    this.superstate = null;
    this.enters = [];
    this.exits = [];
    this.events = {};
    this.concurrent = Boolean(opts.concurrent);
    this.history = Boolean(opts.H);
    this.deep = opts.H === "*";
    this.isCurrent = false;
    this.cache = {};
    this.transitions = [];
    this.trace = false;

    if (f) {
        f.call(this);
    }
}

/** 
    Convenience method for creating a new statechart. Simply creates a
    root state and invokes the given function in the context of that state.

    @example
        let sc = State.define({concurrent: true}, function () {
            this.state("a");
            this.state("b");
            this.state("c");
        });
    @class define
    @constructor
    @namespace State
    @param {Object | Function} [opts] An object of options to pass the to the `State` constructor
         or function object (default: `null`).
    @param {Function} f A function object to invoke in the context of the newly created root
        state (default: `null`).
    @return {State} Newly created root state.
*/
State.define = function (...args) {
    let opts = {};
    let f = null;
    let s;
    let Statechart = this; // Make jslint happy

    if (args.length === 2) {
        opts = args[0];
        f = args[1];
    } else if (args.length === 1) {
        if (typeof args[0] === "function") {
            f = args[0];
        } else {
            opts = args[0];
        }
    }

    s = new Statechart("root", opts, f);
    return s;
};

/**
    Indicates whether the state is the root of the statechart created
    by the `State.define` method.

    @method isRoot
    @for State
    @return {Boolean}
*/
State.prototype.isRoot = function () {
    return this.name === "root";
};

/**
    Creates a substate with the given name and adds it as a substate to
    the receiver state. If a `State` object is given, then it simply adds the
    state as a substate. This allows you to split up the definition of your
    states instead of defining everything in one place.

    @method state
    @param {String} name A string containing the name of the state or a `State` object.
    @param {Object} [opts] opts An object of options to pass to the `State` constructor
    (default: `null`).
    @param {Function} [opts.f] A function to invoke in the context of the newly created state
    (default: `null`).

    @example
        let s2 = new State("s2");
        s2.state("s21");
        s2.state("s22");

        let sc = State.define(function () {
            this.state("s", function () {
                this.state("s1", function () {
                    this.state("s11");
                    this.state("s12");
                });

                this.state(s2);
            });
        });

    @return {State) The newly created state.
*/
State.prototype.state = function (name, opts, f) {
    let Constructor = this.constructor; // Make jslint happy
    let s = (
        typeof name === "object"
        ? name
        : new Constructor(name, opts, f)
    );
    this.addSubstate(s);
    return s;
};

/**
    Registers an enter handler to be called with the receiver state
    is entered. The `context` option passed to `goto` will be passed to the
    given function when invoked.

    Multiple enter handlers may be registered per state. They are invoked in
    the order in which they are defined.

    @method enter
    @param {Function} f A function to call when the state is entered.
    @return {State} The receiver
*/
State.prototype.enter = function pState_enter(f) {
    this.enters.push(f);
    return this;
};

/**
    Registers an exit handler to be called with the receiver state
    is exited. The `context` option passed to `goto` will be passed to the
    given function when invoked.

    Multiple exit handlers may be registered per state. They are invoked in
    the order in which they are defined.

    @method exit
    @param {Function} f A function to call when the state is exited.
    @return {State} The receiver
*/
State.prototype.exit = function pState_exit(f) {
    this.exits.push(f);
    return this;
};

/**
    A function that can be used to prevent a state from being exited.
    `destStates` and `context` are the destination states and context that
    will be transitioned to if the states can be exited.

    @canExit
    @param {Object} destStates The destination states.
    @param {Object} context The destination context.
    @return {State} The receiver.
State.prototype.canExit = function ( /*destStates, context*/ ) {
    return true;
};

/**
    Registers an event handler to be called when an event with a
    matching name is sent to the state via the `send` method.

    Only one event handler may be registered per event.

    @method event
    @param {String} name The name of the event.
    @param {Function} f A function to call when the event occurs.
    @return {State} The receiver.
*/
State.prototype.event = function pState_event(name, f) {
    this.events[name] = f;
    return this;
};

/**
    Defines a condition state on the receiver state. Condition states
    are consulted when entering a clustered state without specified destination
    states. The given function should return a path to some substate of the
    state that the condition state is defined on.

    @method C
    @param {Function} f The condition function.
    @example
        let sc = State.define(function () {
            this.state("a", function () {
                this.C(function () {
                    if (shouldGoToB) {
                        return "./b";
                    }
                    if (shouldGoToC) {
                        return "./c";
                    }
                    if (shouldGoToD) {
                        return "./d";
                    }
                });
                this.state("b");
                this.state("c");
                this.state("d");
            });
        });
*/
State.prototype.C = function pState_C(f) {
    if (this.concurrent) {
        throw new Error(
            "State#C: a concurrent state may not have a " +
            "condition state: " + this
        );
    }

    this.condition = f;
};

/**
    Returns an array of paths to all current leaf states.
    @method
    @return {Array}
*/
State.prototype.current = function pState_current() {
    let states = _current.call(this);
    let paths = [];
    let i = 0;
    let n;

    for (n = states.length; i < n; i += 1) {
        paths.push(states[i].path());
    }

    return paths;
};

/**
    The `State` iterator - invokes the given function once for each
    state in the statechart. The states are traversed in a preorder depth-first
    manner.

    @method each
    @param {Function} f A function object, it will be invoked once for each state.
    @return {State} The receiver.
*/
State.prototype.each = function pState_each(f) {
    let i = 0;
    let n;

    f(this);

    for (n = this.substates.length; i < n; i += 1) {
        this.substates[i].each(f);
    }

    return this;
};

/**
    Adds the given state as a substate of the receiver state.

    @method addSubstate
    @param {State} state
    @return {State} The receiver.
*/
State.prototype.addSubstate = function pState_addSubstate(state) {
    let deep = this.deep;
    let didAttach = this.root().isRoot();

    this.substateMap[state.name] = state;
    this.substates.push(state);
    state.superstate = this;
    state.each(function (s) {
        s.cache = {};
        if (deep) {
            s.history = true;
            s.deep = true;
        }
        if (didAttach) {
            s.didAttach();
        }
    });
    return this;
};

// Internal: Invoked by the `#addSubstate` method when the state has been
// connected to a root statechart. This is currently only used by the
// `RoutableState` substate and should not be invoked by client code.
State.prototype.didAttach = function pState_didAttach() {
    return;
};

/**
    Indicates whether the receiver state is attached to a root
    statechart node.
    @method isAttached
    @return {Boolean}
*/
State.prototype.isAttached = function pState_isAttached() {
    return this.root().isRoot();
};

/**
    @method root
    @return {State} The root state.
*/
State.prototype.root = function pState_root() {
    this.cache.root = this.cache.root || (
        this.superstate
        ? this.superstate.root()
        : this
    );

    return this.cache.root;
};

/**
    Returns a string containing the full path from the root state to
    the receiver state. State paths are very similar to unix directory paths.
    
    @example
        let r = new State("root");
        let a = new State("a");
        let b = new State("b");
        let c = new State("c");

        r.addSubstate(a);
        a.addSubstate(b);
        b.addSubstate(c);

        r.path(); // => "/"
        a.path(); // => "/a"
        b.path(); // => "/a/b"
        c.path(); // => "/a/b/c"
    @method path
    @return {String}
*/
State.prototype.path = function pState_path() {
    let states = path.call(this);
    let names = [];
    let i = 1;
    let len;

    for (len = states.length; i < len; i += 1) {
        names.push(states[i].name);
    }

    return "/" + names.join("/");
};

/**
    Sets up a transition from the receiver state to the given
    destination states. Transitions are usually triggered during event
    handlers called by the `send` method. This method should be called on the
    root state to send the statechart into its initial set of current states.

    @method goto
    @param {String | Array} paths Zero or more strings representing destination
    state paths (default: `[]`).
    @param {Object} [opts] An object containing zero or more of the following keys:
    @param {Object} [opts.context] An object to pass along to the `exit` and `enter` methods
    invoked during the actual transistion.
    @param {Boolean} [opts.force] Forces `enter` methods to be called during the transition
    on states that are already current.

    @example
        let sc = State.define(function () {
            this.state("a", function () {
                this.state("b", function () {
                    this.foo = function () { this.goto("../c"); };
                });
                this.state("c", function () {
                    this.bar = function () { this.goto("../b"); };
                });
            });
        });

        sc.goto();
        sc.current();   // => ["/a/b"]
        sc.send("foo");
        sc.current();   // => ["/a/c"]
        sc.send("bar");
        sc.current();   // => ["/a/b"]

    @return {Boolean} `false` if transition failed.
    @throws {Error} Throws an `Error` if called on a non-current non-root state or
    multiple pivot states are found between the receiver
    and destination states or if a destination path is not reachable from the receiver.
*/
State.prototype.goto = function pState_goto(...args) {
    let root = this.root();
    let paths = flatten(slice.call(args));
    let opts = (
        typeof paths[paths.length - 1] === "object"
        ? paths.pop()
        : {}
    );
    let states = [];
    let pivots = [];
    let state;
    let pivot;
    let i = 0;
    let n;

    for (n = paths.length; i < n; i += 1) {
        state = this.resolve(paths[i]);

        if (!state) {
            throw new Error(
                "State#goto: could not resolve path " +
                paths[i] + " from " + this
            );
        }

        states.push(state);
    }

    i = 0;

    for (n = states.length; i < n; i += 1) {
        pivots.push(findPivot.call(this, states[i]));
    }

    if (uniqStates(pivots).length > 1) {
        throw new Error(
            "State#goto: multiple pivot states found between state " +
            this + " and paths " + paths.join(", ")
        );
    }

    pivot = pivots[0] || this;

    if (canExit.call(pivot, states, opts) === false) {
        trace.call(this, "State: [GOTO]   : " + this + " can not exit]");
        return false;
    }

    trace.call(
        this,
        "State: [GOTO]   : " + this + " -> [" + states.join(", ") + "]"
    );

    if (!this.isCurrent && this.superstate) {
        throw new Error("State#goto: state " + this + " is not current");
    }

    // if the pivot state is a concurrent state and is not also the starting
    // state, then we're attempting to cross a concurrency boundary, which is
    // not allowed
    if (pivot.concurrent && pivot !== this) {
        throw new Error(
            "State#goto: one or more of the given paths are not reachable " +
            "from state " + this + ": " + paths.join(", ")
        );
    }

    queueTransition.call(root, pivot, states, opts);

    if (!this.isSending) {
        transition.call(root);
    }

    return true;
};

/**
    Sends an event to the statechart. A statechart handles an event
    by giving each current leaf state an opportunity to handle it. Events
    bubble up superstate chains as long as handler methods do not return a
    truthy value. When a handler does return a truthy value (indicating that
    it has handled the event) the bubbling is canceled. A handler method is
    registered with the `event` method.

    @method send
    @param {String} event The event name.
    @param {Any} [args] Zero or more arguments that get passed on to the handler methods.
    @return {Boolean} A boolean indicating whether or not the event was handled.
    @throws {Error} Throws `Error` if the state is not current.
*/
State.prototype.send = function pState_send(...ary) {
    let args = slice.call(ary);
    let events = this.events;
    let handled;

    if (!this.isCurrent) {
        throw new Error(
            "State#send: attempted to send an event to a state " +
            "that is not current: " + this
        );
    }

    if (this === this.root()) {
        trace.call(this, "State: [EVENT]  : " + args[0]);
    }

    handled = (
        this.concurrent
        ? sendConcurrent.apply(this, ary)
        : sendClustered.apply(this, ary)
    );

    if (!handled && typeof events[args[0]] === "function") {
        this.isSending = true;
        handled = Boolean(events[args[0]].apply(this, args.slice(1)));
        this.isSending = false;
    }

    if (!this.superstate) {
        transition.call(this);
    }

    return handled;
};

/**
    Resets the statechart by exiting all current states.
    @method reset
*/
State.prototype.reset = function pState_reset() {
    exit.call(this, {});
};

/**
    Returns a boolean indicating whether or not the state at the given
    path is current.
    @method isCurrent
    @return {Boolean}
    @throws {Error} Throws `Error` if the path cannot be resolved.
*/
State.prototype.isCurrent = function pState_isCurrent(path) {
    let state = this.resolve(path);

    return Boolean(state && state.isCurrent);
};

/**
    Resolves a string path into an actual `State` object. Paths not
    starting with a '/' are resolved relative to the receiver state, paths that
    do start with a '/' are resolved relative to the root state.

    @method resolve
    @param {String} path The path to resolve or an array of path segments.
    @returns {State} The `State` object the path represents if it can be
    resolved and `null` otherwise.
*/
State.prototype.resolve = function pState_resolve(path) {
    let head;
    let next;

    if (!path) {
        return null;
    }

    path = (
        typeof path === "string"
        ? path.split("/")
        : path
    );
    head = path.shift();

    switch (head) {
    case "":
        next = this.root();
        break;
    case ".":
        next = this;
        break;
    case "..":
        next = this.superstate;
        break;
    default:
        next = this.substateMap[head];
    }

    if (!next) {
        return null;
    }

    return (
        path.length === 0
        ? next
        : next.resolve(path)
    );
};

/**
    Returns a formatted string with the state's full path.
    @method toString
    @return {String}
*/
State.prototype.toString = function pState_toString() {
    return "State(" + this.path() + ")";
};

// Internal: Logs the given message. How the message gets logged is determined
// by the `State.logger` property. By default this is `console`, but can be
// setto use another logger object. It assumes that there is an `info` method
// on the logger object.
trace = function (message) {
    let logger = State.logger || console;

    if (!this.root().trace || !logger) {
        return;
    }

    logger.info(message);
};

export default Object.freeze(State);