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

f.model = function (model, spec) {
  spec = spec || {};

  var _delete, _fetch, _init, _patch, _post,
    obj = {},
    data = {};

  // ..........................................................
  // PUBLIC
  //

  obj.data = data;

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

  _delete = function () {
    this.goto("/busy/saving");
  };

  _fetch = function () {
    var ret = m.prop({}),
      fetched = function () {
        console.log(ret());
        obj.state.send('fetched');
      }.bind(this),
      url = "http://localhost:10010/" + model + "/" + data.id();

    obj.state.goto("/busy");
    m.request({method: "GET", url: url})
      .then(ret)
      .then(fetched);
  };

  _init = function () {
    console.log("Hello World");
  };

  _patch = function () {
    this.goto("/busy/saving");
  };

  _post = function () {
    this.goto("/busy/saving");
  };

  // ..........................................................
  // STATECHART
  //

  obj.state = State.define(function () {
    this.state("ready", function () {
      this.state("new", function () {
        this.enter(_init);
        this.event("fetch", _fetch.bind(this));
        this.event("save", _post.bind(this));
        this.event("delete", function () { this.goto("/ready/deleted"); });
      });

      this.state("fetched", function () {
        this.state("clean", function () {
          this.event("changed", function () { this.goto("../dirty"); });
          this.event("delete", _delete.bind(this));
        });

        this.state("dirty", function () {
          this.event("save", _patch.bind(this));
        });

        this.event("fetch", _fetch.bind(this));
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

f.contact = function (spec) {
  spec = spec || {};

  var obj = f.model("contact", spec),
    store = {},
    changed = function (changes) {
      var prop = changes[0].name,
        method = obj.onChange[prop],
        f = obj[method],
        oldValue = changes[0].oldValue,
        newValue = changes[0].object[prop];

      if (typeof f === "function") { f(newValue, oldValue, changes); }
    }.bind(this),
    prop = function (name, value) {
      var p;

      p = function () {
        if (arguments.length) {
          store[name] = arguments[0];
        }

        return store[name];
      };

      store[name] = value;

      return p;
    },
    data = obj.data;

  Object.observe(store, changed);

  obj.onChange = {
    "first": "firstChanged",
    "last": "lastChanged",
    "id": "idChanged"
  };

  obj.firstChanged = function (newVal, oldVal, changes) {
    console.log("First name changed from " + oldVal + " to " + newVal + "!");
  };

  obj.lastChanged = function (newVal, oldVal, changes) {
    console.log("Last name changed from " + oldVal + " to " + newVal + "!");
  };

  obj.idChanged = function (newVal, oldVal, changes) {
    console.log("Id changed from " + oldVal + " to " + newVal + "!");
  };

  // ..........................................................
  // ATTRIBUTES
  //

  data.id = prop("id", spec.id);
  data.created = prop("created", spec.created || new Date());
  data.createdBy = prop("createdBy", spec.createdBy || "admin");
  data.updated = prop("updated", spec.updated || new Date());
  data.updatedBy = prop("updatedBy", spec.updatedBy || "admin");
  data.objectType = prop("objectType", "Contact");
  data.owner = prop("owner", spec.owner || "admin");
  data.etag = prop("etag", spec.etag);
  data.notes = prop("notes", spec.notes || []);
  data.title = prop("title", spec.title);
  data.first = prop("first", spec.first);
  data.last = prop("last", spec.last);
  data.address = prop("address", spec.address || []);

  return obj;
};

