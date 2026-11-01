/*jslint browser unordered*/
/*global f*/

/**
  Terms handler
*/
function doHandleTerms(obj) {
    "use strict";

    return new Promise(function (resolve) {
        let newRec = obj.newRec;

        if (!newRec.depositAmount) {
            throw new Error("Deposit money object is required on terms.");
        }

        if (!newRec.day > 31) {
            throw new Error("Day can not be greater than 31.");
        }

        switch (newRec.policy) {
        case "P":
            newRec.net = 0;
            newRec.day = 1;
            newRec.discountDays = 0;
            newRec.discount = 0;
            newRec.depositRequired = true;
            newRec.depositPercent = 100;
            newRec.depositAmount.amount = 0;
            break;
        case "I":
            newRec.net = 0;
            newRec.day = 1;
            newRec.discountDays = 0;
            newRec.discount = 0;
            break;
        case "N":
            newRec.day = 1;
            break;
        case "D":
            newRec.net = 0;
            newRec.discountDays = 0;
            newRec.discount = 0;
            break;
        default:
            throw new Error("Invalid terms policy.");
        }

        if (newRec.depositRequired) {
            if (
                newRec.depositPercent === 0 &&
                newRec.depositAmount.amount === 0
            ) {
                throw new Error(
                    "Deposit percent or amount must be positive when " +
                    "deposit required."
                );
            }
        } else {
            newRec.depositPercent = 0;
            newRec.depositAmount.amount = 0;
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "Terms",
    doHandleTerms,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Terms",
    doHandleTerms,
    f.datasource.TRIGGER_BEFORE
);
