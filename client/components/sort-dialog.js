/**
    Framework for building object relational database apps

    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*global window, f, m */
(function (f) {
  "use strict";

  var statechart = window.statechart;

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Function} [options.filter] Filter property
  */
  f.viewModels.sortDialogViewModel = function (options) {
    options = options || {};
    var vm, state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.add = function () {

    };
    vm.attrs = function () {
      return options.attrs;
    };
    vm.cancel = function () {
      vm.reset();
      state.send("close");
    };
    vm.id = m.prop(options.id || f.createId());
    vm.itemValueChanged = function (index, value) {
      var sort = vm.filter().sort;
      sort[index].property = value;
    };
    vm.items = function () {
      var i = 0,
        items = vm.filter().sort.map(function (item) {
          var ret = JSON.parse(JSON.stringify(item));
          ret.index = i;
          i += 1;
          return ret;
        });

      return items;
    };
    vm.filter = m.prop();
    vm.list = m.prop(options.list);
    vm.ok = function () {
      options.filter(vm.filter()); // Kicks off refresh
      state.send("close");
    };
    vm.remove = function () {

    };
    vm.reset = function () {
      var filter = JSON.parse(JSON.stringify(options.filter()));
      filter.sort = filter.sort || [];
      vm.filter(filter);
    };
    vm.show = function () {
      state.send("show");
    };

    vm.reset();

    // ..........................................................
    // PRIVATE
    //

    // Statechart
    state = statechart.State.define({concurrent: true}, function () {
      this.state("Display", function () {
        this.state("Closed", function () {
          this.enter(function () {
            var  id = vm.id(),
              dlg = document.getElementById(id);
            if (dlg) { dlg.close(); }
          });
          this.event("show", function () {
            this.goto("../Showing");
          });
        });
        this.state("Showing", function () {
          this.enter(function () {
            var id = vm.id(),
              dlg = document.getElementById(id);
            vm.reset();
            if (dlg) { dlg.showModal(); }
          });
          this.event("close", function () {
            this.goto("../Closed");
          });
        });
      });
    });
    state.goto();

    return vm;
  };

  // Define dialog component
  f.components.sortDialog = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = options.viewModel || f.viewModels.sortDialogViewModel(options);
    };

    component.view = function (ctrl) {
      var view,
        vm = ctrl.vm;

      view = m("dialog", {
          id: vm.id(),
          style: {
            borderRadius: "10px",
            padding: "0px"
          }
        }, [
        m("h3", {
          style: {
            backgroundColor: "snow",
            borderBottomColor: "lightgrey",
            borderBottomStyle: "solid",
            borderBottomWidth: "thin",
            margin: "2px",
            padding: "6px"
          }
        }, "Sort"),
        m("div", {style: {padding: "1em"}}, [
          m("button", {
            class: "pure-button",
            style: {
              backgroundColor: "white"
            },
            title: "Add",
            onclick: vm.add
          }, [m("i", {class:"fa fa-plus-circle"})], " Add"),
          m("button", {
            class: "pure-button",
            style: {
              backgroundColor: "white"
            },
            title: "Remove",
            onclick: vm.remove
          }, [m("i", {class:"fa fa-remove"})], " Remove"),
          m("table", {
            class: "pure-table"
          }, [
            m("thead", [
              m("th", "Column"),
              m("th", "Order")
            ]),
            vm.items().map(function (item) {
              return m("tr", [
                m("td",
                  m("select", {
                    onchange: m.withAttr("value", vm.itemValueChanged.bind(this, item.index))
                  },
                    vm.attrs().map(function (attr) {
                      return m("option", {value: attr}, attr.toName());
                    }), 
                    item.property
                  )
                ),
                m("td", [
                  m("select", [
                    m("option", {value: "ASC"}, "Ascending"),
                    m("option", {value: "DESC"}, "Descending")
                  ])
                ])
              ]);
            })
          ]),
          m("br"),
          m("button", {
            class: "pure-button  pure-button-primary",
            style: {marginRight: "5px"},
            onclick: vm.ok
          }, "Ok"),
          m("button", {
            class: "pure-button",
            onclick: vm.cancel
          }, "Cancel")
        ])
      ]);

      return view;
    };

    return component;
  };

}(f));


