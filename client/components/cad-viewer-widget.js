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
/*global f, m, CadViewer, occtimportjs*/
/**
    Draws a CadModel's `model` property with three-cad-viewer, and takes
    a STEP, STL or three-cad-viewer .json file dropped on it (or chosen
    from its file input) in place of what is there.

    The viewer (1.4 MB) and the STEP reader (7.6 MB of WebAssembly) are
    fetched when a CadModel is first opened, not with the client, so
    every other page costs what it did before. Files are read in the
    browser; the server only ever receives the shapes tree, which is
    what the record holds, and the original file when the instance takes
    uploads, named in `source`.

    Importing sets the sibling properties it can know from the file: the
    label when it is still empty, `source`, and `units` only when the
    person says so (a STEP file is in millimeters unless its header says
    otherwise, and a header is not something to guess at).

    @module CadViewerWidget
*/
const cadViewerWidget = {};

const VIEWER_JS = "/node_modules/three-cad-viewer/dist/three-cad-viewer.min.js";
const VIEWER_CSS = "/node_modules/three-cad-viewer/dist/three-cad-viewer.css";
const OCCT_JS = "/node_modules/occt-import-js/dist/occt-import-js.js";
const OCCT_WASM = "/node_modules/occt-import-js/dist/occt-import-js.wasm";
const PENDING = {};
const READERS = {
    brep: "ReadBrepFile",
    iges: "ReadIgesFile",
    step: "ReadStepFile"
};

/*
    Load a script or stylesheet once, however many widgets ask for it.
*/
function load(url, isStyle) {
    if (!PENDING[url]) {
        PENDING[url] = new Promise(function (resolve, reject) {
            let el = document.createElement(
                isStyle
                ? "link"
                : "script"
            );

            if (isStyle) {
                el.rel = "stylesheet";
                el.href = url;
            } else {
                el.src = url;
            }
            el.onload = resolve;
            el.onerror = function () {
                delete PENDING[url];
                reject(new Error("Could not load " + url));
            };
            document.head.appendChild(el);
        });
    }

    return PENDING[url];
}

cadViewerWidget.loadViewer = function () {
    return Promise.all([
        load(VIEWER_CSS, true),
        load(VIEWER_JS)
    ]);
};

cadViewerWidget.loadReader = function () {
    if (!PENDING.occt) {
        PENDING.occt = load(OCCT_JS).then(function () {
            return occtimportjs({locateFile: () => OCCT_WASM});
        }).catch(function (err) {
            delete PENDING.occt;
            throw err;
        });
    }

    return PENDING.occt;
};

/**
    Turn the bytes of a dropped file into a shapes tree.

    @method read
    @param {File} file
    @return {Promise} Shapes tree
*/
cadViewerWidget.read = async function (file) {
    let found = f.cad.kindOf(file.name);
    let kind = found.kind;
    let data;
    let occt;
    let result;

    if (found.message) {
        throw new Error(found.message);
    }
    if (kind === "json") {
        return f.cad.fromShapes(await file.text());
    }

    data = new Uint8Array(await file.arrayBuffer());
    if (kind === "stl") {
        return f.cad.fromStl(data, file.name);
    }

    occt = await cadViewerWidget.loadReader();
    result = occt[READERS[kind]](data, null);

    return f.cad.fromOcct(result, file.name);
};

