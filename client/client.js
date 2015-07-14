//this application only has one component: todo
var todo = {};

//for simplicity, we use this component to namespace the model classes

//the Todo class has two properties
todo.Todo = function(data) {
    this.description = m.prop(data.description);
    this.done = m.prop(false);
};

//the TodoList class is a list of Todo's
todo.TodoList = Array;

//the view-model tracks a running list of todos,
//stores a description for new todos before they are created
//and takes care of the logic surrounding when adding is permitted
//and clearing the input after adding a todo to the list
todo.vm = (function() {
    var vm = {}
    vm.init = function() {
        //a running list of todos
        vm.list = new todo.TodoList();

        //a slot to store the name of a new todo before it is created
        vm.description = m.prop("");

        //adds a todo to the list, and clears the description field for user convenience
        vm.add = function() {
            if (vm.description()) {
                vm.list.push(new todo.Todo({description: vm.description()}));
                vm.description("");
            }
        };
    }
    return vm
}())

//the controller defines what part of the model is relevant for the current page
//in our case, there's only one view-model that handles everything
todo.controller = function() {
    todo.vm.init()
}

//here's the view
todo.view = function() {
    return m("html", [
        m("body", [
            m("input", {onchange: m.withAttr("value", todo.vm.description), value: todo.vm.description()}),
            m("button", {onclick: todo.vm.add}, "Add"),
            m("table", [
                todo.vm.list.map(function(task, index) {
                    return m("tr", [
                        m("td", [
                            m("input[type=checkbox]", {onclick: m.withAttr("checked", task.done), checked: task.done()})
                        ]),
                        m("td", {style: {textDecoration: task.done() ? "line-through" : "none"}}, task.description()),
                    ])
                })
            ])
        ])
    ]);
};

//initialize the application
m.mount(document, {controller: todo.controller, view: todo.view});

var State = (typeof require === 'function' ? require('statechart') : window.statechart).State;

var door = State.define(function() {
  this.state('closed', function() {
    this.state('locked', function() {
      this.event('unlockDoor', function() { this.goto('../unlocked'); });
    });

    this.state('unlocked', function() {
      this.event('lockDoor', function() { this.goto('../locked'); });
      this.event('openDoor', function() { this.goto('/opened'); });
    });

    this.event('knock', function() { console.log('*knock knock*'); });
  });

  this.state('opened', function() {
    this.event('closeDoor', function() { this.goto('/closed/unlocked'); });
  });
});

var f = {};

f.Contact = function(obj) {
  obj = obj || {};

  this.data = data = {};

  data.id = m.prop(obj.id);
  data.created = m.prop(obj.created || new Date());
  data.createdBy = m.prop(obj.createdBy || "admin");
  data.updated = m.prop(obj.updated || new Date());
  data.updatedBy = m.prop(obj.updatedBy || "admin");
  data.objectType = m.prop('Contact');
  data.owner = m.prop(obj.owner || "admin");
  data.etag = m.prop(obj.etag);
  data.notes = m.prop(obj.notes || []);
  data.title = m.prop(obj.title);
  data.first = m.prop(obj.first);
  data.last = m.prop(obj.last);
  data.address = m.prop(obj.address || []);

  this.state = State.define(function() {
    this.state('ready', function() {
      this.state('new', function() {
        this.event('fetch', function() { this.goto('/busy/fetching'); });
        this.event('save', function() { this.goto('/busy/submitting'); });
        this.event('delete', function() { this.goto('../destroyed'); });
      });

      this.state('fetched', function() {
        this.state('clean', function() {
          this.event('changed', function() { this.goto('../dirty'); });
          this.event('delete', function() { this.goto('/ready/destroyed/dirty'); });
        });

        this.state('dirty', function() {
          this.event('save', function() { this.goto('/busy/submitting'); });
        });

        this.event('fetch', function() { this.goto('/busy/submitting'); });
      });

      this.state('destroyed', function() {
        this.state('clean');
        this.state('dirty');
      });
    });

    this.state('busy', function() {
      this.state('loading');
      this.state('submitting');

      this.event('success', function() { this.goto('/ready/fetched'); });
      this.event('error', function() { this.goto('/error'); });
    });

    this.state('error');
  });
  this.state.goto();
};

