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

