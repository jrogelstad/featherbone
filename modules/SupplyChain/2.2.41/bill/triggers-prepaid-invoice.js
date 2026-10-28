/*jslint devel*/
f.datasource.registerFunction(
    "POST",
    "PrepaidInvoice",
    function (obj) {
        obj.newRec.unapplied = obj.newRec.total;
    },
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "PrepaidInvoice",
    function (obj) {
        obj.newRec.unapplied.amount = obj.oldRec.total.amount.minus(
            obj.newRec.applications.reduce(
                function (prv, nxt) {
                    return prv.plus(nxt.amount.amount);
                },
                0
            )
        );
        if (obj.newRec.unapplied.amount < 0) {
            throw "Total cannot be reduced to less than amount already applied";
        }
        if (obj.newRec.unapplied.amount > obj.newRec.total.amount) {
            throw "Unapplied amount cannot be greater than the invoice total";
        }
    },
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "DELETE",
    "PrepaidInvoice",
    function (obj) {
        if (obj.oldRec.unapplied.amount < obj.oldRec.total.amount) {
            throw "Cannot delete prepaid invoice that has been applied";
        }
    },
    f.datasource.TRIGGER_BEFORE
);
