/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*jslint this, browser*/
import {f} from "../core.js";
import {catalog} from "../models/catalog.js";

const moneyRelation = {};
const m = window.m;

function selections(item) {
    let value = (
        item.data.hasDisplayUnit()
        ? item.data.displayUnit().data.code()
        : item.data.code()
    );

    return m("option", value);
}

moneyRelation.viewModel = function (options) {
    let selector;
    let wasDisabled;
    let wasCurrency;
    let vm = {};
    let parent = options.parentViewModel;
    let store = catalog.store();
    let currencyList = store.data().currencies;
    let currConvList = store.models().currencyConversion.list({
        fetch: false
    });
    let prop = parent.model().data[options.parentProperty];

    // Bind to property state change to update conversion ratio if
    // applicable
    parent.model().onChange(options.parentProperty, function (p) {
        let baseCode = f.baseCurrency().data.code();
        let newCurr = p.newValue().currency;

        if (newCurr === baseCode) {
            vm.conversion(null);
            return;
        }

        if (
            p.oldValue().currency !== newCurr &&
            !p.newValue().ratio
        ) {
            vm.conversion(null);
            vm.fetchConversion(
                baseCode,
                f.getCurrency(newCurr).data.code()
            );
        }
    });

    // Bind to property state change to update conversion ratio if
    // applicable
    parent.model().state().resolve("/Ready/Fetched").enter(function () {
        let baseCode = f.baseCurrency().data.code();
        let newCurr = prop().currency;

        if (newCurr === baseCode) {
            vm.conversion(null);
            return;
        }

        if (newCurr && !prop().ratio) {
            vm.conversion(null);
            vm.fetchConversion(
                baseCode,
                f.getCurrency(newCurr).data.code()
            );
        }
    });

    vm.id = f.prop(options.id);
    vm.isCell = f.prop(Boolean(options.isCell));
    vm.label = function () {
        return f.baseCurrency(vm.effective()).data.code();
    };
    vm.amount = function (...args) {
        let money;

        if (args.length) {
            money = f.copy(prop());
            money.amount = args[0];
            prop(money);
        }

        return prop().amount;
    };
    vm.baseAmount = function () {
        let ret;
        let money;
        let baseCode = f.baseCurrency(vm.effective()).data.code();
        let conv = vm.conversion();
        let value = prop.toJSON(); // Raw value

        if (value.effective) {
            ret = value.baseAmount;
        } else if (
            conv &&
            conv.data.fromCurrency().data.code() === baseCode
        ) {
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
    vm.conversion = f.prop();
    vm.currency = function (...args) {
        let money;

        if (args.length) {
            money = f.copy(prop());
            money.currency = args[0];
            prop(money);
        }

        return prop().currency;
    };
    vm.disableCurrency = f.prop(Boolean(options.disableCurrency));
    vm.currencies = function () {
        let ret;
        let curr = vm.currency();

        function same(item) {
            return item;
        }

        function deleted(item) {
            return (
                !item.data.isDeleted() ||
                curr === item.data.code() || (
                    item.data.hasDisplayUnit() &&
                    curr === item.data.displayUnit().data.code()
                )
            );
        }

        ret = currencyList().map(same).filter(deleted); // Hack

        ret.sort(function (a, b) {
            let attrA = (
                a.data.hasDisplayUnit()
                ? a.data.displayUnit().data.code()
                : a.data.code()
            );
            let attrB = (
                b.data.hasDisplayUnit()
                ? b.data.displayUnit().data.code()
                : b.data.code()
            );

            return (
                attrA > attrB
                ? 1
                : -1
            );
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
        return new Promise(function (resolve, reject) {
            let filter;

            function callback(result) {
                vm.conversion(
                    result.length
                    ? result[0]
                    : null
                );
                resolve();
            }

            function error(err) {
                reject(err);
            }

            filter = {
                criteria: [{
                    value: [fromCurr, toCurr],
                    operator: "IN",
                    property: "fromCurrency.code"
                }, {
                    value: [fromCurr, toCurr],
                    operator: "IN",
                    property: "toCurrency.code"
                }],
                sort: [{
                    property: "effective",
                    order: "DESC"
                }],
                limit: 1
            };

            currConvList().fetch(filter, false).then(
                callback
            ).catch(
                error
            );
        });
    };
    // Selector is memoized to prevent constant rerendering
    // that otherwise interferes with the relation widget autocompleter
    vm.selector = function (vnode) {
        let selectorStyle;
        let disabled = (
            vnode.attrs.disabled === true ||
            vm.disableCurrency() || vm.effective()
        );
        let currency = vm.currency();

        if (
            selector && disabled === wasDisabled &&
            currency === wasCurrency
        ) {
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
    vm.showCurrency = f.prop(options.showCurrency !== false);

    return vm;
};

moneyRelation.component = {
    oninit: function (vnode) {
        let options = vnode.attrs;

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
        let currencyLabelStyle;
        let inputStyle;
        let amountLabelStyle;
        let displayStyle;
        let vm = this.viewModel;
        let disabled = vnode.attrs.disabled === true || vm.effective();

        displayStyle = {
            display: "inline-block"
        };

        amountLabelStyle = {
            textAlign: "right",
            marginTop: (
                vm.label()
                ? "6px"
                : ""
            ),
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
        return m("div", {
            style: displayStyle
        }, [
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
export {moneyRelation};
