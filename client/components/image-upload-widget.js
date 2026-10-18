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

    The box follows ddom's Import / Export drop box
    (`knowledge-transfer-page.js`): a dashed target to drop a file on,
    with a plain file input visible inside it so there is always
    something to click, rather than a box you have to guess is live
    (John, 2026-10-18: "No controls to interact... I expected more like
    that"). Either route uploads through the server's existing
    `/do/upload` (the same one `ResourceLinkRelation` posts to). What
    ddom spends on an icon this spends on the image actually in use --
    the caller's `fallbackSrc` when the property is unset, so
    "nothing chosen yet" reads as the default rather than as broken --
    and Clear reverts to that by clearing the property, rather than the
    widget having to know what a "factory default" is. A property value
    can still be a pasted web address instead of an upload; the small
    field below the box is for that, and only shows what it holds when
    the stored value actually is one (John, 2026-10-18, on the old
    always-visible text box: "I don't know what the text tells us
    anyway since we're not using a resource link anymore").

    @module ImageUploadWidget
*/
const imageUploadWidget = {};

function resolvedSrc(value, fallback) {
    value = String(value || "");

    if (!value) {
        return String(fallback || "");
    }

    return (
        value.startsWith("http")
        ? value
        : "/files/upload/" + value
    );
}

/**
    @class ImageUploadWidget
    @param {Object} options
    @param {Function} options.prop Property to read and set
    @param {String} [options.id]
    @param {String} [options.key]
    @param {String} [options.fallbackSrc] Shown while `prop` is empty
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
        Whether a drag is currently over the dropzone, for the hover
        styling.

        @method dragging
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.dragging = f.prop(false);

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
        m.redraw();

        return f.datasource().request({
            method: "POST",
            path: "/do/upload",
            body: formData
        }).then(function (resp) {
            if (resp && resp.status === "success") {
                options.prop(name);
            } else {
                console.error("Image upload failed", resp);
            }
        }).catch(
            console.error
        ).finally(function () {
            vm.busy(false);
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
        Upload whatever the visible file input was given, then forget it
        so choosing the same file twice in a row still fires `onchange`.

        @method onFileChange
        @param {Event} evt
    */
    vm.onFileChange = function (evt) {
        let input = evt.target;

        if (input.files.length) {
            vm.upload(input.files[0]);
        }

        input.value = "";
    };

    /**
        The box is a drop target and a click target both, but the file
        input inside it is its own click target: without this, clicking
        the input would also fire the box and open two pickers.

        @method onInputClick
        @param {Event} evt
    */
    vm.onInputClick = function (evt) {
        evt.stopPropagation();
    };

    /**
        @method onDragOver
        @param {Event} evt
    */
    vm.onDragOver = function (evt) {
        evt.preventDefault();
        vm.dragging(true);
    };

    /**
        @method onDragLeave
        @param {Event} evt
    */
    vm.onDragLeave = function (evt) {
        evt.preventDefault();
        vm.dragging(false);
    };

    /**
        Upload the first file off a drop, same as a file-picker choice.

        @method onDrop
        @param {Event} evt
    */
    vm.onDrop = function (evt) {
        evt.preventDefault();
        vm.dragging(false);

        if (vm.busy()) {
            return;
        }

        if (evt.dataTransfer.files.length) {
            vm.upload(evt.dataTransfer.files[0]);
        }
    };

    /**
        Revert to the fallback image by clearing the property. There is
        no separate "restore the factory default" action: an empty
        property *is* the default, everywhere this value is read.

        @method clear
    */
    vm.clear = function () {
        options.prop("");
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
        @param {String} [vnode.attrs.fallbackSrc]
        @param {Object} [vnode.attrs.style]
    */
    oninit: function (vnode) {
        let options = vnode.attrs;

        this.viewModel = imageUploadWidget.viewModel({
            prop: options.prop,
            id: options.id,
            key: options.key,
            fallbackSrc: options.fallbackSrc,
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
        let value = String(prop() || "");
        let src = resolvedSrc(value, options.fallbackSrc);
        let readonly = Boolean(options.readonly);
        let dropzoneClass = "fb-image-upload-dropzone";
        let hint;
        let urlValue = (
            value.startsWith("http")
            ? value
            : ""
        );

        if (vm.dragging()) {
            dropzoneClass += " fb-image-upload-dropzone-active";
        }

        theStyle.display = theStyle.display || "inline-block";

        if (readonly) {
            hint = (
                src
                ? ""
                : "No image"
            );
        } else {
            hint = (
                src
                ? "Drag a new image here, or"
                : "Drag an image here, or"
            );
        }

        return m("div", {
            style: theStyle,
            key: vm.key(),
            class: "fb-image-upload"
        }, [
            m("div", {
                id: vm.id(),
                class: dropzoneClass,
                title: (
                    readonly
                    ? undefined
                    : "Click, or drop an image here, to upload it"
                ),
                onclick: (
                    readonly
                    ? undefined
                    : vm.doUpload
                ),
                ondragover: (
                    readonly
                    ? undefined
                    : vm.onDragOver
                ),
                ondragleave: (
                    readonly
                    ? undefined
                    : vm.onDragLeave
                ),
                ondrop: (
                    readonly
                    ? undefined
                    : vm.onDrop
                )
            }, [
                (
                    src
                    ? m("img", {
                        src,
                        alt: "The image in use"
                    })
                    : f.icon("upload", "fb-image-upload-icon")
                ),
                (
                    hint
                    ? m("div", {
                        class: "fb-image-upload-hint"
                    }, hint)
                    : undefined
                ),
                (
                    readonly
                    ? undefined
                    : m("input", {
                        type: "file",
                        accept: "image/*",
                        class: "fb-image-upload-input",
                        disabled: vm.busy(),
                        onclick: vm.onInputClick,
                        onchange: vm.onFileChange
                    })
                ),
                (
                    vm.busy()
                    ? m("div", {
                        class: "fb-image-upload-busy"
                    }, "Uploading…")
                    : undefined
                )
            ]),
            (
                readonly
                ? undefined
                : m("div", {class: "fb-image-upload-actions"}, [
                    m("button", {
                        class: (
                            "pure-button" + (
                                value
                                ? ""
                                : " fb-button-disabled"
                            )
                        ),
                        disabled: !value,
                        title: (
                            value
                            ? "Clear the image and use the default"
                            : "Nothing to clear"
                        ),
                        onclick: vm.clear
                    }, "Clear")
                ])
            ),
            (
                readonly
                ? undefined
                : m("div", {class: "fb-image-upload-url"}, [
                    "Or paste an image address: ",
                    m("input", {
                        type: "text",
                        class: "fb-input",
                        value: urlValue,
                        onchange: (e) => prop(e.target.value)
                    })
                ])
            )
        ]);
    }
};

f.catalog().register(
    "components",
    "imageUploadWidget",
    imageUploadWidget.component
);
