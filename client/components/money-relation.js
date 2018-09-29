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
      currency = catalog.register("models").currency,
      //currencyList = catalog.register("data", "currencies");
      currencyList = [];
      currencyList.push(currency({
        id: "4y9dtthuen7z",
        code: "USD",
        description: "U.S. Dollar"
      }));
      currencyList.push(currency({
        id: "twugl4nqeodj",
        code: "EUR",
        description: "Euro"
      }));
      currencyList.push(currency({
        id: "qrp406n3hdtu",
        code: "XBT",
        description: "Bitcoin"
      }));

    prop = parent.model().data[options.parentProperty];
    prop(prop() || f.money(0, currencyList[0]));

    vm.id = stream(options.id);
    vm.isCell = stream(!!options.isCell);
    vm.label = function () {
      return "USD";
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
      return currencyList;
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
      var inputStyle,
        vm = this.viewModel,
        disabled = vnode.attrs.disabled === true,
        style = vm.style(),
        labelStyle = {
          display: "inline"
        };

      if (vm.isCell()) {
        inputStyle = {
          minWidth: "100px",
          maxWidth: "100%",
          border: "none"
        };
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
          disabled: disabled
        }, vm.currencies().map(function (item) {
          return m("option", item.data.code());
        }))
      ]);
    }
  };

  catalog.register("components", "moneyRelation", moneyRelation.component);
  module.exports = moneyRelation;

}());


