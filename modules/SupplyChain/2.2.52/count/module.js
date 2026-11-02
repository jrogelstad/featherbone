/*jslint devel browser unordered*/
/*global printJS*/
const catalog = f.catalog();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;

/**
    Physical Count
*/
function physCount(data, feather) {
    feather = feather || catalog.getFeather("PhysicalCount");
    let model = f.createModel(data, feather);
    let d = model.data;

    function renumber() {
        let nr = 0;

        d.tags().forEach(function (row) {
            let curr = row.data.number();
            if (curr !== 0) {
                if (curr > nr) {
                    nr = curr;
                }
            } else {
                nr += 1;
                row.data.number.state().send("silence");
                row.data.number(nr);
                row.data.number.state().send("report");
                row.data.number.isReadOnly(false);
            }
        });
    }

    model.onChanged("tags", renumber);
    model.onChanged("tags.number", renumber);
    model.onValidate(function () {
        if (!d.tags) {
            return;
        }

        let chkd = [];
        let locCtrl = d.site().data.locationControlled();

        d.tags().forEach(function (tag) {
            let found = chkd.find(function (chk) {
                let match = tag.data.item().id() === chk.data.item().id();

                if (match && locCtrl) {
                    match = (
                        tag.data.location() &&
                        chk.data.location() &&
                        tag.data.location().id() === chk.data.location().id()
                    );
                }

                if (match && tag.data.item().data.trace() !== "N") {
                    match = (
                        tag.data.traceNumber() &&
                        chk.data.traceNumber() &&
                        tag.data.traceNumber().id() ===
                        chk.data.traceNumber().id()
                    );
                }

                return match;
            });

            if (found) {
                throw (
                    "Tag " + tag.data.number() +
                    " is a duplicate of tag " +
                    found.data.number()
                );
            }
            chkd.push(tag);
        });
    });

    model.onLoad(function () {
        if (!d.isActive()) {
            model.isReadOnly(true);
            model.state().send("freeze");
        }
    });

    // Need to rework tag logic to deal with before
    //on hand and costs before we can allow adding misc tags
    if (d.tags) {
        d.tags().canAdd(false);
    }

    return model;
}

catalog.registerModel("PhysicalCount", physCount);

function printPdf(doc) {
    let url = (
        window.location.protocol + "//" +
        window.location.hostname + ":" +
        window.location.port +
        location.pathname +
        "pdf/" + doc
    );
    printJS(url);
}

function doPrint(viewModel, type, url) {
    let dialog = viewModel.confirmDialog();
    let models = viewModel.selections();
    let countSettings = catalog.store().models().countSettings();
    let form = countSettings.data[type + "Form"]();
    let payload;

    if (!form) {
        error(dialog, {message: (
            "Form name for " + type + " form " +
            "must be defined in settings."
        )});
        return;
    }

    payload = {
        method: "POST",
        path: url,
        body: {
            ids: models.map((i) => i.id()),
            form: form.data.name()
        }
    };

    f.datasource().request(
        payload
    ).then(
        printPdf
    ).catch(function (resp) {
        error(dialog, resp);
    });
}
physCount.static().printCount = function (viewModel) {
    doPrint(viewModel, "count", "/do/print-pdf/form/");
};

physCount.static().printRecount = function (viewModel) {
    doPrint(viewModel, "recount", "/count/print-recount/");
};

physCount.static().checkPrint = function (selections) {
    return (
        selections.length === 1 &&
        selections[0].data.isActive()
    );
};

/* Create tag count logic */
const countOpts = Object.freeze({
    name: "PhysicalCountOptions",
    description: "Physical count dialog options",
    isSystem: true,
    properties: {
        site: {
            description: "Site",
            type: {
                relation: "Site",
                properties: [
                    "code",
                    "description"
                ]
            },
            isRequired: true
        },
        description: {
            description: "Count description",
            type: "string"
        },
        startTagNr: {
            description: "Starting tag number",
            type: "integer",
            default: 1,
            alias: "Start Tag #"
        },
        abcClass: {
            description: "ABC Class",
            type: "string",
            default: "",
            alias: "ABC Class",
            dataList: ["", "A", "B", "C"]
        },
        item: {
            description: "Item",
            type: {
                relation: "Item",
                properties: [
                    "number",
                    "description"
                ]
            }
        },
        category: {
            description: "Item category",
            type: {
                relation: "ItemCategory",
                properties: [
                    "code",
                    "description"
                ]
            }
        },
        group: {
            description: "Item group",
            type: {
                relation: "ItemGroup",
                properties: [
                    "code",
                    "description"
                ]
            }
        },
        fromLocation: {
            description: "From location",
            alias: "Location",
            type: {
                relation: "Location",
                properties: [
                    "name",
                    "description"
                ]
            }
        },
        useLocationRange: {
            description: "Has location range",
            type: "boolean",
            default: false
        },
        toLocation: {
            description: "To location",
            type: {
                relation: "Location",
                properties: [
                    "name",
                    "description"
                ]
            },
            isReadOnly: true
        },
        useDays: {
            description: "Use days since last count",
            type: "boolean",
            default: false
        },
        days: {
            alias: "Days Since Count",
            description: "Minimum days since last count",
            type: "integer",
            isReadOnly: true
        },
        useMax: {
            description: "Limit maximim count tags",
            type: "boolean",
            default: false
        },
        max: {
            alias: "Maximum Tags",
            description: "Maximum count tags",
            type: "integer",
            isReadOnly: true
        },
        hasQuantity: {
            description: "Only include inventory with non zero quantities",
            type: "boolean",
            default: true
        }
    }
});

