/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
*/
/*jslint this browser unordered*/
/*global f, m*/
/**
    @module MoneyRelation
*/

const moneyRelation = {};

function selections(item) {
    let value = (
        item.data.displayUnit()
        ? item.data.displayUnit().data.code()
        : item.data.code()
    );

    return m("option", value);
}

/**
    View model editor for properties with format `Money`.
    @class MoneyRelation
    @constructor
    @namespace ViewModels
    @param {Object} options Options
    @param {Object} options.parentViewModel
    @param {String} options.id
    @param {String} options.key
    @param {String} options.parentProperty
    @param {Boolean} [options.isCell]
    @param {Boolean} [options.showCurrency]
    @param {Boolean} [options.disableCurrency]
*/
moneyRelation.viewModel = function (options) {
    let selector;
    let wasReadOnly;
    let wasCurrency;
    let vm = {};
    let parent = options.parentViewModel;
    let store = f.catalog().store();
    let currencyList = store.data().currencies;
    let currConvList = f.createList("CurrencyConversion", {
        fetch: false
    });
    let prop = f.resolveProperty(parent.model(), options.parentProperty);

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

    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id);
    /**
        @method key
        @param {String} key
        @return {String}
    */
    vm.key = f.prop(options.key);
    /**
        Layout for table cell.
        @method isCell
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isCell = f.prop(Boolean(options.isCell));
    /**
        @method label
        @return {String}
    */
    vm.label = function () {
        return f.baseCurrency(vm.effective()).data.code();
    };
    /**
        Amount in local currency.
        @method amount
        @param {Number} amount
        @return {Number}
    */
    vm.amount = function (...args) {
        let money;

        if (args.length) {
            money = f.copy(prop());
            money.amount = args[0];
            prop(money);
        }

        return prop().amount;
    };
    /**
        Amount in base currency.
        @method baseAmount
        @return {Number}
    */
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

        return f.formats().money.fromType(money).amount;
    };
    /**
        Currency conversion rate.
        @method conversion
        @param {Number} ratio
        @return {Number}
    */
    vm.conversion = f.prop();
    /**
        Currency code.
        @method currency
        @param {String} currency
        @return {String}
    */
    vm.currency = function (...args) {
        let money;

        if (args.length) {
            money = f.copy(prop());
            money.currency = args[0];
            prop(money);
        }

        return prop().currency;
    };
    /**
        Disable currency selector.
        @method disableCurrency
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.disableCurrency = f.prop(Boolean(options.disableCurrency));
    /**
        Array of eligible currencies.
        @method currencies
        @return {Array}
    */
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
                    item.data.displayUnit() &&
                    curr === item.data.displayUnit().data.code()
                )
            );
        }

        ret = currencyList().map(same).filter(deleted); // Hack

        ret.sort(function (a, b) {
            let attrA = (
                a.data.displayUnit()
                ? a.data.displayUnit().data.code()
                : a.data.code()
            );
            let attrB = (
                b.data.displayUnit()
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
    /**
        Effective date.
        @method effective
        @return {String}
    */
    vm.effective = function () {
        return prop().effective;
    };
    /**
        Causes the currency conversion to be updated.

        @method fetchConversion
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

            currConvList.fetch(filter, false).then(
                callback
            ).catch(
                error
            );
        });
    };
    /**
        Selector is memoized to prevent constant rerendering
        that otherwise interferes with the relation widget autocompleter
        @method selector
        @param {Object} vnode Virtual nodeName
        @return {Object} Selector
    */
    vm.selector = function (vnode) {
        let selectorStyle;
        let readOnly = (
            vnode.attrs.readonly === true ||
            vm.disableCurrency() || vm.effective()
        );
        let currency = vm.currency();

        if (
            selector && readOnly === wasReadOnly &&
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

        wasReadOnly = readOnly;
        wasCurrency = currency;
        selector = m("select", {
            id: "C" + vm.id(),
            onchange: (e) => vm.currency(e.target.value),
            value: currency,
            readonly: readOnly,
            style: selectorStyle
        }, vm.currencies().map(selections));

        return selector;
    };
    /**
        @method showCurrency
        @param {Boolean} flag default = false
        @return {Boolean}
    */
    vm.showCurrency = f.prop(options.showCurrency === true);

    return vm;
};

/**
    Editor component for properties with format `Money`.
    @class MoneyRelation
    @static
    @namespace Components
*/
moneyRelation.component = {
    /**
        @method onint
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {Object} vnode.attrs.parentViewModel
        @param {String} vnode.attrs.parentProperty
        @param {String} [vnode.attrs.id]
        @param {Boolean} [vnode.attrs.isCell]
        @param {Boolean} [vnode.attrs.showCurrency]
        @param {Boolean} [vnode.attrs.readonly]
        @param {Boolean} [vnode.attrs.disableCurrency]
    */
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = moneyRelation.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            key: options.key,
            isCell: options.isCell,
            readonly: options.readonly,
            showCurrency: options.showCurrency,
            disableCurrency: options.disableCurrency
        });
    },
    /**
        @method view
        @param {Object} vnode Virtual node
    */
    view: function (vnode) {
        let currencyLabelStyle;
        let inputStyle;
        let amountLabelStyle;
        let displayStyle;
        let vm = this.viewModel;
        let readOnly = Boolean(
            vnode.attrs.readonly === true || vm.effective()
        );
        let theId = "A" + vm.id();

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
        if (!vm.showCurrency() && !vm.isCell()) {
            displayStyle.width = "60%";
            inputStyle.width = "100%";
            inputStyle.maxWidth = "315px";
        }

        if (vm.isCell()) {
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
            style: displayStyle,
            key: vm.key()
        }, [
            m("input", {
                style: inputStyle,
                id: theId,
                onchange: (e) => vm.amount(e.target.value),
                value: vm.amount(),
                readonly: readOnly,
                onclick: function (e) {
                    e.redraw = false;
                },
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                onfocus: vnode.attrs.onFocus,
                onblur: vnode.attrs.onBlur,
                autocomplete: "off"
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

f.catalog().register("components", "moneyRelation", moneyRelation.component);

