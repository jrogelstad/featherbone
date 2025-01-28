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
/*jslint this, browser, unordered, devel*/
/*global f, m*/
/**
    @module RelationWidget
*/

const relationWidget = {};

function positionMenu(vnode) {
    let e = document.getElementById(vnode.dom.id);
    let menuRect = e.getBoundingClientRect();
    let pe = "parentElement"; // Keep short for lint;
    let tbl = e[pe][pe][pe][pe][pe][pe];
    let tblRect = tbl.getBoundingClientRect();

    // If menu spills out of table, move up and right
    if (menuRect.bottom > tblRect.bottom) {
        e.style.top = "-60px";
        e.style.right = "-155px";
    }
}

/**
    @class RelationWidget
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {Object} options.parentViewModel Parent view-model. Required
    property "relations" returning javascript object to attach relation
    view model to.
    @param {String} options.parentProperty Name of the relation
    in view model to attached to
    @param {String} options.valueProperty Value property
    @param {Object} [options.form] Form configuration
    @param {Object} [options.list] (Search) List configuration
    @param {Boolean} [options.isCell] Use style for cell in table
    @param {Filter} [options.filter] Filter object used for search
*/
relationWidget.viewModel = function (options) {
    let duplicate;
    let vm = {};
    let registerReceiver;
    let hasFocus = false;
    let parent = options.parentViewModel;
    let parentProperty = options.parentProperty;
    let valueProperty = options.valueProperty;
    let labelProperty = options.labelProperty;
    let modelValue = parent.model().data[parentProperty];
    let current = (
        modelValue()
        ? modelValue().data[valueProperty]()
        : null
    );
    let inputValue = f.prop(current);
    let type = modelValue.type;
    let criteria = (
        options.filter
        ? options.filter.criteria || []
        : []
    );
    let theFilter = {
        criteria: f.copy(criteria),
        limit: 10
    };
    let modelList;
    let configId = f.createId();
    let blurVal;
    let theProps = options.list.columns.map((l) => l.attr);
    let thefeather = options.feather || type.relation;

    if (theProps.indexOf(labelProperty) === -1) {
        theProps.unshift(labelProperty);
    }
    if (theProps.indexOf(valueProperty) === -1) {
        theProps.unshift(valueProperty);
    }

    function updateValue(prop) {
        let value = prop();
        if (value) {
            vm.value(value.data[options.valueProperty]());
        } else {
            vm.value("");
        }
    }

    // Merge user with filter dictated by model if applicable
    function mergeFilter(filter) {
        filter = f.copy(filter || {});
        let pFilter = f.copy(parent.model().data[parentProperty].filter());

        if (!filter.criteria) {
            filter.criteria = [];
        }

        if (!filter.sort) {
            if (pFilter.sort && pFilter.sort.length) {
                filter.sort = pFilter.sort;
            } else {
                filter.sort = [{
                    property: valueProperty
                }];
            }
        }
        filter.criteria = filter.criteria.concat(pFilter.criteria);
        filter.sort = (
            (filter.sort && filter.sort.length)
            ? filter.sort
            : pFilter.sort
        );
        filter.limit = filter.limit || pFilter.limit;

        return filter;
    }

    function blurFetch() {
        if (
            blurVal && !modelValue() &&
            vm.models().state().current()[0] !== "/Busy/Fetching"
        ) {
            theFilter.criteria = [{
                property: valueProperty,
                operator: "~*",
                value: "^" + blurVal
            }];
            vm.fetch().then(function (resp) {
                theFilter.criteria.length = 0;
                if (resp && resp.length) {
                    vm.onchange(blurVal);
                } else {
                    vm.onchange(null);
                }
            });
        }
    }

    modelList = f.createList(thefeather, {
        background: true,
        filter: mergeFilter(theFilter),
        fetch: false,
        isEditable: false
    });
    modelList.properties();
    modelList.fetch(mergeFilter(theFilter), false, true).then(blurFetch);

    // Make sure data changes made by biz logic in the model are
    // recognized
    parent.model().onChanged(parentProperty, updateValue);

    // Because if relation is first focus, no logical way to respond
    // to fetch
    parent.model().state().resolve("/Ready/Fetched").enter(
        updateValue.bind(null, parent.model().data[parentProperty])
    );

    /**
        Flag whether can create new records.

        @method canCreate
        @param {Boolean} id
        @return {Boolean}
    */
    vm.canCreate = f.prop(false);
    /**
        @method listId
        @param {String} id
        @return {String}
    */
    vm.listId = f.prop(f.createId());
    /**
        @method fetch
    */
    vm.fetch = function () {
        return vm.models().fetch(mergeFilter(theFilter), false, false);
    };
    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id);
    /**
        @method isCell
        @param {Boolean} flag
        @return {String}
    */
    vm.isCell = f.prop(Boolean(options.isCell));
    /**
        @property isRelationWidget
        @type Boolean
        @default true
    */
    vm.isRelationWidget = true;
    /**
        @method isReadOnly
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isReadOnly = options.isReadOnly || f.prop(false);
    /**
        @method key
        @param {String} key
        @return {String}
    */
    vm.key = f.prop(options.key);
    /**
        @method label
        @return {String}
    */
    vm.label = function () {
        let model = modelValue();
        return (
            (labelProperty && model && model.data[labelProperty])
            ? model.data[labelProperty]()
            : ""
        );
    };
    /**
        @method labelProperty
        @param {String} property
        @return {String}
    */
    vm.labelProperty = f.prop(options.labelProperty);
    /**
        @method labels
        @return {Array}
    */
    vm.labels = function () {
        return [
            m("div", {
                class: "fb-input",
                style: {
                    marginLeft: "12px",
                    marginTop: (
                        vm.label()
                        ? "6px"
                        : ""
                    )
                }
            }, vm.label())
        ];
    };
    /**
        @method model
        @return {Model}
    */
    vm.model = function () {
        return modelValue();
    };
    /**
        Array of models in selector list.
        @method models
        @return {Array}
    */
    vm.models = function () {
        return modelList;
    };
    /**
        Create new record in form.
        @method new
    */
    vm.new = function () {
        let form = options.form || {};

        m.route.set("/edit/:feather/:key", {
            feather: thefeather.toSpinalCase(),
            key: f.createId()
        }, {
            state: {
                form: form.id,
                receiver: registerReceiver(),
                create: true
            }
        });
    };
    /**
        Open selected record in form.
        @method open
    */
    vm.open = function () {
        m.route.set("/edit/:feather/:key", {
            feather: modelValue().data.objectType(),
            key: modelValue().id()
        }, {
            state: {
                receiver: registerReceiver()
            }
        });
    };
    /**
        Open searh page.
        @method search
        @param {Object} filter
    */
    vm.search = function (filter) {
        let searchList = f.copy(options.list);
        searchList.filter = filter || theFilter || searchList.filter;
        searchList.filter = mergeFilter(searchList.filter);

        f.catalog().register("config", configId, searchList);

        m.route.set("/search/:feather", {
            feather: thefeather.toSpinalCase(),
            config: configId
        }, {
            state: {
                receiver: registerReceiver()
            }
        });
    };

    /**
        Handler for auto-complete.
        @method formConfig
        @param {Any} value
    */
    vm.onchange = function (value) {
        let currentModel;
        let currentValue = false;
        let models = vm.models();
        let regexp;
        blurVal = "";

        function count(counter, model) {
            let mValue = model.data[valueProperty]();

            if (mValue === currentValue) {
                return counter + 1;
            }

            return counter;
        }

        function match(model) {
            regexp = new RegExp("^" + value.replace(/\\/g, "\\\\"), "i");
            currentValue = model.data[valueProperty]();

            if (Array.isArray(currentValue.match(regexp))) {
                currentModel = model;
                return true;
            }

            currentValue = false;
            return false;
        }

        // If multiple matches, launch search to get one exactly
        if (
            value !== null &&
            value.length && models.some(match) &&
            models.reduce(count, 0) > 1
        ) {
            duplicate = {
                criteria: [{
                    property: valueProperty,
                    value: currentValue
                }]
            };

            // Avoid mithril error when selecting from data list by
            // letting finish here, then handle search on blur event
            document.getElementById(vm.id()).blur();

            return;
        }

        if (currentValue) {
            modelValue(currentModel);
            inputValue(currentValue);
        } else {
            modelValue(null);
            inputValue(value);
            blurVal = value;
            blurFetch();
        }
    };
    /**
        Handler for onfocus event.
        @method onfocus
    */
    vm.onfocus = function () {
        let value = modelValue();

        hasFocus = true;
        value = (
            value
            ? value.data[options.valueProperty]()
            : null
        );
        inputValue(value);
    };
    /**
        Handler for blur event.
        @method onblur.
    */
    vm.onblur = function () {
        hasFocus = false;

        if (duplicate) {
            vm.search(duplicate);
        }
        duplicate = undefined;
    };
    /**
        Handler for oninput event.
        @method oninput
    */
    vm.oninput = function (value) {
        let fetch = false;
        let inputVal = inputValue() || "";

        if (
            value.length <= inputVal.length ||
            modelList.length === 10
        ) {
            fetch = true;
        }
        inputValue(value);
        if (fetch) {
            theFilter.criteria = f.copy(criteria);
            theFilter.criteria.push({
                property: valueProperty,
                operator: "~*",
                value: "^" + value
            });
            vm.fetch().then(blurFetch);
        }
    };
    /**
        Show menu on this event.
        @method onmouseovermenu
    */
    vm.onmouseovermenu = function () {
        vm.showMenu(true);
    };
    /**
        Hide menu on this event.
        @method onmouseoutmenu.
        @param {Event} event
    */
    vm.onmouseoutmenu = function (ev) {
        if (
            !ev || !ev.relatedTarget ||
            !ev.relatedTarget.id ||
            ev.relatedTarget.id.indexOf(
                "nav-relation"
            ) === -1
        ) {
            vm.showMenu(false);
        }
    };
    /**
        @method parentProperty
        @param {String} property
        @return {String}
    */
    vm.parentProperty = f.prop(options.parentProperty);
    /**
        @method parentViewModel
        @param {Object} viewModel
        @return {Object}
    */
    vm.parentViewModel = f.prop(options.parentViewModel);
    /**
        @method showMenu
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.showMenu = f.prop(false);
    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop({});
    /**
        @method formConfig
        @param {Any} value
        @return {Any}
    */
    vm.value = function (...args) {
        let result;
        let value = args[0];

        if (hasFocus || blurVal) {
            if (args.length) {
                vm.models().reset();
                result = inputValue(value);
            } else {
                result = inputValue();
            }
            return result || "";
        }

        result = modelValue();
        if (!result) {
            return "";
        }
        return result.data[valueProperty]();
    };
    /**
        @method valueProperty
        @param {String} property
        @return {String}
    */
    vm.valueProperty = f.prop(valueProperty);

    // Helper function for registering callbacks
    registerReceiver = function () {
        let receiverKey = f.createId();

        f.catalog().register("receivers", receiverKey, {
            callback: function (model) {
                modelValue(model);
                vm.showMenu(false);
            }
        });

        return receiverKey;
    };

    vm.style(options.style || {});

    f.catalog().isAuthorized({
        feather: thefeather,
        action: "canCreate",
        background: true
    }).then(vm.canCreate).catch(function (err) {
        console.error(err.message);
    });

    return vm;
};

