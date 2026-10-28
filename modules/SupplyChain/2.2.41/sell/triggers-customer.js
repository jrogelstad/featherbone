/*jslint  unordered*/
/*
  Customer
*/
function doCustomerUpsert(obj) {
    "use strict";

    return new Promise(function (resolve) {
        let found;
        let newRec = obj.newRec;
        let oldRec = obj.oldRec;
        let oldThing = {};
        let newThing = {};

        newRec.contacts = (
            Array.isArray(newRec.contacts)
            ? newRec.contacts
            : []
        );

        if (oldRec && oldRec.contact) {
            oldThing = oldRec.contact;
        }

        if (newRec && newRec.contact) {
            newThing = newRec.contact;
        }

        if (!oldRec || !newThing.id || oldThing.id !== newThing.id) {
            newRec.contacts.forEach(function (row) {
                if (row === null) {
                    return;
                }

                row.isPrimary = false;
            });

            if (newRec.contact) {
                found = newRec.contacts.find(
                    (row) => row && row.contact.id === newRec.contact.id
                );

                if (found) {
                    found.isPrimary = true;
                } else {
                    found = {
                        id: f.createId(),
                        isPrimary: true
                    };
                    found.contact = newRec.contact;
                    newRec.contacts.push(found);
                }
            }
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "Customer",
    doCustomerUpsert,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Customer",
    doCustomerUpsert,
    f.datasource.TRIGGER_BEFORE
);