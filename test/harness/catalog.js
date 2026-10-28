/*
    How a feather is written down in a golden file: one line per property
    so a diff stays readable. Shared by Core's catalog test and by a
    module's own (ADR-003), through require("featherbone-test").catalog.
*/
/*jslint node*/
"use strict";

// One line per property so golden diffs stay readable. owner is the
// feather the property is read from: an inheritedFrom naming it is
// dropped because getFeather sets that inconsistently (a known
// defect, see catalog.test.js).
function propertySignature(p, owner) {
    let sig;
    let t = p.type;

    if (t && typeof t === "object") {
        sig = "relation(" + t.relation + ")";
        if (t.childOf) {
            sig += " childOf:" + t.childOf;
        }
        if (t.parentOf) {
            sig += " parentOf:" + t.parentOf;
        }
        if (t.isChild) {
            sig += " isChild";
        }
        if (Array.isArray(t.properties)) {
            sig += " [" + t.properties.join(",") + "]";
        }
    } else {
        sig = String(t);
    }
    if (p.format) {
        sig += ":" + p.format;
    }
    [
        ["isRequired", "required"],
        ["isNaturalKey", "naturalKey"],
        ["isReadOnly", "readOnly"],
        ["isLabelKey", "labelKey"],
        ["isIndexed", "indexed"],
        ["isEncrypted", "encrypted"],
        ["isAlwaysLoad", "alwaysLoad"]
    ].forEach(function (pair) {
        if (p[pair[0]]) {
            sig += " " + pair[1];
        }
    });
    if (p.default !== undefined && p.default !== null && p.default !== "") {
        sig += " default=" + JSON.stringify(p.default);
    }
    // The feather editor (client/models/feather.js, type change) writes
    // precision/scale -1 and min/max 0 onto a property to mean "not
    // applicable"; installed feathers leave them out. Treat both the
    // same so a feather saved through the UI matches a fresh install.
    // A max of 0 is ignored by the model (`prop.max && ...`), and a min
    // of 0 is deliberately set on quantities that must not go negative,
    // so a database may carry it where a fresh install does not. Neither
    // zero is part of the signature; any other min or max is.
    let notApplicable = function (key, value) {
        return p[key] === value;
    };
    // Precision and scale are the exception: -1 is the sentinel whatever
    // the type. Nothing in the framework or in SupplyChain declares -1,
    // and a number with no declared precision carries it too, so rendering
    // it produced "numeric(-1,-1)" on every undeclared numeric property.
    if (p.precision !== undefined && p.precision !== -1) {
        sig += " numeric(" + p.precision + "," + p.scale + ")";
    }
    if (p.min !== undefined && !notApplicable("min", 0)) {
        sig += " min=" + p.min;
    }
    if (p.max !== undefined && !notApplicable("max", 0)) {
        sig += " max=" + p.max;
    }
    if (p.autonumber) {
        // Key order depends on how the catalog was stored (json vs jsonb)
        sig += " autonumber=" + JSON.stringify(
            p.autonumber,
            Object.keys(p.autonumber).sort()
        );
    }
    if (Array.isArray(p.dataList)) {
        sig += " list=" + p.dataList.map(
            (d) => (
                typeof d === "object"
                ? d.value
                : d
            )
        ).join("|");
    }
    if (p.inheritedFrom && p.inheritedFrom !== owner) {
        sig += " <" + p.inheritedFrom;
    }
    return sig;
}

// Strip generated ids out of overload data lists
function overloadSignature(overloads) {
    let out = {};
    Object.keys(overloads || {}).forEach(function (key) {
        out[key] = propertySignature(Object.assign(
            {type: "(overload)"},
            overloads[key]
        ));
    });
    return out;
}

/*
    A feather as the golden file records it, given the feather as GET
    /feather/:name returns it (inheritance merged).
*/
function describeFeather(f, name) {
    let props = {};

    Object.keys(f.properties).forEach(function (key) {
        props[key] = propertySignature(f.properties[key], name);
    });
    return {
        inherits: f.inherits || null,
        isChild: Boolean(f.isChild),
        isFetchOnStartup: Boolean(f.isFetchOnStartup),
        isReadOnly: Boolean(f.isReadOnly),
        isSystem: Boolean(f.isSystem),
        module: f.module,
        overloads: overloadSignature(f.overloads),
        plural: f.plural,
        properties: props
    };
}

module.exports = {describeFeather, overloadSignature, propertySignature};
