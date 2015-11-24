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
    vm.id = m.prop(options.id || f.createId());
    vm.close = function () {
      state.send("close");
    };
    vm.filter = m.prop(options.list.filter() || {});
    vm.list = m.prop(options.list);
    vm.sort = m.prop(vm.filter() ? vm.filter().sort || [] : []);
    vm.remove = function () {

    };
    vm.show = function () {
      state.send("show");
    };

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
        vm = ctrl.vm,
        sort = vm.sort();

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
            vm.sort().map(function (item) {
              return m("tr", [
                m("td",
                  m("select",
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
            onclick: vm.close
          }, "Ok"),
          m("button", {
            class: "pure-button",
            onclick: vm.close
          }, "Cancel")
        ])
      ]);

      return view;
    };

    return component;
  };

}(f));