f.catalog().register("viewModels", "relationWidget", relationWidget.viewModel);

/**
    @class RelationWidget
    @static
    @namespace Components
*/
relationWidget.component = {
    /**
        @method oninit
        @param {Object} options
        @param {Object} options.viewModel Parent view-model. Must have
        property "relations" returning javascript object to attach relation
        view model to.
        @param {String} options.parentProperty Name of the relation
        in view model to attached to
        @param {String} options.valueProperty Value property
        @param {Boolean} [options.isCell] Use style for cell in table
    */
    oninit: function (vnode) {
        let options = vnode.attrs;
        let parentProperty = options.parentProperty;
        let relations = options.parentViewModel.relations();

        // Set up viewModel if required
        if (!relations[parentProperty]) {
            relations[parentProperty] = relationWidget.viewModel({
                parentViewModel: options.parentViewModel,
                parentProperty: options.parentProperty,
                valueProperty: options.valueProperty,
                labelProperty: options.labelProperty,
                form: options.form,
                list: options.list,
                feather: options.feather,
                filter: options.filter,
                isCell: options.isCell,
                id: options.id,
                key: options.key,
                isReadOnly: options.isReadOnly,
                style: options.style
            });
        }

        this.viewModel = relations[parentProperty];
    },

    /**
        @method view
        @param {Object} Virtual nodeName
        @return {Object} View
    */
    view: function (vnode) {
        let listOptions;
        let inputStyle;
        let menuStyle;
        let maxWidth;
        let menu;
        let vm = this.viewModel;
        let readOnly = vm.isReadOnly();
        let theStyle = vm.style();
        let openMenuClass = "pure-menu-link";
        let editMenuClass = "pure-menu-link";
        let newMenuClass = "pure-menu-link";
        let buttonClass = "pure-button material-icons fb-relation-button";
        let labelClass = vm.labelClass || "fb-relation-label";
        let id = vm.id();
        menuStyle = {
            display: (
                vm.showMenu()
                ? "block"
                : "none"
            )
        };

        // Generate picker list
        listOptions = vm.models().map(function (model) {
            let content = {
                value: model.data[vm.valueProperty()]()
            };
            if (vm.labelProperty()) {
                content.label = model.data[vm.labelProperty()]();
            }
            return m("option", content);
        });

        theStyle.display = theStyle.display || "inline-block";

        if (!vm.model()) {
            openMenuClass += " pure-menu-disabled";
        }

        if (readOnly) {
            editMenuClass += " pure-menu-disabled";
            newMenuClass += " pure-menu-disabled";
        } else if (!vm.canCreate()) {
            newMenuClass += " pure-menu-disabled";
        }

        if (vm.isCell()) {
            inputStyle = {
                minWidth: "100px",
                maxWidth: "100%"
            };
            menuStyle.top = "34px";
            menuStyle.right = "-100px";
            labelClass = "fb-relation-label-cell";

            menu = m("div", {
                id: "nav-relation-div-container-" + id,
                onmouseover: vm.onmouseovermenu,
                style: {
                    position: "relative",
                    display: "inline"
                }
            }, [
                m("div", {
                    id: "nav-relation-div-menu-" + id,
                    class: (
                        "pure-menu " +
                        "custom-restricted-width " +
                        "fb-relation-menu"
                    ),
                    onmouseover: vm.onmouseovermenu,
                    onmouseout: vm.onmouseoutmenu
                }, [
                    m("span", {
                        id: "nav-relation-span-" + id,
                        class: buttonClass,
                        oncreate: function (vnode) {
                            /* Hack: Firefox refuses to use CSS to set
                               position = absolute until after dom is
                               re-rendered by some mouse over activity,
                               so forcing here.
                            */
                            document.getElementById(
                                vnode.dom.id
                            ).style.position = "absolute";
                        }
                    }, "menu"),
                    m("ul", {
                        id: "nav-relation-list-" + id,
                        class: "pure-menu-list fb-relation-menu-list",
                        style: menuStyle,
                        onupdate: positionMenu
                    }, [
                        m("li", {
                            id: "nav-relation-search-" + id,
                            class: editMenuClass,
                            onclick: (
                                editMenuClass.indexOf("disabled") === -1
                                ? function () {
                                    vm.showMenu(false);
                                    vm.search();
                                    return false;
                                }
                                : undefined
                            )
                        }, [m("i", {
                            id: "nav-relation-search-icon-" + id,
                            class: "material-icons fb-menu-list-icon"
                        }, "search")], " Search"),
                        m("li", {
                            id: "nav-relation-open-" + id,
                            class: openMenuClass,
                            onclick: (
                                openMenuClass.indexOf("disabled") === -1
                                ? function () {
                                    vm.showMenu(false);
                                    vm.open();
                                    return false;
                                }
                                : undefined
                            )
                        }, [m("i", {
                            id: "nav-relation-open-icon-" + id,
                            class: "material-icons fb-menu-list-icon"
                        }, "file_open")], " Open"),
                        m("li", {
                            id: "nav-relation-new-" + id,
                            class: newMenuClass,
                            onclick: (
                                newMenuClass.indexOf("disabled") === -1
                                ? function () {
                                    vm.showMenu(false);
                                    vm.new();
                                    return false;
                                }
                                : undefined
                            )
                        }, [m("i", {
                            id: "nav-relation-new-icon-" + id,
                            class: "material-icons fb-menu-list-icon"
                        }, "add_circle")], " New")
                    ])
                ])
            ]);
        }

        // Hack size to fit button.
        if (vm.isCell() && theStyle.maxWidth) {
            maxWidth = theStyle.maxWidth.replace("px", "");
            maxWidth = maxWidth - 35;
            maxWidth = (
                maxWidth < 100
                ? 100
                : maxWidth
            );
            inputStyle.maxWidth = maxWidth + "px";
        } else {
            theStyle.width = "60%";
            theStyle.maxWidth = "350px";
            inputStyle = {width: "100%"};
        }

        // Build the view
        return m("div", {
            style: theStyle,
            key: vm.key()
        }, [
            m("input", {
                style: inputStyle,
                list: vm.listId(),
                id: vm.id(),
                onchange: (e) => vm.onchange(e.target.value),
                onfocus: function () {
                    if (vnode.attrs.onFocus) {
                        vnode.attrs.onFocus();
                    }
                    vm.onfocus();
                },
                onblur: function () {
                    if (vnode.attrs.onBlur) {
                        vnode.attrs.onBlur();
                    }
                    vm.onblur();
                },
                oninput: (e) => vm.oninput(e.target.value),
                value: vm.value(),
                onclick: function (e) {
                    e.redraw = false;
                },
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                placeholder: vm.placeholder,
                ondrop: vm.onDrop,
                ondragover: vm.onDragOver,
                ondragenter: vm.onDragEnter,
                ondragleave: vm.onDragLeave,
                readonly: readOnly,
                autocomplete: "off"
            }),
            menu,
            m("div", {
                class: labelClass
            }, vm.labels()),
            m("datalist", {
                id: vm.listId()
            }, listOptions)
        ]);
    }
};

f.catalog().register("components", "relationWidget", relationWidget.component);
