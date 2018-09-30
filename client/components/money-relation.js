/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

(function () {
  "use strict";

  var moneyRelation = {},
    m = require("mithril"),
    f = require("common-core"),
    stream = require("stream"),
    catalog = require("catalog");

  moneyRelation.viewModel = function (options) {
    var vm = {}, prop,
      parent = options.parentViewModel,
      currencyList = catalog.store().data().currencies;

    prop = parent.model().data[options.parentProperty];

    vm.id = stream(options.id);
    vm.isCell = stream(!!options.isCell);
    vm.label = function () {
      return f.baseCurrency().data.code();
    };
    vm.amount = function (value) {
      var money;

      if (arguments.length) {
        money = f.copy(prop());
        money.amount = value;
        prop(money);
      }

      return prop().amount;
    };
    vm.currency = function (value) {
      var money;

      if (arguments.length) {
        money = f.copy(prop());
        money.currency = value;
        prop(money);
      }

      return prop().currency;
    };
    vm.currencies = function () {
      var ret = currencyList();

      ret.sort(function (a, b) {
        var attrA = a.data.hasDisplayUnit() ?
            a.data.displayUnit().data.code() : a.data.code(),
          attrB = b.data.hasDisplayUnit() ?
            b.data.displayUnit().data.code() : b.data.code();

        return attrA > attrB ? 1 : -1;
      });

      return ret;
    };
    vm.style = stream({});
    vm.value = stream();

    return vm;
  };

  moneyRelation.component = {
    oninit: function (vnode) {
      var options = vnode.attrs,
        that = this;

      // Set up viewModel if required
      this.viewModel = moneyRelation.viewModel({
        parentViewModel: options.parentViewModel,
        parentProperty: options.parentProperty,
        id: options.id,
        isCell: options.isCell,
        disabled: options.disabled
      });
      this.viewModel.style(options.style || {});

      // Make sure data changes made by biz logic in the model are recognized
      /*
      options.parentViewModel.model().onChanged(options.amountProperty, function (prop) {
        that.viewModel.amount(prop());
      });

      options.parentViewModel.model().onChanged("currency", function (prop) {
        that.viewModel.currency(prop());
      });
      */
    },

    view: function (vnode) {
      var vm = this.viewModel,
        disabled = vnode.attrs.disabled === true,
        style = vm.style(),
        labelStyle = {
          display: "inline"
        },
        inputStyle = {
          marginRight: "4px",
          width: "116px"
        };

      if (vm.isCell()) {
        inputStyle.border = "none";
        labelStyle.display = "none";
      }

      style.display = style.display || "inline-block";

      // Build the view
      return m("div", {style: style}, [
        m("input", {
          style: inputStyle,
          id: "A" + vm.id(),
          onchange: m.withAttr("value", vm.amount),
          value: vm.amount(),
          disabled: disabled
        }),
        m("select", {
          id: "C" + vm.id(),
          onchange: m.withAttr("value", vm.currency), 
          value: vm.currency(),
          disabled: disabled,
          style: {
            width: "95px"
          }
        }, vm.currencies().map(function (item) {
          var value = item.data.hasDisplayUnit() ? 
            item.data.displayUnit().data.code() : item.data.code();

          return m("option", value);
        }))
      ]);
    }
  };

  catalog.register("components", "moneyRelation", moneyRelation.component);
  module.exports = moneyRelation;

}());


