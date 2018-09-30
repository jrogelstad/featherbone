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
    vm.baseAmount = function () {
      return "1,000,000.00";
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
    vm.value = stream();

    return vm;
  };

  function selections (item) {
    var value = item.data.hasDisplayUnit() ? 
      item.data.displayUnit().data.code() : item.data.code();

    return m("option", value);
  }

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
      var vm = this.viewModel, currencyLabelStyle,
        baseCurrency = f.baseCurrency(),
        baseCurrencyCode = baseCurrency.data.hasDisplayUnit() ?
          baseCurrency.data.displayUnit().data.code() : baseCurrency.data.code(),
        disabled = vnode.attrs.disabled === true,
        amountLabelStyle = {
          marginLeft: "12px", 
          marginTop: vm.label() ? "6px" : "",
          display: "inline-block"
        },
        inputStyle = {
          marginRight: "4px",
          width: "116px"
        };

      if (vm.isCell()) {
        inputStyle.border = "none";
        amountLabelStyle.display = "none";
        currencyLabelStyle.display = "none";
      }

      if (baseCurrencyCode === vm.currency()) {
        amountLabelStyle.display = "none";
      }

      currencyLabelStyle = f.copy(amountLabelStyle);
      amountLabelStyle.width = "110px";

      // Build the view
      return m("div", {style: {display: "inline-block"}}, [
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
        }, vm.currencies().map(selections)),
        m("div", [
          m("div", {
              style: amountLabelStyle
            }, vm.baseAmount()),
          m("div", {
              style: currencyLabelStyle 
          }, vm.label())
        ])
      ]);
    }
  };

  catalog.register("components", "moneyRelation", moneyRelation.component);
  module.exports = moneyRelation;

}());


