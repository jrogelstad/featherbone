/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
/*jslint this, browser, unordered*/
/*global f, m*/
/**
    A property is this format when its value is a pointer to an image --
    a URL, or the name of a file this server is holding -- rather than a
    relation. `logo` is the first of these (John, 2026-10-18: "Let's just
    disassociate logo from resource link altogether. Let people simply
    upload their own logo and point to that.").

    The text box still takes a pasted URL. The button is the shortcut:
    it uploads the chosen file through the server's existing `/do/upload`
    (the same one `ResourceLinkRelation` posts to) and points the
    property at the name it was given, with a short random prefix so one
    user's "logo.png" never collides with another's.

    @module ImageUploadWidget
*/
const imageUploadWidget = {};

function preview(where) {
    let src = String(where || "");

    if (!src) {
        return;
    }

    if (!src.startsWith("http")) {
        src = "/files/upload/" + src;
    }

    return m("img", {
        src,
        class: "fb-image-upload-preview",
        title: where
    });
}

/**
    @class ImageUploadWidget
    @param {Object} options
    @param {Function} options.prop Property to read and set
    @param {String} [options.id]
    @param {String} [options.key]
    @param {Object} [options.style]
*/
imageUploadWidget.viewModel = function (options) {
    let vm = {};

    /**
        @method busy
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.busy = f.prop(false);

    /**
        @method buttonUpload
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonUpload = f.prop();

    /**
        Send the chosen file to the server and, once it lands, point the
        property at it.

        @method upload
        @param {File} file
    */
    vm.upload = function (file) {
        let name = f.createId().slice(0, 8) + "-" + file.name;
        let formData = new FormData();

        formData.append("dataFile", file, name);
        vm.busy(true);
        vm.buttonUpload().title("Uploading...");

        return f.datasource().request({
            method: "POST",
            path: "/do/upload",
            body: formData
        }).then(function (resp) {
            if (resp && resp.status === "success") {
                options.prop(name);
            } else {
                console.error("Logo upload failed", resp);
            }
        }).catch(
            console.error
        ).finally(function () {
            vm.busy(false);
            vm.buttonUpload().title("Upload an image from this computer");
            m.redraw();
        });
    };

    /**
        Open a file picker and upload whatever comes back.

        @method doUpload
    */
    vm.doUpload = function () {
        let input;

        if (vm.busy()) {
            return;
        }

        input = document.createElement("input");
        input.setAttribute("type", "file");
        input.setAttribute("accept", "image/*");
        input.onchange = function () {
            if (input.files.length) {
                vm.upload(input.files[0]);
            }
        };
        input.click();
    };

    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id || f.createId());

    /**
        @method key
        @param {String} key
        @return {String}
    */
    vm.key = f.prop(options.key || f.createId());

    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop(options.style || {});

    // ..........................................................
    // PRIVATE
    //

    vm.buttonUpload(f.createViewModel("Button", {
        onclick: vm.doUpload,
        title: "Upload an image from this computer",
        icon: "upload",
        class: "fb-data-type-edit-button"
    }));

    return vm;
};

/**
    ImageUploadWidget component

    @class ImageUploadWidget
    @static
    @namespace Components
*/
imageUploadWidget.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Function} vnode.attrs.prop
        @param {String} [vnode.attrs.id]
        @param {String} [vnode.attrs.key]
        @param {Boolean} [vnode.attrs.readonly]
        @param {Object} [vnode.attrs.style]
    */
    oninit: function (vnode) {
        let options = vnode.attrs;

        this.viewModel = imageUploadWidget.viewModel({
            prop: options.prop,
            id: options.id,
            key: options.key,
            style: options.style
        });
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} View
    */
    view: function (vnode) {
        let options = vnode.attrs;
        let vm = this.viewModel;
        let theStyle = vm.style();
        let prop = options.prop;
        let opts = {
            readonly: options.readonly,
            id: vm.id(),
            required: options.required,
            type: "text",
            onchange: (e) => prop(e.target.value),
            oncreate: options.onCreate,
            onremove: options.onRemove,
            value: prop()
        };

        opts.class = (
            opts.class
            ? "fb-input " + opts.class
            : "fb-input"
        );

        theStyle.display = theStyle.display || "inline-block";

        return m("div", {
            style: theStyle,
            key: vm.key()
        }, [
            preview(prop()),
            m("input", opts),
            (
                options.readonly
                ? undefined
                : m(f.getComponent("Button"), {
                    viewModel: vm.buttonUpload()
                })
            )
        ]);
    }
};

f.catalog().register(
    "components",
    "imageUploadWidget",
    imageUploadWidget.component
);
