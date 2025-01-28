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
    @module ResourceLinkRelation
*/
const resourceLinkRelation = {};

/**
    @class ResourceLinkRelation
    @extends ViewModels.ResourceLinkRelationWidget
    @constructor
    @namespace ViewModels
    @param {Object} options Options
    @param {Object} options.parentViewModel Parent view-model. Requires
    property `relations` returning javascript object to attach relation
    view model to.
    @param {String} options.parentProperty Name of the relation
    in view model to attached to
    @param {String} options.valueProperty Value property
    @param {Object} [options.form] Form configuration
    @param {Object} [options.list] (Search) List configuration
    @param {Boolean} [options.isCell] Use style for cell in table
    @param {Object} [options.filter] Filter object used for search
*/

function find(sLabel) {

    let payload = {
        method: "POST",
        url: pathname() + "/data/resource-links",
        body: {
            filter: {
                properties: ["id"],
                limit: 1,
                showDeleted: false,
                criteria: [{
                    property: ["label"],
                    operator: "=",
                    value: sLabel
                }]
            }
        }
    };

    return m.request(payload);
}

function pathname() {
    return "/" + location.pathname.replaceAll("/", "");
}

function createLink(id, sLabel, sUrl) {
    let nowIso = new Date().toISOString();
    let payload = {
        method: "POST",
        url: pathname() + "/data/resource-link",
        body: {
            "id": id,
            "created": nowIso,
            "createdBy": "",
            "updated": nowIso,
            "updatedBy": "",
            "isDeleted": false,
            "objectType": "",
            "owner": f.currentUser().name,
            "etag": f.createId(),
            "icon": "article",
            "displayValue": sLabel,
            "label": sLabel,
            "resource": sUrl,
            "notes": ""
        }
    };
    return m.request(payload);
}

function linkFiles(vm, files) {
    let file = files[0];
    if (!file) {
        /// Handle invalid read
        return;
    }
    let prop = vm.parentViewModel().model().data[vm.parentProperty()];
    find(file.name).then(function (aL) {
        /// No current resource link with this name
        if (!aL.length) {
            let formData = new FormData();
            formData.append("name", file.name);
            formData.append("overwrite", false);
            formData.append("dataFile", file);
            let payload = {
                method: "POST",
                url: pathname() + "/do/upload",
                body: formData
            };
            m.request(payload).then(function (v) {
                if (v.status === "success") {
                    let url = location.protocol + "//" + location.hostname
                    + (
                        (location.port.length)
                        ? ":" + location.port
                        : ""
                    )
                    + "/files/upload/"
                    + file.name;
                    let fid = f.createId();
                    createLink(fid, file.name, url).then(function (o) {
                        if (o === null) {
                            console.error("Server error");
                        } else {
                            prop({
                                id: fid,
                                icon: "article",
                                resource: url,
                                displayValue: file.name,
                                label: file.name
                            });
                        }
                    });
                } else {
                    console.error("Something went boo-boo");
                }
            });
        } else {
            /// Handle overwrite case
            prop(aL[0]);
        }
    });
}

resourceLinkRelation.viewModel = function (options) {
    let vm = f.createViewModel("RelationWidget", options);
    vm.labelClass = "fb-relation-label truncate";
    // Disable upload until we create a way to direct files to a
    // persistent file server
    /*
    vm.placeholder = "Search or → drop file ←";
    /// only set dragleave to remove any effect
    vm.onDragLeave = function (evt) {
        //evt.dataTransfer.dropEffect = "none";
        evt.preventDefault();
    };
    vm.onDragEnter = function (evt) {
        //evt.dataTransfer.dropEffect = "copy";
        evt.preventDefault();
    };
    vm.onDragOver = function (evt) {
        //evt.dataTransfer.dropEffect = "copy";
        evt.preventDefault();
    };
    vm.onDrop = function (evt) {
        evt.preventDefault();
        linkFiles(vm, evt.dataTransfer.files);
    };
    */

    vm.labels = function () {
        let resource;
        let icon;
        let elements = [];
        let parentModel = options.parentViewModel.model();
        let model = parentModel.data[options.parentProperty]();

        if (model) {
            resource = (
                model.data.resource
                ? model.data.resource()
                : ""
            );
            icon = (
                model.data.icon
                ? model.data.icon()
                : ""
            );

            if (resource) {
                elements.push(
                    m("a", {
                        href: resource,
                        target: "_blank"
                    }, [
                        m("i", {
                            class: (
                                "material-icons " +
                                "fb-contact-relation-icon " +
                                "fb-icon-button"
                            )
                        }, (icon || "resource")),
                        resource
                    ])
                );
            }
        }
        return elements;
    };

    return vm;
};

f.catalog().register(
    "viewModels",
    "resourceLinkRelation",
    resourceLinkRelation.viewModel
);

f.catalog().register(
    "viewModels",
    "helpLinkRelation",
    resourceLinkRelation.viewModel
);

/**
    @class ResourceLinkRelation
    @uses Components.RelationWidget
    @namespace Components
*/
resourceLinkRelation.component = {
    oninit: function (vnode) {
        let list;
        let options = vnode.attrs;
        let relations = options.parentViewModel.relations();

        list = {
            columns: [{
                "attr": "icon"
            }, {
                "attr": "label"
            }, {
                "attr": "resource"
            }, {
                "attr": "displayValue"
            }]
        };

        options.isCell = (
            options.isCell === undefined
            ? false
            : options.isCell
        );

        // Set up viewModel if required
        if (!relations[options.parentProperty]) {
            relations[options.parentProperty] = resourceLinkRelation.viewModel({
                parentViewModel: options.parentViewModel,
                parentProperty: options.parentProperty,
                valueProperty: options.valueProperty || "displayValue",
                list: options.list || list,
                filter: options.filter,
                isCell: options.isCell,
                id: options.id,
                isReadOnly: options.isReadOnly,
                style: options.style || {}
            });
        }
        this.viewModel = relations[options.parentProperty];
    },

    view: f.getComponent("RelationWidget").view,
    labelProperty: f.prop("displayValue"),
    valueProperty: f.prop("displayValue")
};

f.catalog().register(
    "components",
    "resourceLinkRelation",
    resourceLinkRelation.component
);

f.catalog().register(
    "components",
    "helpLinkRelation",
    resourceLinkRelation.component
);
