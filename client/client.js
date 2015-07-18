/*global m, window */

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


var State = (typeof require === 'function' ? require('statechart') :
      window.statechart).State;

var f = {};

var prop = function (store) {
  var newValue, oldValue, p;

  p = function () {
    if (arguments.length) {
      newValue = arguments[0];
      oldValue = store;

      p.state.send("change");

      store = newValue;

      p.state.send("changed");
    }

    return store;
  };

  p.newValue = function () {
    return newValue;
  };
  p.oldValue = function () {
    return oldValue;
  };
  p.state = State.define(function () {
    this.state("ready", function () {
      this.event("change", function () { this.goto("../changing"); });
    });
    this.state("changing", function () {
      this.event("changed", function () {
        this.goto("../ready");
      });
    });
  });

  p.state.goto();

  return p;
};

f.model = function (spec, my) {
  spec = spec || {};

  var doDelete, doFetch, doInit, doPatch, doPost,
    that = {data: {}, onChange: {}};

  // Forward shared secrets to new object
  if (typeof my === "object") {
    if (typeof my.data === "object") { that.data = my.data; }
    if (typeof my.onChange === "object") { that.onChange = my.onChange; }
  }

  // ..........................................................
  // PUBLIC
  //

  that.save = function () {
    that.state.send("save");
  };

  that.fetch = function (filter) {
    filter = filter || {};
    that.state.send("fetch");
  };

  that.delete = function () {
    that.state.send("delete");
  };

  // ..........................................................
  // PRIVATE
  //

  doDelete = function () {
    this.goto("/busy/saving");
  };

  doFetch = function () {
    var ret = m.prop({}),
      callback = function () {
        console.log(ret());
        that.state.send('fetched');
      }.bind(this),
      url = "http://localhost:10010/" +
        my.name.toSpinalCase() + "/" + that.data.id();

    that.state.goto("/busy");
    m.request({method: "GET", url: url})
      .then(ret)
      .then(callback);
  };

  doInit = function () {
    var keys = Object.keys(that.data);

    // Bind property events
    keys.forEach(function (key) {
      var state,
        d = that.data,
        fn = that.onChange[key];

      // Execute onChange function
      if (typeof fn === "function") {
        state = d[key].state.substateMap.changing;
        state.enter(fn.bind(d[key]));
      }

      // Bubble event up to model when property changes
      d[key].state.substateMap.changing.exit(function () {
        that.state.send("changed");
      });
    });
  };

  doPatch = function () {
    this.goto("/busy/saving");
  };

  doPost = function () {
    this.goto("/busy/saving");
  };

  // ..........................................................
  // STATECHART
  //

  that.state = State.define(function () {
    this.state("ready", function () {
      this.state("new", function () {
        this.enter(doInit);
        this.event("fetch", doFetch.bind(this));
        this.event("save", doPost.bind(this));
        this.event("delete", function () { this.goto("/ready/deleted"); });
      });

      this.state("fetched", function () {
        this.state("clean", function () {
          this.event("changed", function () { this.goto("../dirty"); });
          this.event("delete", doDelete.bind(this));
        });

        this.state("dirty", function () {
          this.event("save", doPatch.bind(this));
        });

        this.event("fetch", doFetch.bind(this));
      });

      this.state("deleted", function () {
        // Prevent exiting from this state
        this.canExit = function () { return false; };
      });
    });

    this.state("busy", function () {
      this.state("fetching");
      this.state("saving");

      this.event("fetched", function () { this.goto("/ready/fetched"); });
      this.event("deleted", function () { this.goto("/ready/deleted"); });
      this.event("error", function () { this.goto("/error"); });
    });

    this.state("error", function () {
      // Prevent exiting from this state
      this.canExit = function () { return false; };
    });
  });

  return that;
};

f.contact = function (spec, my) {
  spec = spec || {};

  var that,
    shared = {name: "Contact", data: {}},
    d = shared.data;

  // ..........................................................
  // ATTRIBUTES
  //

  d.id = prop(spec.id, that);
  d.created = prop(spec.created || new Date(), that);
  d.createdBy = prop(spec.createdBy || "admin", that);
  d.updated = prop(spec.updated || new Date(), that);
  d.updatedBy = prop(spec.updatedBy || "admin", that);
  d.objectType = prop("Contact", that);
  d.owner = prop(spec.owner || "admin", that);
  d.etag = prop(spec.etag, that);
  d.notes = prop(spec.notes || [], that);
  d.title = prop(spec.title, that);
  d.first = prop(spec.first, that);
  d.last = prop(spec.last, that);
  d.address = prop(spec.address || [], that);

  // ..........................................................
  // CHANGE EVENT HANDLERS
  //

  shared.onChange = {
    first: function () {
      console.log("First name changed from " +
        this.oldValue() + " to " + this.newValue() + "!");
    },
    last: function () {
      console.log("Last name changed from " +
        this.oldValue() + " to " + this.newValue() + "!");
    },
    id: function () {
      console.log("Id changed from " +
        this.oldValue() + " to " + this.newValue() + "!");
    }
  };

  that = f.model(spec, shared);
  that.state.goto();

  return that;
};

