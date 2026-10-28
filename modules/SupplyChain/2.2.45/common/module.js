/*jslint devel browser this unordered for*/
/*global printJS atob Blob*/

const catalog = f.catalog();
const store = catalog.store();
const models = store.models();
const datasource = f.datasource();

function success(msg, msgold) {
    return new Promise(function (resolve) {
        // Old API passed dialog
        if (typeof msg !== "string") {
            msg = msgold;
        }
        f.notify(msg || "Success");
        resolve();
    });
}
catalog.register("functions", "success", success);

function error(err, errold) {
    return new Promise(function (resolve) {
        // Old API passed dialog
        if (err.toLocaleString() === "[object Object]") {
            err = errold;
        } else if (typeof err === "string") {
            err = new Error(err);
        }
        f.notify("Error: " + err.message, {
            icon: "warning",
            iconColor: "orange"
        });
        resolve();
    });
}
catalog.register("functions", "error", error);

/**
    Alert
*/
function alert(data, feather) {
    feather = feather || catalog.getFeather("Alert");
    let model = f.createModel(data, feather);
    let d = model.data;

    model.addCalculated({
        name: "severityIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.severity()) {
            case "Critical":
                return "error";
            case "Warning":
                return "report_problem";
            default:
                return "info";
            }
        }
    });

    d.severityIcon.style = function () {
        switch (d.severity()) {
        case "Critical":
            return "ALERT-CRITICAL";
        case "Warning":
            return "ALERT-WARNING";
        default:
            return "EMPHASIS";
        }
    };

    d.severityIcon.title = () => d.severity();

    model.addCalculated({
        function: function () {
            if (d.relation()) {
                return {data: {
                    id: () => d.relation().id,
                    code: () => d.relation().code,
                    objectType: () => d.relation().objectType
                }, id: () => d.relation().id};
            }
        },
        name: "document",
        type: {
            relation: "Kind",
            properties: [
                "id",
                "code",
                "objectType"
            ]
        }
    });

    return model;
}

alert.calculated = f.prop({
    document: {
        description: "Link to alert source document",
        type: {
            relation: "Demand",
            properties: [
                "id",
                "number"
            ]
        }
    },
    severityIcon: {
        type: "string",
        description: "Severity indicator",
        format: "icon"
    }
});

catalog.registerModel("Alert", alert);

/**
    Server Process
*/
function sp(data, feather) {
    feather = feather || catalog.getFeather("Alert");
    let model = f.createModel(data, feather);
    let d = model.data;
    let icon = "info";

    model.onLoad(function () {
        if (d.status() === "P") {
            icon = "play_circle";
            d.statusIcon.style("EMPHASIS");
            d.statusIcon.title("Processing");
        } else if (d.status() === "S") {
            icon = "dangerous";
            d.statusIcon.style("ALERT-CRITICAL");
            d.statusIcon.title(d.errorMessage());
        } else if (d.status() === "C") {
            icon = "check_circle";
            d.statusIcon.style("ALT-EMPHASIS");
            d.statusIcon.title("Complete");
        } else {
            icon = "error";
            d.statusIcon.title("Error:" + d.errorMessage());
            d.statusIcon.style("ALERT-CRITICAL");
        }
    });

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: () => icon
    });

    return model;
}

sp.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("ServerProcess", sp);

function printPdf(arg) {
    let url = (
        window.location.protocol + "//" +
        window.location.hostname + ":" +
        window.location.port +
        window.location.pathname
    );
    if (typeof arg === "string") {
        url += "pdf/" + arg;
        printJS(url);
    } else if (!arg.printable && arg.file) {
        url += "pdf/" + arg.file;
        arg.printable = url;
        printJS(arg);
    } else {
        throw new Error("Invalid arguments passed to printPdf");
    }
    return Promise.resolve();
}
catalog.register("functions", "printPdf", printPdf);

// Deal with different decimal place settings
function moneyFromType(scale, value) {
    let style;
    let amount = value.amount || 0;
    let currVal = value.currency;
    let curr = f.getCurrency(value.currency);
    let hasDisplayUnit = curr.data.hasDisplayUnit();

    style = {
        minimumFractionDigits: scale,
        maximumFractionDigits: scale
    };

    if (hasDisplayUnit) {
        curr.data.conversions().some(function (conv) {
            if (conv.data.toUnit().id() === curr.data.displayUnit().id()) {
                amount = amount.times(conv.data.ratio.toJSON()).round(scale);
                return true;
            }
        });

        currVal = curr.data.displayUnit().data.code();
    }

    return {
        amount: amount.toLocaleString(undefined, style),
        currency: currVal,
        effective: (
            value.effective === null
            ? null
            : f.formats().dateTime.fromType(value.effective)
        ),
        baseAmount: (
            value.baseAmount === null
            ? null
            : f.types.number.fromType(value.baseAmount)
        )
    };
}
function moneyToType(scale, value) {
    value = value || f.money();
    let theAmount = f.types.number.toType(value.amount);
    let theCurrency = f.formats().string.toType(value.currency);
    let curr = f.getCurrency(value.currency);

    if (curr.data.hasDisplayUnit() && theCurrency !== curr.data.code()) {
        curr.data.conversions().some(function (conv) {
            if (conv.data.toUnit().id() === curr.data.displayUnit().id()) {
                theAmount = theAmount.div(
                    conv.data.ratio.toJSON().round(scale)
                );
                return true;
            }
        });

        theCurrency = curr.data.code();
    }

    value = {
        amount: theAmount,
        currency: theCurrency,
        effective: (
            value.effective === null
            ? null
            : f.formats().dateTime.toType(value.effective)
        ),
        baseAmount: (
            value.baseAmount === null
            ? null
            : f.types.number.toType(value.baseAmount)
        )
    };

    return value;
}

