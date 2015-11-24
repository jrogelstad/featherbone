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
    var vm, state, createButton, buttonAdd, buttonRemove,
      selection = m.prop();

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.add = function () {
      var addAttr, hasAttr,
       sort = vm.filter().sort,
       attrs = vm.attrs();

      addAttr = function (attr) {
        if (!sort.some(hasAttr.bind(attr))) {
          sort.push({property: attr});
          return true;
        }
      };

      hasAttr = function (item) { 
        return item.property === this;
      };

      attrs.some(addAttr);

      if (!vm.isSelected()) {
        vm.selection(sort.length - 1);
      }

      buttonRemove.enable();
      vm.scrollBottom(true);
    };
    vm.attrs = function () {
      return options.attrs;
    };
    vm.buttonAdd = function () {
      return buttonAdd;
    };
    vm.buttonRemove = function () {
      return buttonRemove;
    };
    vm.cancel = function () {
      vm.reset();
      state.send("close");
    };
    vm.id = m.prop(options.id || f.createId());
    vm.isSelected = function () {
      return state.resolve(state.resolve("/Selection").current()[0]).isSelected();
    };
    vm.itemOrderChanged = function (index, value) {
      var sort = vm.filter().sort;
      sort[index].order = value;
    };
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
      var idx = selection(),
        sort = vm.filter().sort;
      sort.splice(idx, 1);
      state.send("unselected");
      if (sort.length) {
        if (idx > 0) { idx -= 1; }
        selection(idx);
        return;
      }
      buttonRemove.disable();
    };
    vm.reset = function () {
      var filter = JSON.parse(JSON.stringify(options.filter()));
      filter.sort = filter.sort || [];
      vm.filter(filter);
      if (!filter.sort.length) { vm.add(); }
      vm.selection(0);
    };
    vm.scrollBottom = m.prop(false);
    vm.selection = function (index, select) {
      if (select) { state.send("selected"); }
      if (arguments.length) {
        return selection(index);
      }
      return selection();
    };
    vm.show = function () {
      state.send("show");
    };

    // ..........................................................
    // PRIVATE
    //

    createButton = f.viewModels.buttonViewModel;
    buttonAdd = createButton({
      onclick: vm.add,
      label: "Add",
      icon: "plus-circle",
      style: {backgroundColor: "white"}
    });

    buttonRemove = createButton({
      onclick: vm.remove,
      label: "Remove",
      icon: "remove",
      style: {backgroundColor: "white"}
    });

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
      this.state("Selection", function () {
        this.state("Off", function () {
          this.event("selected", function () {
            this.goto("../On");
          });
          this.isSelected = function () { return false; };
        });
        this.state("On", function () {
          this.event("unselected", function () {
            this.goto("../Off");
          });
          this.isSelected = function () { return true; };
        });
      });
    });
    state.goto();

    vm.reset();

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
        button = f.components.button,
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
          m.component(button({viewModel: vm.buttonAdd()})),
          m.component(button({viewModel: vm.buttonRemove()})),
          m("table", {
            class: "pure-table",
            style: {minWidth: "350px"}
          }, [
            m("thead", {
              style: {
                minWidth: "inherit",
                display: "inherit"
              }
            }, [
              m("th", {style: {minWidth: "150px"}}, "Column"),
              m("th", {style: {minWidth: "150px"}}, "Order")
            ]),
            m("tbody", {
              id: "sortTbody",
              style: {
                maxHeight: "175px",
                minHeight: "175px",
                overflowX: "hidden",
                overflowY: "auto",
                display: "inline-block"
              },
              config: function (e) {
                if (vm.scrollBottom()) {
                  e.scrollTop = e.scrollHeight;
                }
                vm.scrollBottom(false);
              } 
            }, vm.items().map(function (item) {
                var iview,
                  color = "White";

                if (vm.selection() === item.index) {
                  if (vm.isSelected()) {
                    color = "LightSkyBlue" ;
                  } else {
                    color = "AliceBlue";
                  }
                }

                iview = m("tr", {
                  onclick: vm.selection.bind(this, item.index, true),
                  style: {backgroundColor: color}
                },[
                  m("td",
                    m("select", {
                      style: {minWidth: "150px"}, 
                      value: item.property,
                      onchange: m.withAttr("value", vm.itemValueChanged.bind(this, item.index))
                    }, vm.attrs().map(function (attr) {
                        return m("option", {value: attr}, attr.toName());
                      })
                    )
                  ),
                  m("td", [
                    m("select", {
                      style: {minWidth: "150px"},
                      onchange: m.withAttr("value", vm.itemOrderChanged.bind(this, item.index))
                    },[
                      m("option", {value: "ASC"}, "Ascending"),
                      m("option", {value: "DESC"}, "Descending")
                    ], item.order || "ASC")
                  ])
                ]);

                return iview;
              })
            )
          ]),
          m("br"),
          m("button", {
            class: "pure-button  pure-button-primary",
            style: {marginRight: "5px"},
            autofocus: true,
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