catalog.register("feathers", "PhysicalCountOptions", countOpts);
catalog.registerModel("PhysicalCountOptions", function () {
    let feather = catalog.getFeather("PhysicalCountOptions");
    let model = f.createModel({}, feather);
    let d = model.data;

    function handleReadOnly() {
        d.days.isReadOnly(!d.useDays());
        d.toLocation.isReadOnly(!d.useLocationRange());
        d.max.isReadOnly(!d.useMax());

        if (d.useLocationRange()) {
            d.fromLocation.alias("From Location");
        } else {
            d.fromLocation.alias("Location");
        }
    }

    model.onChanged("useDays", handleReadOnly);
    model.onChanged("useLocationRange", handleReadOnly);
    model.onChanged("useMax", handleReadOnly);

    model.onValidate(function () {
        if (d.useLocationRange() && (
            !d.fromLocation() || !d.toLocation()
        )) {
            throw "From and to locations must be selected";
        }

        if (d.useDays() && d.days() <= 0) {
            throw "Days must be greater than 0";
        }

        if (d.useMax() && d.max() <= 0) {
            throw "Maximum tags must be greater than 0";
        }
    });

    return model;
});

const form = {
    tabs: [{
        name: "General"
    }, {
        name: "Items"
    }, {
        name: "Locations"
    }, {
        name: "Limits"
    }],
    attrs: [{
        attr: "site",
        grid: 1
    }, {
        attr: "description",
        grid: 1
    }, {
        attr: "hasQuantity",
        grid: 1
    }, {
        attr: "startTagNr",
        grid: 1
    }, {
        attr: "abcClass",
        grid: 2
    }, {
        attr: "item",
        grid: 2
    }, {
        attr: "category",
        grid: 2
    }, {
        attr: "group",
        grid: 2
    }, {
        attr: "fromLocation",
        grid: 3
    }, {
        attr: "useLocationRange",
        grid: 3
    }, {
        attr: "toLocation",
        grid: 3
    }, {
        attr: "useDays",
        grid: 4
    }, {
        attr: "days",
        grid: 4
    }, {
        attr: "useMax",
        grid: 4
    }, {
        attr: "max",
        grid: 4
    }]
};

physCount.static().create = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let theModel = f.createModel("PhysicalCountOptions");
    let vm = f.createViewModel("FormWidget", {
        config: form,
        containerId: dialog.ids().dialog,
        id: f.createId(),
        isScrollable: false,
        model: theModel,
        outsideElementIds: [
            dialog.ids().header,
            dialog.ids().buttonOk
        ],
        style: {minHeight: "260px"}
    });
    let widget = f.getComponent("FormWidget");

    function onOk() {
        let theBody = theModel.toJSON();
        let payload = {
            method: "POST",
            path: "/count/create-physical-count/",
            body: theBody
        };

        return f.datasource().request(
            payload
        ).then(function (resp) {
            viewModel.refresh();
            success(dialog, resp);
        }).catch(
            error.bind(null, dialog)
        );
    }

    dialog.content = function () {
        return m(widget, {
            viewModel: vm
        });
    };

    dialog.title("Create Count");
    dialog.icon("queue");
    dialog.onOk(onOk);
    dialog.style({width: "500px"});
    dialog.buttonOk().label("Create");
    dialog.buttonOk().isDisabled = function () {
        return !vm.model().canSave();
    };
    dialog.buttonOk().title = function () {
        if (!vm.model().canSave()) {
            return vm.model().lastError();
        }
        return "Create Physical Count";
    };
    dialog.show();
};

