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

f.model = function (spec) {
  spec = spec || {};

  var _changed, _delete, _deleted, _error, _fetch, _fetched, _patch, _post,
    that = {},
    data = {};

  // ..........................................................
  // PUBLIC
  //

  that.data = data;

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

  _changed = function () {
    this.goto("../dirty");
  };

  _delete = function () {
    this.goto("/busy/saving");
  };

  _deleted = function () {
    this.goto("/deleted");
  };

  _error = function () {
    this.goto("/error");
  };

  _fetch = function () {
    this.goto("/busy");
  };

  _fetched = function () {
    this.goto("/ready/fetched");
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

  that.state = State.define(function () {
    this.state("ready", function () {
      this.state("new", function () {
        this.event("fetch", _fetch.bind(this));
        this.event("save", _post.bind(this));
        this.event("delete", _deleted.bind(this));
      });

      this.state("fetched", function () {
        this.state("clean", function () {
          this.event("changed", _changed.bind(this));
          this.event("delete", _delete.bind(this));
        });

        this.state("dirty", function () {
          this.event("save", _patch.bind(this));
        });

        this.event("fetch", _fetch.bind(this));
      });

      this.state("deleted");
    });

    this.state("busy", function () {
      this.state("fetching");
      this.state("saving");

      this.event("fetched", _fetched.bind(this));
      this.event("deleted", _deleted.bind(this));
      this.event("error", _error.bind(this));
    });

    this.state("error");
  });

  that.state.goto();

  return that;
};

f.contact = function (spec) {
  spec = spec || {};

  var that = f.model(spec),
    data = that.data;

  // ..........................................................
  // ATTRIBUTES
  //

  data.id = m.prop(spec.id);
  data.created = m.prop(spec.created || new Date());
  data.createdBy = m.prop(spec.createdBy || "admin");
  data.updated = m.prop(spec.updated || new Date());
  data.updatedBy = m.prop(spec.updatedBy || "admin");
  data.specectType = m.prop("Contact");
  data.owner = m.prop(spec.owner || "admin");
  data.etag = m.prop(spec.etag);
  data.notes = m.prop(spec.notes || []);
  data.title = m.prop(spec.title);
  data.first = m.prop(spec.first);
  data.last = m.prop(spec.last);
  data.address = m.prop(spec.address || []);

  return that;
};

