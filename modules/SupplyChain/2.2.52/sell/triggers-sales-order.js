/*jslint devel browser this unordered*/
function propagateStatus(newRec, subStatus) {
    newRec.lines.filter((ln) => ln).forEach(function (line) {
        let setStatus = function (row) {
            row.status = subStatus || newRec.status;
        };
        line.status = newRec.status;
        line.materials.filter((mt) => mt).forEach(setStatus);
    });
}

function printChanged(obj) {
    let oldRec = obj.oldRec;
    let newRec = obj.newRec;

    return (
        oldRec &&
        (
            (!oldRec.confirmationPrinted && newRec.confirmationPrinted) ||
            (!oldRec.picklistPrinted && newRec.picklistPrinted)
        )
    );
}

async function handleAllocations(obj) {
    let dmds = obj.newRec.lines.filter((l) => l);
    let i = 0;
    let d;
    let qty;
    let did;
    let nlines = obj.newRec.lines.filter((l) => l);

    nlines.forEach(function (ln) {
        dmds = dmds.concat(ln.materials.filter((m) => m));
    });

    // Deallocate deleted lines
    obj.oldRec.lines.forEach(function (ln) {
        let nline = nlines.find((l) => l.id === ln.id);
        if (!nline) {
            ln.quantityDue = 0;
            dmds = dmds.concat([ln]);
            ln.materials.forEach(function (mtl) {
                mtl.quantityDue = 0;
                dmds = dmds.concat([mtl]);
            });
        } else {
            ln.materials.forEach(function (mtl) {
                if (!nline.materials.filter((m) => m).find(
                    (m) => m.id === mtl.id
                )) {
                    mtl.quantityDue = 0;
                    dmds = dmds.concat([mtl]);
                }
            });
        }
    });

    while (i < dmds.length) {
        qty = 0;
        d = dmds[i];

        if (d.quantityDue < d.allocated) {
            qty = d.allocated.minus(d.quantityDue);
            did = d.id;
        }

        if (qty) {
            await f.datasource.request({
                client: obj.client,
                data: {id: did, quantity: qty, type: "demand"},
                method: "POST",
                name: "doTransactAllocated"
            }, true);
        }
        i += 1;
    }
}

function renumberLines(obj) {
    obj.newRec.lines = obj.newRec.lines || [];
    let next = 1;
    // Make sure line numbers run sequentially from '1'
    // (perhaps some deleted?)
    let lines = obj.newRec.lines.filter(
        (line) => line && Number.isInteger(line.line)
    );
    lines.sort((a, b) => a.line - b.line);
    lines.forEach(function (line) {
        line.line = next;
        next += 1;
    });
    // Now number any lines that don't have a number
    lines = obj.newRec.lines.filter(
        (line) => line && !Number.isInteger(line.line)
    );
    // Handle demand number
    obj.newRec.lines.filter((ln) => ln).forEach(function (ln) {
        let seq = 1;
        let sep = "-";
        function setNum(row) {
            row.sequence = seq;
            row.number = (
                ln.number + sep +
                row.sequence
            );
            row.dueDate = row.dueDate || ln.dueDate;
            seq += 1;
        }
        ln.number = obj.newRec.number + "\\" + ln.line;
        ln.materials.filter((m) => m).forEach(setNum);
        seq = 1;
        sep = ".";
    });
}

