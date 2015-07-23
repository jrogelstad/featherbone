/*global m, f */

//this application only has one component: todo
var todo = {};

//for simplicity, we use this component to namespace the model classes

//the Todo class has two properties
todo.Todo = function (data) {
  this.description = m.prop(data.description);
  this.done = m.prop(false);
};

//the TodoList class is a list of Todo's
todo.TodoList = Array;

//the view-model tracks a running list of todos,
//stores a description for new todos before they are created
//and takes care of the logic surrounding when adding is permitted
//and clearing the input after adding a todo to the list
todo.vm = (function () {
  var vm = {};
  vm.init = function () {
    //a running list of todos
    vm.list = new todo.TodoList();

    //a slot to store the name of a new todo before it is created
    vm.description = m.prop("");

    //adds a todo to the list, and clears the description field for
    //user convenience
    vm.add = function () {
      if (vm.description()) {
        vm.list.push(new todo.Todo({description: vm.description()}));
        vm.description("");
      }
    };
  };
  return vm;
}());

//the controller defines what part of the model is relevant for the current page
//in our case, there's only one view-model that handles everything
todo.controller = function () {
  todo.vm.init();
};

//here's the view
todo.view = function () {
  return m("html", [
    m("body", [
      m("input", {onchange: m.withAttr("value", todo.vm.description),
        value: todo.vm.description()}),
      m("button", {onclick: todo.vm.add}, "Add"),
      m("table", [
        todo.vm.list.map(function (task, index) {
          return m("tr", [
            m("td", [
              m("input[type=checkbox]", {onclick:
                m.withAttr("checked", task.done),
                checked: task.done()})
            ]),
            m("td", {style: {textDecoration:
              task.done() ? "line-through" : "none"}}, task.description()),
          ]);
        })
      ])
    ])
  ]);
};

//initialize the application
m.mount(document, {controller: todo.controller, view: todo.view});

f.model = function (data, my) {
  data = data || {};
  my = my || {};

  var  state, doDelete, doFetch, doInit, doPatch, doPost, doProperties,
    that = {data: {}},
    d = that.data,
    stateMap = {};

  // ..........................................................
  // PUBLIC
  //

  /*
    Send event to delete the current object from the server.
    Only executes in "/ready/clean" and "/ready/new" states.
  */
  that.delete = function () {
    state.send("delete");
  };

  /*
    Send event to fetch data based on the current id from the server.
    Only results in action in the "/ready" state.
  */
  that.fetch = function () {
    state.send("fetch");
  };

  /*
    Add a change event binding to a property.

    @param {String} Property name
    @param {Function} Function to call on change
    @return Reciever
  */
  that.onChange = function (name, func) {
    stateMap[name].substateMap.Changing.enter(func.bind(d[name]));

    return this;
  };

  /*
    Send the save event to persist current data to the server.
    Only results in action in the "/ready/fetched/dirty" and
    "/ready/new" states.
  */
  that.save = function () {
    state.send("save");
  };

  /*
    Send an event to all properties.

    @param {String} event name.
    @returns receiver
  */
  that.sendToProperties = function (str) {
    var keys = Object.keys(d);

    keys.forEach(function (key) {
      d[key].state.send(str);
    });

    return this;
  };

  /*
    Set properties to the values of a passed object

    @param {Object} Data to set
    @param {Boolean} Silence change events
    @returns reciever
  */
  that.set = function (data, silent) {
    var keys;

    if (typeof data === "object") {
      keys = Object.keys(data);

      // Silence events if applicable
      if (silent) { that.sendToProperties("silence"); }

      // Loop through each attribute and assign
      keys.forEach(function (key) {
        if (typeof d[key] === "function") {
          d[key](data[key]);
        }
      });

      that.sendToProperties("report"); // TODO: History?
    }

    return this;
  };

  // ..........................................................
  // PRIVATE
  //

  doDelete = function () {
    that.state.goto("/Busy/Saving");
  };

  doFetch = function () {
    var result = m.prop({}),
      callback = function () {
        that.set(result(), true);
        state.send('fetched');
      },
      url = "http://localhost:10010/" +
        my.name.toSpinalCase() + "/" + that.data.id();

    state.goto("/Busy");
    m.request({method: "GET", url: url})
      .then(result)
      .then(callback);
  };

  doInit = function () {
    doProperties(my.properties);
  };

  doPatch = function () {
    state.goto("/Busy/Saving");
  };

  doPost = function () {
    state.goto("/Busy/Saving");
  };

  doProperties = function (props) {
    var keys = Object.keys(props || {});

    keys.forEach(function (key) {
      var prop, func, defaultValue,
        value = data[key];

      // Handle default
      if (value === undefined && props[key].default !== undefined) {
        defaultValue = props[key].default;

        // Handle default that is a function
        if (typeof defaultValue === "string" &&
            defaultValue.match(/\(\)$/)) {
          func = f[defaultValue.replace(/\(\)$/, "")];
          value = func();
        } else {
          value = defaultValue;
        }
      }

      // Create property
      prop = f.prop(value);

      // Carry other property definitions forward
      prop.description = props[key].description;
      prop.type = props[key].type;
      prop.default = func || defaultValue;

      // Report property changed event up to model
      prop.state.substateMap.Changing.exit(function () {
        state.send("changed");
      });

      // Limit public access to state
      stateMap[key] = prop.state;
      prop.state = {
        current: function () {
          return stateMap[key].current();
        },
        send: function (str) {
          return stateMap[key].send(str);
        }
      };

      d[key] = prop;
    });
  };

  state = f.State.define(function () {
    this.state("Ready", function () {
      this.state("New", function () {
        this.enter(doInit);
        this.event("fetch", doFetch);
        this.event("save", doPost);
        this.event("delete", function () { this.goto("/Ready/Deleted"); });
      });

      this.state("Fetched", function () {
        this.state("Clean", function () {
          this.event("changed", function () { this.goto("../Dirty"); });
          this.event("delete", doDelete);
        });

        this.state("Dirty", function () {
          this.event("save", doPatch);
        });

        this.event("fetch", doFetch);
      });
    });

    this.state("Busy", function () {
      this.state("Fetching");
      this.state("Saving");

      this.event("fetched", function () { this.goto("/Ready/Fetched"); });
      this.event("deleted", function () { this.goto("/Deleted"); });
      this.event("error", function () { this.goto("/Error"); });
    });

    this.state("Deleted", function () {
      // Prevent exiting from this state
      this.canExit = function () { return false; };
    });

    this.state("Error", function () {
      // Prevent exiting from this state
      this.canExit = function () { return false; };
    });
  });

  // Expose specific state capabilities users can see and manipulate
  that.state = {
    send: function (str) {
      return state.send(str);
    },
    current: function () {
      return state.current();
    }
  };

  // Initialize
  state.goto();

  return that;
};