physCount.static().post = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let model = viewModel.selections().find(
        (sel) => sel.data.isActive()
    );
    let payload = {
        method: "POST",
        path: "/count/post-physical-count/",
        body: {id: model.id()}
    };

    return f.datasource().request(
        payload
    ).then(
        success.bind(null, dialog)
    ).catch(
        error.bind(null, dialog)
    );
};

physCount.static().checkPost = function (selections) {
    return selections.some((sel) => sel.data.isActive());
};

/**
    Physical Count Tag
*/
function physCountTag(data, feather) {
    feather = feather || catalog.getFeather("PhysicalCountTag");
    let model = f.createModel(data, feather);
    let d = model.data;
    let icon = "radio_button_unchecked";

    function calcValues() {
        let cost = d.item().data.cost.toJSON().amount;
        let newVal = f.copy(d.oldValue.toJSON());
        let valChg = f.copy(d.valueChange.toJSON());
        let qty = (
            d.isRecount()
            ? d.recount.toJSON()
            : d.count.toJSON()
        );
        let qtyChg = qty.minus(d.oldQuantity.toJSON());

        newVal.amount = qty.times(cost);
        valChg.amount = newVal.amount.minus(
            d.oldValue.toJSON().amount
        );
        d.newQuantity(qty);
        d.quantityChange(qtyChg);
        d.newValue(newVal);
        d.valueChange(valChg);
    }

    function calcStatus() {
        let style = "HIGH";
        let title = "Waiting for count";

        if (d.isComplete()) {
            icon = "check_circle";
            title = "Count complete";
            style = "";
        } else if (d.isRecount() && (
            d.recount.toJSON() !== 0 ||
            (
                d.oldQuantity.toJSON() === 0 &&
                d.recount.toJSON() !== d.oldQuantity.toJSON()
            )
        )) {
            icon = "add_task";
            title = "Recount entered";
        } else if (d.isRecount()) {
            icon = "published_with_changes";
            title = "Waiting for recount";
        } else if (
            d.count.toJSON() !== 0 ||
            (
                d.oldQuantity.toJSON() === 0 &&
                d.count.toJSON() !== d.oldQuantity.toJSON()
            )
        ) {
            icon = "check_circle_outline";
            title = "Count entered";
        } else {
            icon = "radio_button_unchecked";
        }

        d.countStatusIcon.title(title);
        d.countStatusIcon.style(style);
    }

    model.addCalculated({
        name: "countStatusIcon",
        type: "string",
        format: "icon",
        function: () => icon
    });

    function handleReadOnly() {
        let prt = model.parent();
        let itm = d.item();
        let isCmplt = d.isComplete();

        d.location.isReadOnly(
            !prt || !prt.data.site() ||
            !prt.data.site().data.locationControlled() || isCmplt
        );
        d.location.isRequired(
            prt && prt.data.site() &&
            prt.data.site().data.locationControlled() &&
            d.newQuantity.toJSON()
        );
        d.traceNumber.isReadOnly(!itm || itm.data.trace() === "N" || isCmplt);
        d.recount.isReadOnly(!d.isRecount() || d.isComplete());
        d.isComplete.isReadOnly(!d.item());
        d.item.isReadOnly(isCmplt);
        d.count.isReadOnly(isCmplt);
        d.isRecount.isReadOnly(isCmplt);
    }

    model.onLoad(handleReadOnly);
    model.onLoad(calcStatus);
    model.onChanged("count", calcValues);
    model.onChanged("count", calcStatus);
    model.onChanged("count", handleReadOnly);
    model.onChanged("recount", calcValues);
    model.onChanged("recount", calcStatus);
    model.onChanged("recount", handleReadOnly);
    model.onChanged("isRecount", calcStatus);
    model.onChanged("isComplete", calcStatus);
    model.onChanged("item", handleReadOnly);
    model.onChanged("isRecount", handleReadOnly);
    model.onChanged("isRecount", function () {
        if (!d.isRecount()) {
            d.recount(0);
        }
    });
    model.onChanged("isComplete", handleReadOnly);

    model.onValidate(function () {
        if (
            d.item().data.trace() === "S" &&
            (
                d.newQuantity.toJSON() !== 0 &&
                d.newQuantity.toJSON() !== 1
            )
        ) {
            throw (
                "Serial controlled items may only have quantity of zero or one"
            );
        }
    });
    handleReadOnly();

    d.item.filter().criteria.push({
        property: "status",
        value: "A"
    });

    return model;
}

physCountTag.calculated = f.prop({
    countStatusIcon: {
        type: "string",
        description: "Count tag status indicator",
        format: "icon"
    }
});

catalog.registerModel("PhysicalCountTag", physCountTag);