function calcAmounts(obj, curr) {
    const CURR_SCALE = 2;
    let newRec = obj.newRec;
    let lines = newRec.lines;
    let subt = 0;
    let taxs = 0;

    if (!newRec.freight) {
        newRec.freight = {
            currency: curr,
            amount: 0
        };
    }

    lines.filter((ln) => ln).forEach(function (line) {
        let qty;
        let mult = 1;
        let pct = 0.01;

        line.id = line.id || f.createId();
        line.actualLaborCost = line.actualLaborCost || {
            currency: curr,
            amount: 0
        };
        line.actualOverheadCost = line.actualOverheadCost || {
            currency: curr,
            amount: 0
        };
        line.actualServiceCost = line.actualServiceCost || {
            currency: curr,
            amount: 0
        };
        line.actualMaterialCost = line.actualMaterialCost || {
            currency: curr,
            amount: 0
        };
        line.actualTotalCost = line.actualTotalCost || {
            currency: curr,
            amount: 0
        };
        line.shipped = line.shipped || 0;
        line.discount = line.discount || 0;

        // Handle money
        qty = line.ordered || 0;
        if (line.price) { // enforce currency propagation
            line.price.currency = curr;
        } else {
            line.price = {
                currency: curr,
                amount: 0
            };
        }

        mult = mult.minus(pct.times(line.discount));
        line.discountPrice = {
            amount: line.price.amount.times(mult),
            baseAmount: null,
            currency: curr,
            effective: null
        };
        // Round each line so the subtotal is the sum of the amounts
        // that are stored, not of fractions of a cent nobody sees.
        line.amount = {
            amount: qty.times(
                line.price.amount
            ).times(
                mult
            ).round(CURR_SCALE),
            baseAmount: null,
            currency: curr,
            effective: null
        };
        subt = subt.plus(line.amount.amount);
    });

    // Calculate amounts
    newRec.taxes = newRec.taxes || [];
    newRec.taxes.forEach(function (tax) {
        if (tax) {
            taxs = taxs.plus(tax.amount.amount);
        }
    });

    newRec.subtotal = {
        amount: subt,
        baseAmount: null,
        currency: curr,
        effective: null
    };
    newRec.tax = {
        amount: taxs,
        baseAmount: null,
        currency: curr,
        effective: null
    };
    newRec.total = {
        amount: subt.plus(
            newRec.freight.amount
        ).plus(
            newRec.tax.amount
        ),
        baseAmount: null,
        currency: curr,
        effective: null
    };
}

function calcDue(status, obj) {
    obj.newRec.lines.filter((ln) => ln).forEach(function (ln) {
        ln.quantityDue = ln.ordered.minus(
            ln.shipped
        );

        ln.id = ln.id || f.createId();
        ln.links = {
            salesDemandId: ln.id,
            salesOrderId: obj.newRec.id
        };

        if (
            (
                obj.newRec.status === "B" ||
                obj.newRec.status === "A" ||
                obj.newRec.status === "S"
            ) && ln.shipped > 0
        ) {
            ln.backOrdered = Math.max(ln.ordered.minus(ln.shipped), 0);
        } else {
            ln.backOrdered = 0;
        }

        if (ln.quantityDue) {
            ln.status = status;
        } else {
            ln.status = "C";
        }

        ln.promiseDate = (
            ln.promiseDate || ln.requestedDate ||
            obj.newRec.promiseDate || obj.newRec.requestedDate
        );
        ln.materials.filter((mtl) => mtl).forEach(function (mtl) {
            mtl.quantityDue = Math.max(mtl.required.minus(mtl.issued), 0);
            mtl.dueDate = ln.promiseDate || ln.requestedDate;
            mtl.id = mtl.id || f.createId();
            mtl.links = {
                salesDemandId: mtl.id,
                salesOrderId: obj.newRec.id
            };
            if (mtl.quantityDue) {
                mtl.status = status;
            } else {
                mtl.status = "C";
            }
        });

        ln.dueDate = ln.promiseDate || ln.requestedDate;
    });
}

function zeroDue(status, obj) {
    function handleRow(row) {
        row.status = status;
        row.quantityDue = 0;
        if (!Number.isNaN(Number(row.backOrdered))) {
            row.backOrdered = 0;
        }
    }

    obj.newRec.lines.filter((ln) => ln).forEach(function (ln) {
        handleRow(ln);
        ln.materials = ln.materials || [];
        ln.materials.forEach(handleRow);
        ln.dueDate = null;
    });
}

function incomplete(obj) {
    return (
        !obj.newRec.customer ||
        !obj.newRec.shipTo ||
        !obj.newRec.lines.length
    );
}

function checkComplete(obj) {
    if (incomplete(obj)) {
        throw (
            "Sales order must have customer, " +
            "ship to address and at least one line"
        );
    }
}

const cond = "C"; // Circumvent lint dogma
const STATE_MAP = {
    N: "/New",
    I: "/Incomplete",
    P: "/Pending",
    A: "/Active",
    S: "/Shipping",
    B: "/BackOrdered",
    C: "/Closed"
};

/* Statechart */
const EVENT_MAP = {
    I: "initialize",
    A: "release",
    P: "unrelease",
    S: "ship",
    B: "backOrder",
    C: "close"
};

function decodeState(code) {
    return STATE_MAP[code];
}

function decodeEvent(code) {
    return EVENT_MAP[code];
}

function recodeState(state) {
    state = "/" + state;
    return Object.keys(STATE_MAP).find((k) => STATE_MAP[k] === state);
}

function setStatus(obj, state) {
    obj.newRec.status = recodeState(state);
}

function enter(fn) {
    this.enters.push(fn);
    return this;
}

function exit(fn) {
    this.exits.push(fn);
    return this;
}

