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
    var vm = {},
      parent = options.parentViewModel,
      store = catalog.store(),
      currencyList = store.data().currencies,
      currConvList = store.models().currencyConversion.list({fetch: false}),
      prop = parent.model().data[options.parentProperty];

    // Bind to property state change to update conversion ratio if applicable
    parent.model().onChange(options.parentProperty, function (p) {
      var baseCode = f.baseCurrency().data.code(),
        newCurr = p.newValue().currency;

      if (newCurr === baseCode) {
        vm.conversion(null);
        return;
      }

      if (p.oldValue().currency !== newCurr &&
          !p.newValue().ratio) {
        vm.conversion(null);
        vm.fetchConversion(baseCode, f.getCurrency(newCurr).data.code());
      }
    });

    parent.model().state().resolve("/Ready/Fetched").enter(function() {
      var baseCode = f.baseCurrency().data.code(),
        newCurr = prop().currency;

      if (newCurr === baseCode) {
        vm.conversion(null);
        return;
      }

      if (newCurr && !prop().ratio) {
        vm.conversion(null);
        vm.fetchConversion(baseCode, f.getCurrency(newCurr).data.code());
      }
    });

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
      var ret, money,
        baseCode = f.baseCurrency().data.code(),
        conv = vm.conversion(),
        value = prop.toJSON(); // Raw value

      if (value.effective) {
        ret = value.amount * value.ratio;
      } else if (conv &&
        conv.data.fromCurrency().data.code() === baseCode) {
        ret = value.amount * conv.data.ratio.toJSON();
      } else if (conv) {
        ret = value.amount / conv.data.ratio.toJSON();
      } else {
        return;
      }

      money = {
        amount: ret,
        currency: baseCode,
        effective: null,
        ratio: null
      };

      return f.formats.money.fromType(money).amount;
    };
    vm.conversion = stream();
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
    /**
      Causes the currency conversion to be updated.

      @param {String} 'From' currency code
      @param {String} 'To' currency code
    */
    vm.fetchConversion = function (fromCurr, toCurr) {
      return new Promise (function (resolve, reject) {
        var filter;

        function callback (result) {
          vm.conversion(result.length ? result[0] : null);
          resolve();
        }

        function error (err) {
          reject();
        }

        filter = {
          criteria: [
            {
              value: [fromCurr, toCurr],
              operator: "IN",
              property: "fromCurrency.code"
            },
            {
              value: [fromCurr, toCurr],
              operator: "IN",
              property: "toCurrency.code"
            }
          ],
          sort: [
            {
              property: "effective",
              order: "DESC"
            }
          ],
          limit: 1
        };

        currConvList().fetch(filter, false)
          .then(callback)
          .catch(error);
      });
    };

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

      if (!vm.baseAmount()) {
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


