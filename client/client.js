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

var prop = function (store, obj) {
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
        this.exit(function () {
          // Bubble up to parent
          obj.state.send("changed");
        });
      });
    });
  });

  p.state.goto();

  return p;
};

f.model = function (obj) {
  if (typeof obj !== "object" || typeof obj.name !== "string") { return false; }

  obj.data = obj.data || {};
  obj.onChange = obj.onChange || {};

  var doDelete, doFetch, doInit, doPatch, doPost;

  // ..........................................................
  // PUBLIC
  //

  obj.save = function () {
    obj.state.send("save");
  };

  obj.fetch = function (filter) {
    filter = filter || {};
    obj.state.send("fetch");
  };

  obj.delete = function () {
    obj.state.send("delete");
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
        obj.state.send('fetched');
      }.bind(this),
      url = "http://localhost:10010/" +
        obj.name.toSpinalCase() + "/" + obj.data.id();

    obj.state.goto("/busy");
    m.request({method: "GET", url: url})
      .then(ret)
      .then(callback);
  };

  doInit = function () {
    var keys = Object.keys(obj.data);

    // Bind property change events
    keys.forEach(function (key) {
      var state,
        d = obj.data,
        fn = obj.onChange[key];

      if (typeof fn === "function") {
        state = d[key].state.substateMap.changing;
        state.enter(fn.bind(d[key]));
      }
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

  obj.state = State.define(function () {
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

  obj.state.goto();

  return obj;
};

f.contact = function (attrs) {
  attrs = attrs || {};

  var obj = {name: "Contact", data: {}},
    d = obj.data;

  // ..........................................................
  // ATTRIBUTES
  //

  d.id = prop(attrs.id, obj);
  d.created = prop(attrs.created || new Date(), obj);
  d.createdBy = prop(attrs.createdBy || "admin", obj);
  d.updated = prop(attrs.updated || new Date(), obj);
  d.updatedBy = prop(attrs.updatedBy || "admin", obj);
  d.objectType = prop("Contact", obj);
  d.owner = prop(attrs.owner || "admin", obj);
  d.etag = prop(attrs.etag, obj);
  d.notes = prop(attrs.notes || [], obj);
  d.title = prop(attrs.title, obj);
  d.first = prop(attrs.first, obj);
  d.last = prop(attrs.last, obj);
  d.address = prop(attrs.address || [], obj);

  // ..........................................................
  // CHANGE EVENT HANDLERS
  //

  obj.onChange = {
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

  return f.model(obj);
};