function goto(str, isRedirect) {
    let name = str.slice(3);
    let current = this.resolve(this.current()[0]);
    let redirect;
    let target = this.resolve("/" + name);
    if (!isRedirect) {
        current.exits.forEach((e) => e());
    }

    current = this.resolve("/" + name);
    redirect = target[cond]();
    if (redirect) {
        goto.bind(this)(redirect, true);
        return;
    }

    this.current("/" + name);
    target.enters.forEach((e) => e());
}

function State(obj) {
    let state;
    let subs = {};
    let current;

    state = {
        current: function (...args) {
            if (args.length) {
                current = state.resolve(args[0]);
            }
            return ["/" + current.name];
        },
        resolve: function (n) {
            return subs[n.slice(1)];
        },
        send: function (name) {
            if (!name) {
                return;
            }
            if (current.events[name]) {
                current.events[name]();
            } else {
                // State change not allowed
                obj.newRec.status = obj.oldRec.status;
            }
        },
        substateMap: subs
    };

    subs.New = {
        enters: [],
        events: {
            initialize: goto.bind(state, "../Incomplete"),
            start: goto.bind(state, "../Pending"),
            release: goto.bind(state, "../Active")
        },
        calculateAmounts: () => undefined,
        calculateDue: () => undefined,
        renumber: () => undefined
    };
    subs.Incomplete = {
        enters: [
            propagateStatus.bind(null, obj.newRec, "P")
        ],
        events: {
            close: goto.bind(state, "../Closed"),
            release: goto.bind(state, "../Active"),
            unrelease: goto.bind(state, "../Pending")
        },
        calculateAmounts: calcAmounts.bind(null, obj),
        calculateDue: zeroDue.bind(null, "P", obj),
        renumber: renumberLines.bind(null, obj)
    };
    subs.Pending = {
        C: function () {
            checkComplete(obj);
            if (obj.newRec.lines.every((ln) => ln.shipped)) {
                return "../Closed";
            }
            if (
                obj.shipSettings.useBackOrder &&
                obj.newRec.lines.some((ln) => ln.shipped)
            ) {
                return "../BackOrdered";
            }
            if (
                obj.newRec.lines.some((ln) => ln.shipped)
            ) {
                return "../Active";
            }
        },
        enters: [
            propagateStatus.bind(null, obj.newRec),
            function () {
                if (
                    obj.oldRec && obj.oldRec.lines.some(
                        (ln) => ln.materials.some((mt) => mt.issued)
                    )
                ) {
                    throw (
                        "Sales Order cannot be changed " +
                        "to Pending when there is transaction activity on " +
                        "kit materials"
                    );
                }
            }
        ],
        events: {
            close: goto.bind(state, "../Closed"),
            release: goto.bind(state, "../Active")
        },
        calculateAmounts: calcAmounts.bind(null, obj),
        calculateDue: calcDue.bind(null, "P", obj),
        renumber: renumberLines.bind(null, obj)
    };
    subs.Active = {
        C: function () {
            if (
                obj.shipSettings.useBackOrder &&
                obj.newRec.lines.some((ln) => ln.shipped)
            ) {
                return "../BackOrdered";
            }
        },
        enters: [
            checkComplete.bind(null, obj),
            propagateStatus.bind(null, obj.newRec)
        ],
        events: {
            close: goto.bind(state, "../Closed"),
            ship: goto.bind(state, "../Shipping"),
            unrelease: goto.bind(state, "../Pending")
        },
        calculateAmounts: calcAmounts.bind(null, obj),
        calculateDue: calcDue.bind(null, "A", obj),
        renumber: renumberLines.bind(null, obj)
    };
    subs.BackOrdered = {
        enters: [
            checkComplete.bind(null, obj),
            function () {
                obj.newRec.picklistPrinted = false;
                obj.newRec.picklistPrintTime = null;
                obj.newRec.picklistPrintedBy = "";
            }
        ],
        events: {
            close: goto.bind(state, "../Closed"),
            ship: goto.bind(state, "../Shipping")
        },
        calculateAmounts: calcAmounts.bind(null, obj),
        calculateDue: calcDue.bind(null, "A", obj),
        renumber: renumberLines.bind(null, obj)
    };
    subs.Shipping = {
        enters: [
            checkComplete.bind(null, obj)
        ],
        events: {
            release: goto.bind(state, "../Active"),
            backOrder: goto.bind(state, "../BackOrdered"),
            close: goto.bind(state, "../Closed")
        },
        calculateAmounts: calcAmounts.bind(null, obj),
        calculateDue: calcDue.bind(null, "A", obj),
        renumber: renumberLines.bind(null, obj)
    };
    subs.Closed = {
        events: {},
        calculateAmounts: () => undefined,
        calculateDue: zeroDue.bind(null, "C", obj),
        renumber: () => undefined
    };

    Object.keys(subs).forEach(function (key) {
        let sub = subs[key];
        let none = () => undefined;
        let setSts = setStatus.bind(null, obj, key);

        sub.name = key;
        sub[cond] = sub[cond] || none;
        sub.enters = sub.enters || [];
        sub.enters.push(setSts); // Always set status on entry
        sub.exits = sub.exits || [];
        sub.enter = enter.bind(subs[key]);
        sub.exit = exit.bind(subs[key]);
    });

    if (obj.oldRec) {
        state.current(decodeState(obj.oldRec.status));
    } else {
        state.current("/New");
    }

    return state;
}

