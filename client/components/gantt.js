/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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

/*jslint this, browser*/
/**
    @module Gantt
*/
import f from "../core.js";

const Gantt = window.Gantt;
const catalog = f.catalog();
const gantt = {};
const m = window.m;

/**
    Generate view model for checkbox.

    @class Gantt
    @constructor
    @namespace ViewModels
    @param {Object} [options] Options
    @param {String} [options.id] Id
*/
gantt.viewModel = function (options) {
    let vm = {};

    vm.chart = f.prop();
    vm.id = f.prop(options.id || f.createId());
    vm.showDetail = f.prop(true);
    vm.showLinks = f.prop(true);
    vm.viewMode = f.prop("week");

    return vm;
};

/**
    Gantt component

    @class Gantt
    @static
    @namespace Components
*/
gantt.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {Object} options.viewModel Parent view-model. Must have
        property "model" returning data model with parent property.
        @param {String} options.parentProperty Name of the relation
        in view model to attached to
    */
    oninit: function (vnode) {
        this.viewModel = gantt.viewModel(vnode.attrs);
        this.viewModel.data = vnode.attrs.parentViewModel.model().data[
            vnode.attrs.parentProperty
        ];
    },

    onupdate: function () {
        let vm = this.viewModel;
        let id = "gantt" + vm.id();
        let e = document.getElementById(id);
        let chart = vm.chart();
        let data = vm.data().slice();

        if (!vm.showDetail()) {
            data = data.filter((d) => Boolean(d.type));
        }

        if (chart) {
            chart.options.viewMode = vm.viewMode();
            chart.options.showLinks = vm.showLinks();
            chart.data = data;
            chart.render();
        } else if (data.length && !chart) {
            chart = new Gantt.SVGGantt(
                e,
                data,
                {
                    viewMode: vm.viewMode(),
                    showLinks: vm.showLinks(),
                    onClick: function (item) {
                        if (item.feather && item.key) {
                            m.route.set("/edit/:feather/:key", {
                                feather: item.feather,
                                key: item.key
                            }, {});
                        }
                    }
                }
            );
            this.viewModel.chart(chart);
            chart.render();
        }
    },

    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;
        let id = vm.id();
        let cb = f.getComponent("checkbox");

        return m("div", {
            id: "gantt-cont" + id,
            key: "gantt-cont" + id
        }, [
            m("div", {
                id: "gantt-sel-div" + id,
                key: "gant-sel-div" + id,
                style: {
                    paddingBottom: "20px"
                }
            }, [
                m("label", {
                    id: "gantt-sel-label" + id,
                    key: "gantt-sel-label" + id,
                    for: "gantt-sel"
                }, "View mode:"),
                m("select", {
                    id: "gantt-sel" + id,
                    key: "gantt-sel" + id,
                    value: vm.viewMode(),
                    onchange: (e) => vm.viewMode(e.target.value)
                }, [
                    m("option", {
                        value: "day",
                        label: "Day"
                    }),
                    m("option", {
                        value: "week",
                        label: "Week"
                    }),
                    m("option", {
                        value: "month",
                        label: "Month"
                    })
                ], "week"),
                m("label", {
                    id: "gantt-detail-lb" + id,
                    key: "gantt-detail-lb" + id,
                    for: "gantt-detail-cb" + id
                }, "Show detail"),
                m(cb, {
                    id: "gantt-detail-cb" + id,
                    key: "gantt-detail-cb" + id,
                    onclick: (e) => vm.showDetail(e),
                    value: vm.showDetail()
                }),
                m("label", {
                    id: "gantt-links-lb" + id,
                    key: "gantt-links-lb" + id,
                    for: "gantt-links-cb" + id
                }, "Show links"),
                m(cb, {
                    id: "gantt-links-cb" + id,
                    key: "gantt-links-cb" + id,
                    onclick: (e) => vm.showLinks(e),
                    value: vm.showLinks()
                })
            ]),
            m("div", {
                id: "gantt" + id,
                key: "gantt" + id
            })
        ]);
    }
};

catalog.register("components", "gantt", gantt.component);

export default Object.freeze(gantt);
