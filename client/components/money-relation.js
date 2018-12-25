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
/*global require, module*/
/*jslint white, es6, this*/
(function () {
  "use strict";

  var moneyRelation = {},
    m = require("mithril"),
    f = require("common-core"),
    stream = require("stream"),
    catalog = require("catalog");
    
  function selections (item) {
    var value = item.data.hasDisplayUnit() ? 
      item.data.displayUnit().data.code() : item.data.code();

    return m("option", value);
  }

  moneyRelation.viewModel = function (options) {
    var selector, wasDisabled, wasCurrency,
      vm = {},
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

    // Bind to property state change to update conversion ratio if applicable
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
      return f.baseCurrency(vm.effective()).data.code();
    };
    vm.amount = function (...args) {
      var money;

      if (args.length) {
        money = f.copy(prop());
        money.amount = args[0];
        prop(money);
      }

      return prop().amount;
    };
    vm.baseAmount = function () {
      var ret, money,
        baseCode = f.baseCurrency(vm.effective()).data.code(),
        conv = vm.conversion(),
        value = prop.toJSON(); // Raw value

      if (value.effective) {
        ret = value.baseAmount;
      } else if (conv &&
        conv.data.fromCurrency().data.code() === baseCode) {
        ret = value.amount.times(conv.data.ratio.toJSON());
      } else if (conv) {
        ret = value.amount.div(conv.data.ratio.toJSON());
      } else {
        return;
      }

      money = {
        amount: ret,
        currency: baseCode,
        effective: null,
        baseAmount: null
      };

      return f.formats.money.fromType(money).amount;
    };
    vm.conversion = stream();
    vm.currency = function (...args) {
      var money;

      if (args.length) {
        money = f.copy(prop());
        money.currency = args[0];
        prop(money);
      }

      return prop().currency;
    };
    vm.disableCurrency = stream(!!options.disableCurrency);
    vm.currencies = function () {
      var ret, curr = vm.currency();

      function same (item) { return item; }

      function deleted (item) {
        return !item.data.isDeleted() ||
          curr === item.data.code() ||
          (item.data.hasDisplayUnit() &&
          curr === item.data.displayUnit().data.code()); 
      }

      ret = currencyList().map(same).filter(deleted); // Hack

      ret.sort(function (a, b) {
        var attrA = a.data.hasDisplayUnit() ?
            a.data.displayUnit().data.code() : a.data.code(),
          attrB = b.data.hasDisplayUnit() ?
            b.data.displayUnit().data.code() : b.data.code();

        return attrA > attrB ? 1 : -1;
      });

      return ret;
    };
    vm.effective = function () {
      return prop().effective;
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
          reject(err);
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
    // Selector is memoized to prevent constant rerendering
    // that otherwise interferes with the relation widget autocompleter
    vm.selector = function (vnode) {
        var selectorStyle,
          disabled = vnode.attrs.disabled === true ||
            vm.disableCurrency() || vm.effective(),
          currency = vm.currency();

        if (selector && disabled === wasDisabled
            && currency === wasCurrency) {
          return selector;
        }

        selectorStyle = {
          width: "95px"
        };
          
        if (!vm.showCurrency()) {
          selectorStyle.display = "none";
        }

        wasDisabled = disabled;
        wasCurrency = currency;
        selector = m("select", {
          id: "C" + vm.id(),
          onchange: (e) => vm.currency(e.target.value), 
          value: currency,
          disabled: disabled,
          style: selectorStyle
        }, vm.currencies().map(selections));
        
        return selector;
    };
    vm.showCurrency = stream(options.showCurrency !== false);

    return vm;
  };

  moneyRelation.component = {
    oninit: function (vnode) {
      var options = vnode.attrs;

      // Set up viewModel if required
      this.viewModel = moneyRelation.viewModel({
        parentViewModel: options.parentViewModel,
        parentProperty: options.parentProperty,
        id: options.id,
        isCell: options.isCell,
        disabled: options.disabled,
        showCurrency: options.showCurrency,
        disableCurrency: options.disableCurrency
      });
    },

    view: function (vnode) {
      var currencyLabelStyle, inputStyle, amountLabelStyle,
        displayStyle,
        vm = this.viewModel, 
        disabled = vnode.attrs.disabled === true || vm.effective();

      displayStyle = {
          display: "inline-block"
      };
        
      amountLabelStyle = {
        textAlign: "right", 
        marginTop: vm.label() ? "6px" : "",
        marginRight: "30px",
        display: "inline-block"
      };

      inputStyle = {
        marginRight: "4px",
        width: "116px",
        textAlign: "right"
      };

      if (vm.isCell()) {
        inputStyle.border = "none";
        displayStyle.float = "right";
        amountLabelStyle.display = "none";
      }

      if (!vm.baseAmount()) {
        amountLabelStyle.display = "none";
      }

      currencyLabelStyle = f.copy(amountLabelStyle);
      amountLabelStyle.width = "105px";

      // Build the view
      return m("div", {style: displayStyle}, [
        m("input", {
          style: inputStyle,
          id: "A" + vm.id(),
          onchange: (e) => vm.amount(e.target.value),
          value: vm.amount(),
          disabled: disabled,
          oncreate: vnode.attrs.onCreate,
          onremove: vnode.attrs.onRemove
        }),
        vm.selector(vnode),
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