async function doBeforeInsert(obj) {
    let newRec = obj.newRec;
    let state = new State(obj);
    let event = decodeEvent(newRec.status);
    let subst;
    let curr = await f.datasource.request({
        method: "GET",
        name: "Currency",
        properties: ["code"],
        client: obj.client,
        id: newRec.currency.id
    }, true);

    if (!curr) {
        throw "Currency not found";
    }

    curr = curr.code;

    if (!obj.newRec.number) {
        obj.newRec.number = await f.datasource.request({
            method: "POST",
            name: "autoNumber",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {name: "SalesOrder"}
        }, true);
    }

    // Set initial status & do calculations
    state.send(event);
    subst = state.resolve(state.current()[0]);
    subst.renumber();
    subst.calculateDue();
    subst.calculateAmounts(curr);
}

f.datasource.registerFunction(
    "POST",
    "SalesOrder",
    doBeforeInsert,
    f.datasource.TRIGGER_BEFORE
);

/**
  Sell order handler for sales order
*/
async function doBeforeUpdate(obj) {
    let newRec = obj.newRec;
    let curr = obj.oldRec.total.currency;
    let state = new State(obj);
    let event = decodeEvent(newRec.status);
    let subst;

    // Skip all processing if only updating print status
    if (printChanged(obj)) {
        return;
    }

    obj.shipSettings = await f.datasource.request({
        client: obj.client,
        data: {name: "shipSettings"},
        method: "GET",
        name: "getSettings"
    }, true);

    // check currency
    if (obj.oldRec.currency.id !== newRec.currency.id) {
        curr = await f.datasource.request({
            method: "GET",
            name: "Currency",
            properties: ["code"],
            client: obj.client,
            id: newRec.currency.id
        }, true);

        if (!curr) {
            throw "Currency not found";
        }

        curr = curr.code;
    }

    // Handle status change & calculations
    state.send(event);
    subst = state.resolve(state.current()[0]);
    subst.renumber();
    subst.calculateDue();
    subst.calculateAmounts(curr);
    await handleAllocations(obj);
}

f.datasource.registerFunction(
    "PATCH",
    "SalesOrder",
    doBeforeUpdate,
    f.datasource.TRIGGER_BEFORE
);

async function doAfterInsert(obj) {
    let i = 0;
    let lines = obj.newRec.lines.filter((ln) => ln.quantityDue);

    while (i < lines.length) {
        await f.datasource.request({
            method: "POST",
            name: "doRecalcInventoryOrders",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {
                itemId: lines[i].item.id,
                siteId: lines[i].site.id
            }
        }, true);
        i += 1;
    }

    if (lines.length) {
        await f.datasource.request({
            method: "POST",
            name: "doPlanSalesOrderSupply",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {id: obj.newRec.id, lock: false}
        });
    }
}

f.datasource.registerFunction(
    "POST",
    "SalesOrder",
    doAfterInsert,
    f.datasource.TRIGGER_AFTER
);