/**
    @class CadViewerWidget
    @param {Object} options
    @param {Function} options.prop The `model` property
    @param {Object} options.model The CadModel, to set label and source
    @param {Boolean} [options.readonly]
    @param {String} [options.id]
    @param {String} [options.key]
    @param {Object} [options.style]
*/
cadViewerWidget.viewModel = function (options) {
    let vm = {};
    let viewer;
    let shown;
    let parsedText;
    let parsed;
    let parseError = "";

    vm.busy = f.prop(false);
    vm.dragging = f.prop(false);
    vm.error = f.prop("");
    /**
        The shapes tree the property holds as text, parsed once for as
        long as the text stays the same.

        @method tree
        @return {Object|undefined}
    */
    vm.tree = function () {
        let text = options.prop();

        if (text !== parsedText) {
            parsedText = text;
            parsed = undefined;
            parseError = "";
            try {
                parsed = f.cad.fromText(text);
            } catch (err) {
                parseError = (
                    "The model held here cannot be read: " + err.message
                );
            }
        }

        return parsed;
    };

    vm.parseError = () => parseError;

    vm.id = f.prop(options.id || f.createId());
    vm.key = f.prop(options.key || f.createId());
    vm.style = f.prop(options.style || {});

    /**
        Set a sibling property on the record, if it has one.

        @method setSibling
        @param {String} name
        @param {Any} value
    */
    function setSibling(name, value) {
        let model = options.model;
        let data = (
            (model && model.data)
            ? model.data
            : {}
        );

        if (typeof data[name] === "function") {
            data[name](value);
        }
    }

    /**
        A model links to itself. The server's trigger fills `resource`
        in too, but the form refuses to save a record whose required
        `resource` is empty before the server is asked, so a new record
        takes its link here, from the id it already holds.

        @method linkToSelf
    */
    function linkToSelf() {
        let data = (
            (options.model && options.model.data)
            ? options.model.data
            : {}
        );

        if (
            typeof data.resource === "function" &&
            typeof data.id === "function" &&
            !data.resource() && data.id()
        ) {
            data.resource("#!/edit/cad_model/" + data.id());
        }
    }

    linkToSelf();

    /**
        Read a file, and make what it holds the record's model.

        @method importFile
        @param {File} file
    */
    vm.importFile = async function (file) {
        let tree;
        let label;
        let data = (
            (options.model && options.model.data)
            ? options.model.data
            : {}
        );

        vm.busy(true);
        vm.error("");
        m.redraw();
        try {
            tree = await cadViewerWidget.read(file);
            options.prop(f.cad.toText(tree));
            label = file.name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
            if (typeof data.label === "function" && !data.label()) {
                setSibling("label", label);
            }
            setSibling("source", file.name);
        } catch (err) {
            vm.error(err.message || String(err));
        } finally {
            vm.busy(false);
            m.redraw();
        }
    };

    /**
        Draw the model, or clear the canvas when there is none. Called
        after every redraw; it only does work when the model changed.

        @method draw
        @param {HTMLElement} el The element the viewer lives in
    */
    vm.draw = async function (el) {
        let text = options.prop();
        let tree;
        let box;

        if (text === shown || !el) {
            return;
        }
        shown = text;
        tree = vm.tree();
        if (viewer) {
            try {
                viewer.dispose();
            } catch (ignore) {
                // A viewer that cannot clear is replaced below
            }
            viewer = undefined;
            el.innerHTML = "";
        }
        if (!tree || !tree.parts) {
            return;
        }

        try {
            await cadViewerWidget.loadViewer();
        } catch (err) {
            vm.error(err.message);
            m.redraw();
            return;
        }
        if (shown !== text) {
            return; // Replaced while the viewer was loading
        }

        box = el.getBoundingClientRect();
        viewer = new CadViewer.Viewer(
            new CadViewer.Display(el, {
                cadWidth: Math.max(480, Math.floor(box.width - 260)),
                height: 520,
                treeWidth: 240,
                theme: "light",
                pinning: false
            }),
            {up: "Z"},
            () => undefined
        );
        try {
            viewer.render(tree, {
                ambientIntensity: 1.0,
                directIntensity: 1.1,
                metalness: 0.3,
                roughness: 0.65,
                edgeColor: 0x707070,
                defaultOpacity: 0.5,
                normalLen: 0
            }, {up: "Z"});
        } catch (err) {
            vm.error("This model could not be drawn: " + err.message);
            m.redraw();
        }
    };

    /**
        @method destroy
    */
    vm.destroy = function () {
        if (viewer) {
            try {
                viewer.dispose();
            } catch (ignore) {
                // Going away anyway
            }
        }
        viewer = undefined;
        shown = undefined;
    };

    vm.onFileChange = function (evt) {
        let input = evt.target;

        if (input.files.length) {
            vm.importFile(input.files[0]);
        }
        input.value = "";
    };

    vm.onInputClick = (evt) => evt.stopPropagation();

    vm.onDragOver = function (evt) {
        evt.preventDefault();
        vm.dragging(true);
    };

    vm.onDragLeave = function (evt) {
        evt.preventDefault();
        vm.dragging(false);
    };

    vm.onDrop = function (evt) {
        evt.preventDefault();
        vm.dragging(false);
        if (!vm.busy() && evt.dataTransfer.files.length) {
            vm.importFile(evt.dataTransfer.files[0]);
        }
    };

    return vm;
};

/**
    CadViewerWidget component

    @class CadViewerWidget
    @static
    @namespace Components
*/
cadViewerWidget.component = {
    oninit: function (vnode) {
        this.viewModel = cadViewerWidget.viewModel(vnode.attrs);
    },

    onremove: function () {
        this.viewModel.destroy();
    },

    view: function (vnode) {
        let vm = this.viewModel;
        let readonly = vnode.attrs.readonly === true;
        let tree = vm.tree();
        let summary = (
            (tree && tree.parts)
            ? f.cad.summarize(tree)
            : undefined
        );

        return m("div", {
            id: vm.id(),
            class: "fb-cad-viewer",
            style: Object.assign({width: "100%"}, vm.style())
        }, [
            m("div", {
                class: "fb-cad-viewer-canvas",
                style: {
                    minHeight: (
                        summary
                        ? "520px"
                        : "0"
                    ),
                    position: "relative"
                },
                oncreate: (v) => vm.draw(v.dom),
                onupdate: (v) => vm.draw(v.dom)
            }),
            (
                summary
                ? m("div", {class: "fb-cad-viewer-summary"}, (
                    summary.parts + (
                        summary.parts === 1
                        ? " part, "
                        : " parts, "
                    ) + summary.triangles.toLocaleString() + " triangles"
                ))
                : m("div", {class: "fb-cad-viewer-summary"}, (
                    readonly
                    ? "No model has been imported yet"
                    : "No model yet. Drop a STEP file below."
                ))
            ),
            (
                (vm.error() || vm.parseError())
                ? m("div", {
                    class: "fb-cad-viewer-error",
                    style: {color: "firebrick"}
                }, vm.error() || vm.parseError())
                : undefined
            ),
            (
                readonly
                ? undefined
                : m("div", {
                    class: (
                        vm.dragging()
                        ? "fb-image-upload-box fb-dragging"
                        : "fb-image-upload-box"
                    ),
                    style: {
                        border: "2px dashed #999",
                        padding: "12px",
                        margin: "8px 0"
                    },
                    ondragover: vm.onDragOver,
                    ondragleave: vm.onDragLeave,
                    ondrop: vm.onDrop
                }, [
                    m("div", (
                        vm.busy()
                        ? "Reading the file..."
                        : (
                            "Drop a STEP, STL or three-cad-viewer .json " +
                            "file here, or choose one:"
                        )
                    )),
                    m("input", {
                        type: "file",
                        accept: ".step,.stp,.iges,.igs,.brep,.stl,.json",
                        disabled: vm.busy(),
                        onclick: vm.onInputClick,
                        onchange: vm.onFileChange
                    })
                ])
            )
        ]);
    }
};

f.catalog().register(
    "components",
    "cadViewerWidget",
    cadViewerWidget.component
);