f.settings = function (name) {
  var state, doFetch, doPost,
    that = {};

  if (!name) { throw "Settings name is required"; }

  that.data = f.prop();

  doFetch = function () {
    var callback = function () {
        state.send('fetched');
      },
      url = "http://localhost:10010/settings/" + name;

    state.goto("/Busy");
    m.request({method: "GET", url: url})
      .then(that.data)
      .then(callback);
  };

  doPost = function () {
    state.goto("/Busy/Saving");
  };

  state = f.State.define(function () {
    this.state("Ready", function () {
      this.state("New", function () {
        this.event("fetch", doFetch);
        this.enter(function () { state.send("fetch"); });
      });

      this.state("Fetched", function () {
        this.state("Clean", function () {
          this.event("changed", function () { this.goto("../Dirty"); });
        });

        this.state("Dirty", function () {
          this.event("save", doPost);
        });

        this.event("fetch", doFetch);
      });
    });

    this.state("Busy", function () {
      this.state("Fetching");
      this.state("Saving");

      this.event("fetched", function () { this.goto("/Ready/Fetched"); });
      this.event("error", function () { this.goto("/Error"); });
    });

    this.state("Error", function () {
      // Prevent exiting from this state
      this.canExit = function () { return false; };
    });
  });

  // Expose specific state capabilities users can see and manipulate
  that.state = {
    send: function (str) {
      return state.send(str);
    },
    current: function () {
      return state.current();
    }
  };

  // Initialize
  state.goto();

  return that;
};

// Invoke catalog settings as an object
f.catalog = (function () {
  var that = f.settings("catalog");

  /**
    Return a model definition, including inherited properties.

    @param {String} Model name
    @param {Boolean} Include inherited or not. Defult = true.
    @return {String}
  */
  that.getModel = function (name, includeInherited) {
    var catalog = that.data(),
      appendParent = function (child, parent) {
        var model = catalog[parent],
          modelProps = model.properties,
          childProps = child.properties,
          keys = Object.keys(modelProps);

        if (parent !== "Object") {
          appendParent(child, model.inherits || "Object");
        }

        keys.forEach(function (key) {
          if (childProps[key] === undefined) {
            childProps[key] = modelProps[key];
            childProps[key].inheritedFrom = parent;
          }
        });

        return child;
      },
      result = {name: name, inherits: "Object"},
      resultProps,
      modelProps,
      key;

    if (!catalog[name]) { return false; }

    /* Add other attributes after name */
    for (key in catalog[name]) {
      if (catalog[name].hasOwnProperty(key)) {
        result[key] = catalog[name][key];
      }
    }

    /* Want inherited properites before class properties */
    if (includeInherited !== false && name !== "Object") {
      result.properties = {};
      result = appendParent(result, result.inherits);
    } else {
      delete result.inherits;
    }

    /* Now add local properties back in */
    modelProps = catalog[name].properties;
    resultProps = result.properties;
    for (key in modelProps) {
      if (modelProps.hasOwnProperty(key)) {
        resultProps[key] = modelProps[key];
      }
    }

    return result;
  };

  return that;
}());

f.contact = function (data, my) {
  data = data || {};

  var that,
    shared = {name: "Contact"};

  // ..........................................................
  // PROPERTIES 
  //

  shared.properties = f.catalog.getModel("Contact").properties;

  that = f.model(data, shared);

  // ..........................................................
  // CHANGE EVENT BINDINGS
  //

  that.onChange("first", function () {
    console.log("First name changed from " +
      this.oldValue() + " to " + this.newValue() + "!");
  });

  that.onChange("last", function () {
    console.log("Last name changed from " +
      this.oldValue() + " to " + this.newValue() + "!");
  });

  that.onChange("id", function () {
    console.log("Id changed from " +
      this.oldValue() + " to " + this.newValue() + "!");
  });

  return that;
};