async function doAfterUpdate(obj) {
    // Skip all processing if only updating print status
    if (printChanged(obj)) {
        return;
    }

    let oldRec = obj.oldRec || {lines: []};
    let newRec = obj.newRec;
    let len1 = Math.max(oldRec.lines.length, newRec.lines.length);
    let len2;
    let oldLen;
    let newLen;
    let n1 = 0;
    let n2 = 0;
    let replan = false;

    async function processRecalc(orec, nrec, dmd, act) {
        async function recalcInv(pItemId, pSiteId) {
            await f.datasource.request({
                method: "POST",
                name: "doRecalcInventoryOrders",
                client: obj.client,
                user: obj.client.currentUser(),
                data: {itemId: pItemId, siteId: pSiteId}
            });
            // Don't replan if we are just processing shipping
            if (obj.oldRec.status !== "S" || obj.newRec.status === "S") {
                replan = true;
            }
        }

        if (orec && !nrec) {
            await recalcInv(orec.item.id, orec.site.id);
        } else if (nrec && !orec) {
            await recalcInv(nrec.item.id, nrec.site.id);
        } else if (
            nrec.item.id !== orec.item.id ||
            nrec.site.id !== orec.site.id
        ) {
            await recalcInv(orec.item.id, orec.site.id);
        } else if (
            nrec[dmd] !== orec[dmd] ||
            nrec[act] !== orec[act] ||
            (orec.status !== "C" && nrec.status === "C")
        ) {
            await recalcInv(nrec.item.id, nrec.site.id);
        }
    }

    // Detect changes in demands & recalc if applicable
    while (n1 < len1) {
        await processRecalc(
            oldRec.lines[n1],
            newRec.lines[n1],
            "quantityDue",
            "shipped"
        );

        oldLen = (
            oldRec.lines[n1]
            ? oldRec.lines[n1].materials.length
            : 0
        );
        newLen = (
            newRec.lines[n1]
            ? newRec.lines[n1].materials.length
            : 0
        );
        len2 = Math.max(oldLen, newLen);
        n2 = 0;

        // Recalc materials
        while (n2 < len2) {
            await processRecalc(
                (
                    oldRec.lines[n1]
                    ? oldRec.lines[n1].materials[n2]
                    : undefined
                ),
                (
                    newRec.lines[n1]
                    ? newRec.lines[n1].materials[n2]
                    : undefined
                ),
                "required",
                "issued"
            );
            n2 += 1;
        }

        n2 = 0;
        n1 += 1;
    }

    if (replan) {
        await f.datasource.request({
            method: "POST",
            name: "doPlanSalesOrderSupply",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {id: newRec.id, lock: false}
        }, true);
    }

    // Propagate priority changes
    let ln;
    let oldLn;
    n1 = 0;
    while (n1 < obj.newRec.lines.length) {
        ln = obj.newRec.lines[n1];
        if (ln) { // Not deleted
            oldLn = obj.oldRec.lines.find((l) => l.id === ln.id);
            if (oldLn && oldLn.priority !== ln.priority) {
                await f.datasource.request({
                    method: "POST",
                    name: "doPropagatePriority",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: {demandId: ln.id}
                }, true);
            }
        }
        n1 += 1;
    }
}

f.datasource.registerFunction(
    "PATCH",
    "SalesOrder",
    doAfterUpdate,
    f.datasource.TRIGGER_AFTER
);

async function doBeforeDelete(obj) {
    let i = 0;
    let line;
    if (obj.oldRec.status === "S") {
        throw "Cannot delete a sales order in shipping";
    }
    if (obj.oldRec.status === "C") {
        throw "Cannot delete a closed sales order";
    }
    async function deallocate(row) {
        if (row.allocated) {
            await f.datasource.request({
                client: obj.client,
                data: {id: row.id, quantity: row.allocated, type: "demand"},
                method: "POST",
                name: "doTransactAllocated"
            }, true);
        }
    }

    while (i < obj.oldRec.lines.length) {
        line = obj.oldRec.lines[i];
        i += 1;
        await deallocate(line);
        await Promise.all(line.materials.map(deallocate));
    }
}

f.datasource.registerFunction(
    "DELETE",
    "SalesOrder",
    doBeforeDelete,
    f.datasource.TRIGGER_BEFORE
);

async function doAfterDelete(obj) {
    // Hack: don't pass client so we get old record
    // before this all commits
    let oldRec = await f.datasource.request({
        method: "GET",
        name: "SalesOrder",
        user: obj.client.currentUser(),
        id: obj.id,
        tenant: obj.client.tenant()
    }, true);
    let i1 = 0;
    let i2 = 0;

    async function recalcInv(ln) {
        await f.datasource.request({
            method: "POST",
            name: "doRecalcInventoryOrders",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {itemId: ln.item.id, siteId: ln.site.id}
        }, true);
    }

    while (i1 < oldRec.lines.length) {
        await recalcInv(oldRec.lines[i1]);
        i2 = 0;
        while (i2 < oldRec.lines[i1]) {
            await oldRec.lines[i1].materials[i2](recalcInv);
            i2 += 1;
        }
        i1 += 1;
    }
}

f.datasource.registerFunction(
    "DELETE",
    "SalesOrder",
    doAfterDelete,
    f.datasource.TRIGGER_AFTER
);