function moneyTableData(scale, obj) {
    let value = f.copy(f.formats().money.toType(obj.value));
    let options = obj.options;
    let curr = f.getCurrency(value.currency);
    let du;
    let symbol;
    let content;
    let isNegative = false;

    if (curr) {
        if (curr.data.hasDisplayUnit()) {
            du = curr.data.displayUnit();
            symbol = du.data.symbol();
        } else {
            symbol = curr.data.symbol();
        }
    }

    if (value.amount < 0) {
        isNegative = true;
        value.amount = Math.abs(value.amount);
    }

    content = value.amount.toLocaleString(
        undefined,
        {
            minimumFractionDigits: scale,
            maximumFractionDigits: scale
        }
    );

    content = symbol + content;

    if (isNegative) {
        content = "(" + content + ")";
        options.style.color = "red";
    }

    options.style.textAlign = "right";

    return content;
}

const csettings = catalog.store().models().commonSettings();
f.formats().unitCost = {
    type: "object",
    default: () => f.money(),
    isMoney: true,
    fromType: moneyFromType.bind(null, csettings.data.costDecimals()),
    toType: moneyToType.bind(null, csettings.data.costDecimals()),
    editor: f.formats().money.editor,
    tableData: moneyTableData.bind(null, csettings.data.costDecimals())
};

f.formats().purchasePrice = {
    type: "object",
    default: () => f.money(),
    isMoney: true,
    fromType: moneyFromType.bind(null, csettings.data.purchasePriceDecimals()),
    toType: moneyToType.bind(null, csettings.data.purchasePriceDecimals()),
    editor: f.formats().money.editor,
    tableData: moneyTableData.bind(null, csettings.data.purchasePriceDecimals())
};

f.formats().salesPrice = {
    type: "object",
    default: () => f.money(),
    isMoney: true,
    fromType: moneyFromType.bind(null, csettings.data.salesPriceDecimals()),
    toType: moneyToType.bind(null, csettings.data.salesPriceDecimals()),
    editor: f.formats().money.editor,
    tableData: moneyTableData.bind(null, csettings.data.salesPriceDecimals())
};

/**
    Terms model
*/
function terms(data, feather) {
    "use strict";

    feather = feather || catalog.getFeather("Terms");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        switch (d.policy()) {
        case "P":
            d.net.isReadOnly(true);
            d.day.isReadOnly(true);
            d.discountDays.isReadOnly(true);
            d.discount.isReadOnly(true);
            d.depositRequired.isReadOnly(true);
            break;
        case "I":
            d.net.isReadOnly(true);
            d.day.isReadOnly(true);
            d.discountDays.isReadOnly(true);
            d.discount.isReadOnly(true);
            d.depositRequired.isReadOnly(false);
            break;
        case "N":
            d.day.isReadOnly(true);
            d.net.isReadOnly(false);
            d.discountDays.isReadOnly(false);
            d.discount.isReadOnly(false);
            d.depositRequired.isReadOnly(false);
            break;
        case "D":
            d.discountDays.isReadOnly(true);
            d.discount.isReadOnly(true);
            d.day.isReadOnly(false);
            d.net.isReadOnly(true);
            d.depositRequired.isReadOnly(false);
            break;
        default:
            throw new Error("Invalid terms policy.");
        }

        if (d.depositRequired()) {
            if (d.policy() === "P") {
                d.depositAmount.isReadOnly(true);
                d.depositPercent.isReadOnly(true);
            } else {
                d.depositAmount.isReadOnly(false);
                d.depositPercent.isReadOnly(false);
            }
        } else {
            d.depositAmount.isReadOnly(true);
            d.depositPercent.isReadOnly(true);
        }
    }

    model.onChange("day", function (prop) {
        if (prop.newValue() < 1) {
            prop.newValue(1);
        } else if (prop.newValue() > 31) {
            prop.newValue(31);
        }
    });

    model.onChange("policy", function (prop) {
        if (prop.oldValue() === "P") {
            d.depositRequired(false);
            d.depositPercent(0);
        }

        switch (prop.newValue()) {
        case "P":
            d.depositRequired(true);
            d.depositPercent(100);
            d.depositAmount().amount = 0;
            d.net(0);
            d.day(1);
            d.discountDays(0);
            d.discount(0);
            break;
        case "I":
            d.net(0);
            d.day(1);
            d.discountDays(0);
            d.discount(0);
            break;
        case "N":
            d.net(30);
            d.day(1);
            break;
        case "D":
            d.net(0);
            d.discountDays(0);
            d.discount(0);
            break;
        default:
            throw new Error("Invalid terms policy.");
        }
    });

    model.onChanged("depositRequired", function () {
        if (!d.depositRequired()) {
            if (d.depositAmount() && d.depositAmount.toJSON().amount) {
                d.depositAmount().amount = 0;
            } else {
                d.depositAmount(f.money());
            }
            d.depositPercent(0);
        }
    });

    model.onChanged("policy", handleReadOnly);
    model.onChanged("depositRequired", handleReadOnly);
    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        if (
            d.depositRequired() &&
            d.depositAmount.toJSON().amount === 0 &&
            d.depositPercent.toJSON() === 0
        ) {
            throw (
                "Deposit percent or amount must be positive when deposit " +
                "required."
            );
        }
    });

    handleReadOnly();

    return model;
}

catalog.registerModel("Terms", terms);
