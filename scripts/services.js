/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
/*jslint browser unordered*/
/*global f*/

/*
  Feather specification
*/
function doUpsertFeather(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload;
        let auths = [];
        let feather = f.copy(obj.newRec);
        let props = feather.properties;
        let overloads = feather.overloads || [];
        let exclusions = [
            "id",
            "etag",
            "isDeleted",
            "objectType",
            "lock",
            "updated",
            "updatedBy",
            "created",
            "createdBy"
        ];
        let defaultAuth = [{
            role: "everyone",
            canCreate: true,
            canRead: true,
            canUpdate: true,
            canDelete: true
        }];
        let defaultChildAuth = [{
            role: "everyone",
            canCreate: false,
            canRead: true,
            canUpdate: false,
            canDelete: false
        }];

        function isChild(p) {
            return p !== null && typeof p.type === "object" && p.type.childOf;
        }

        props.forEach(function (p) {
            if (p && p.dataList) {
                p.dataList = p.dataList.filter((i) => i !== null);
            }
        });

        // Some update checks
        if (obj.oldRec && obj.newRec) {
            if (obj.oldRec.name !== obj.newRec.name) {
                throw new Error("Feather name cannot be changed");
            }

            if (
                obj.oldRec.plural &&
                obj.oldRec.plural !== obj.newRec.plural
            ) {
                throw new Error("Feather plural value cannot be changed");
            }

            if (obj.oldRec.inherits !== obj.newRec.inherits) {
                throw new Error("Feather inherited value cannot be changed");
            }
        }

        // Save the feather in the catalog
        feather.properties = {};
        exclusions.forEach(function (attr) {
            delete feather[attr];
        });
        props.forEach(function (prop) {
            if (prop) {
                exclusions.forEach(function (attr) {
                    delete prop[attr];
                });
                feather.properties[prop.name] = prop;
                if (
                    typeof prop.default === "string" &&
                    prop.default.toLowerCase() === "null"
                ) {
                    prop.default = null;
                } else if (
                    prop.default === "" ||
                    prop.default === null
                ) {
                    delete prop.default;
                }
                delete prop.name;
            }
        });
        feather.overloads = {};
        overloads.forEach(function (o) {
            let overload = {};

            if (o === null) {
                return;
            }

            if (o.overloadDescription) {
                overload.description = o.description;
            }

            if (o.overloadAlias) {
                overload.alias = o.alias;
            }

            if (o.overloadType) {
                overload.type = o.type;
            }

            if (o.overloadDefault) {
                overload.default = o.default;
            }

            if (o.overloadDataList) {
                overload.dataList = o.dataList;
            }

            if (o.overloadAutonumber) {
                overload.autonumber = o.autonumber;
            }

            feather.overloads[o.name] = overload;
        });

        // On insert assign authorization to everyone if none specified
        if (!obj.oldRec) {
            if (obj.newRec.authorizations === undefined) {
                obj.newRec.authorizations = [];
                if (
                    obj.newRec.properties.some(isChild) ||
                    obj.newRec.isChild
                ) {
                    obj.newRec.authorizations = f.copy(defaultChildAuth);
                    feather.authorizations = [{
                        role: "everyone",
                        actions: {
                            canCreate: false,
                            canRead: true,
                            canUpdate: false,
                            canDelete: false
                        }
                    }];
                } else {
                    obj.newRec.authorizations = f.copy(defaultAuth);
                    feather.authorizations = [{
                        role: "everyone",
                        actions: {
                            canCreate: true,
                            canRead: true,
                            canUpdate: true,
                            canDelete: true
                        }
                    }];
                }
            } else {
                obj.newRec.authorizations.forEach(function (auth) {
                    if (
                        obj.newRec.properties.some(isChild) ||
                        obj.newRec.isChild
                    ) {
                        auths.push({
                            role: auth.role,
                            actions: {
                                canCreate: false,
                                canRead: Boolean(auth.canRead),
                                canUpdate: false,
                                canDelete: false
                            }
                        });
                    } else {
                        auths.push({
                            role: auth.role,
                            actions: {
                                canCreate: Boolean(auth.canCreate),
                                canRead: Boolean(auth.canRead),
                                canUpdate: Boolean(auth.canUpdate),
                                canDelete: Boolean(auth.canDelete)
                            }
                        });
                    }
                });

                feather.authorizations = auths;
            }
        // Handle authorization changes on update
        } else if (obj.oldRec) {
            obj.oldRec.authorizations.forEach(function (auth) {
                auths.push({
                    role: auth.role,
                    actions: {
                        canCreate: false,
                        canRead: false,
                        canUpdate: false,
                        canDelete: false
                    }
                });
            });

            if (
                !obj.newRec.authorizations.length &&
                !obj.newRec.properties.some(isChild) &&
                !obj.newRec.isChild
            ) {
                obj.newRec.authorizations = f.copy(defaultAuth);
            } else if (
                !obj.newRec.authorizations.length &&
                (
                    obj.newRec.properties.some(isChild) ||
                    obj.newRec.isChild
                )
            ) {
                obj.newRec.authorizations = f.copy(defaultChildAuth);
            }

            obj.newRec.authorizations.forEach(function (auth) {
                if (auth === null) {
                    return;
                }

                let found = auths.find((a) => a.role === auth.role);

                if (
                    obj.newRec.properties.some(isChild) ||
                    obj.newRec.isChild
                ) {
                    auth.canCreate = false;
                    auth.canUpdate = false;
                    auth.canDelete = false;
                    if (found) {
                        found.actions.canCreate = false;
                        found.actions.canRead = auth.canRead;
                        found.actions.canUpdate = false;
                        found.actions.canDelete = false;
                    } else {
                        auths.push({
                            role: auth.role,
                            actions: {
                                canCreate: false,
                                canRead: auth.canRead,
                                canUpdate: false,
                                canDelete: false
                            }
                        });
                    }
                } else {
                    if (found) {
                        found.actions.canCreate = auth.canCreate;
                        found.actions.canRead = auth.canRead;
                        found.actions.canUpdate = auth.canUpdate;
                        found.actions.canDelete = auth.canDelete;
                    } else {
                        auths.push({
                            role: auth.role,
                            actions: {
                                canCreate: auth.canCreate,
                                canRead: auth.canRead,
                                canUpdate: auth.canUpdate,
                                canDelete: auth.canDelete
                            }
                        });
                    }
                }
            });
            feather.authorizations = auths;
        }

        payload = {
            method: "PUT",
            name: "saveFeather",
            data: {
                specs: feather
            },
            client: obj.client
        };

        f.datasource.request(payload, true).then(resolve).catch(reject);
    });
}

function doDeleteFeather(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        obj.isHard = true;
        let cpayload = {
            method: "DELETE",
            name: "deleteFeather",
            data: {
                name: obj.oldRec.name
            },
            client: obj.client
        };

        f.datasource.request(cpayload, true).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "Feather",
    doUpsertFeather,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Feather",
    doUpsertFeather,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "DELETE",
    "Feather",
    doDeleteFeather,
    f.datasource.TRIGGER_BEFORE
);

/*
  Contact
*/
function handleContact(obj) {
    "use strict";

    return new Promise(function (resolve) {
        let found;
        let oldAddr = {};
        let newAddr = {};
        let newRec = obj.newRec;
        let oldRec = obj.oldRec;

        function handlePrimary(attr, attrs) {
            let oldThing;
            let newThing;

            newRec[attrs] = (
                Array.isArray(newRec[attrs])
                ? newRec[attrs]
                : []
            );

            if (oldRec && oldRec[attr]) {
                oldThing = oldRec[attr];
            }

            if (newRec && newRec[attr]) {
                newThing = newRec[attr];
            }

            if (!oldRec || oldThing !== newThing) {
                newRec[attrs].forEach(function (row) {
                    if (row === null) {
                        return;
                    }

                    row.isPrimary = false;
                });

                if (newRec[attr]) {
                    found = newRec[attrs].find(
                        (row) => row && row[attr] === newRec[attr]
                    );

                    if (found) {
                        found.isPrimary = true;
                        found.type = newRec[attr + "Type"];
                    } else {
                        found = {
                            id: f.createId(),
                            type: newRec[attr + "Type"],
                            isPrimary: true
                        };
                        found[attr] = newRec[attr];
                        newRec[attrs].push(found);
                    }
                }
            }
        }

        handlePrimary("phone", "phones");
        handlePrimary("email", "emails");

        newRec.addresses = (
            Array.isArray(newRec.addresses)
            ? newRec.addresses
            : []
        );

        if (oldRec && oldRec.address) {
            oldAddr = oldRec.address;
        }

        if (newRec && newRec.address) {
            newAddr = newRec.address;
        }

        if (!oldRec || oldAddr.id !== newAddr.id) {
            newRec.addresses.forEach(function (row) {
                if (row === null) {
                    return;
                }

                row.isPrimary = false;
            });

            if (newRec.address) {
                found = newRec.addresses.find(
                    (row) => (
                        row && row.address &&
                        row.address.id === newRec.address.id
                    )
                );

                if (found) {
                    found.isPrimary = true;
                } else {
                    newRec.addresses.push({
                        id: f.createId(),
                        address: newRec.address,
                        isPrimary: true
                    });
                }
            }
        }

        if (newRec.firstName) {
            newRec.fullName = newRec.firstName + " " + newRec.lastName;
        } else {
            newRec.fullName = newRec.lastName;
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "Contact",
    handleContact,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Contact",
    handleContact,
    f.datasource.TRIGGER_BEFORE
);

/*
  Currency
*/
function doUpdateCurrencyBefore(obj) {
    "use strict";

    return new Promise(function (resolve) {
        if (obj.oldRec.code !== obj.newRec.code) {
            throw new Error(
                "Currency code '" + obj.oldRec.code +
                "' may not be changed"
            );
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "PATCH",
    "Currency",
    doUpdateCurrencyBefore,
    f.datasource.TRIGGER_BEFORE
);

function handleCurrency(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload;
        let curr = obj.newRec;

        // Create a base currency effectivity record
        function insertBaseEffective() {
            return new Promise(function (resolve, reject) {
                payload = {
                    method: "POST",
                    name: "BaseCurrency",
                    data: {
                        currency: curr
                    },
                    client: obj.client
                };

                f.datasource.request(payload, true).then(
                    resolve
                ).catch(
                    reject
                );
            });
        }

        // Find any other currency tagged as base and update
        function updatePrevBase() {
            return new Promise(function (resolve, reject) {

                function callback(result) {
                    let theData;

                    if (result.length) {
                        theData = result[0];
                        theData.isBase = false;

                        payload = {
                            method: "POST",
                            name: "Currency",
                            id: theData.id,
                            data: theData,
                            client: obj.client
                        };

                        f.datasource.request(payload, true).then(
                            resolve
                        ).catch(
                            reject
                        );

                        return;
                    }

                    resolve();
                }

                payload = {
                    method: "GET",
                    name: "Currency",
                    filter: {
                        criteria: [{
                            property: "isBase",
                            value: true
                        }, {
                            property: "id",
                            operator: "!=",
                            value: curr.id
                        }]
                    },
                    client: obj.client
                };

                f.datasource.request(payload, true).then(
                    callback
                ).catch(
                    reject
                );
            });
        }

        if (curr.isBase && (!obj.oldRec || !obj.oldRec.isBase)) {
            Promise.resolve().then(
                insertBaseEffective
            ).then(
                updatePrevBase
            ).then(
                resolve
            ).catch(
                reject
            );

            return;
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "Currency",
    handleCurrency,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "Currency",
    handleCurrency,
    f.datasource.TRIGGER_AFTER
);

function doDeleteCurrency(obj) {
    "use strict";

    return new Promise(function (resolve) {
        if (obj.oldRec.isBase) {
            throw new Error("Cannot delete the base currency.");
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "DELETE",
    "Currency",
    doDeleteCurrency,
    f.datasource.TRIGGER_BEFORE
);

/*
  Currency conversion
*/
function doCheckCurrencyConversion(obj) {
    "use strict";

    return new Promise(function (resolve) {
        // Sanity check
        if (obj.newRec.fromCurrency.id === obj.newRec.toCurrency.id) {
            throw new Error(
                "'From' currency cannot be the same as the 'to' currency."
            );
        }

        if (obj.newRec.ratio <= 0) {
            throw new Error(
                "The conversion ratio nust be a positive number."
            );
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "CurrencyConversion",
    doCheckCurrencyConversion,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "CurrencyConversion",
    doCheckCurrencyConversion,
    f.datasource.TRIGGER_BEFORE
);

/*
  Data Service
*/
function doLoadServices(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        f.datasource.loadServices(
            obj.client.currentUser(),
            obj.client
        ).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "DataService",
    doLoadServices,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "DataService",
    doLoadServices,
    f.datasource.TRIGGER_AFTER
);

/*
  Document
*/
function doCreateDocument(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let payload;

        function callback(resp) {
            if (!resp) {
                throw new Error(
                    "Only a super user may set the owner as another user."
                );
            }

            resolve();
        }

        if (!newRec.owner) {
            newRec.owner = obj.client.currentUser();
        }

        if (newRec.owner !== obj.client.currentUser()) {
            payload = {
                method: "GET",
                name: "isSuperUser",
                client: obj.client
            };

            f.datasource.request(payload).then(callback).catch(reject);
            return;
        }

        resolve();
    });
}

function doUpdateDocument(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let oldRec = obj.oldRec;
        let payload;

        function callback(isSuper) {
            if (!isSuper) {
                throw new Error(
                    "Only the record owner or a super user are allowed to " +
                    "change document ownership."
                );
            }

            resolve();
        }

        if (
            newRec.owner !== oldRec.owner &&
            obj.client.currentUser() !== oldRec.owner
        ) {
            payload = {
                method: "GET",
                name: "isSuperUser",
                client: obj.client
            };

            f.datasource.request(payload).then(callback).catch(reject);
            return;
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "Document",
    doCreateDocument,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Document",
    doUpdateDocument,
    f.datasource.TRIGGER_BEFORE
);

/*
  Form
*/
function doHandleForm(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload = {
            method: "GET",
            name: "getFeather",
            data: {
                name: obj.newRec.feather
            },
            client: obj.client
        };

        function callback(resp) {
            let feather = resp;
            let requests = [];

            if (!resp) {
                resolve();
                return;
            }

            obj.newRec.attrs.forEach(function (attr) {
                if (attr === null) {
                    return;
                }

                let prop = feather.properties[attr.attr];
                let cpayload;

                function handleColumns(resp) {
                    return new Promise(function (resolve) {
                        let cfeather = resp;

                        attr.columns.forEach(function (col) {
                            // Ignore deletes
                            if (col === undefined || col === null) {
                                return;
                            }

                            let cprop;
                            let isRef = col.attr.indexOf(".") !== -1;

                            if (!isRef) {
                                cprop = cfeather.properties[col.attr];
                            }

                            if (
                                isRef ||
                                (cprop && cprop.type !== "object") ||
                                (cprop && cprop.format !== "money")
                            ) {
                                col.showCurrency = false;
                            }

                            if (
                                isRef ||
                                (cprop && cprop.type === "object") ||
                                (cprop && cprop.type === "boolean")
                            ) {
                                col.dataList = "";
                            }
                        });

                        resolve();
                    });
                }

                attr.columns = attr.columns || [];

                if (!prop) {
                    // Must be a calculated property
                    return;
                }

                // Don't allow improper combinations
                if (typeof prop.type !== "object" || prop.type.parentOf) {
                    attr.relationWidget = null;
                }

                if (prop.type !== "object" || prop.format !== "money") {
                    attr.disableCurrency = false;
                }

                if (typeof prop.type === "object" || prop.type === "boolean") {
                    attr.dataList = "";
                }

                if (typeof prop.type !== "object" || !prop.type.parentOf) {
                    attr.columns.length = 0;
                }

                if (attr.columns.length) {
                    cpayload = {
                        method: "GET",
                        name: "getFeather",
                        data: {
                            name: feather.properties[attr.attr].type.relation
                        },
                        client: obj.client
                    };

                    requests.push(
                        f.datasource.request(
                            cpayload,
                            true
                        ).then(handleColumns).catch(reject)
                    );
                }
            });

            Promise.all(requests).then(resolve).catch(reject);
        }

        f.datasource.request(payload, true).then(callback).catch(reject);

    });
}

f.datasource.registerFunction(
    "POST",
    "Form",
    doHandleForm,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Form",
    doHandleForm,
    f.datasource.TRIGGER_BEFORE
);

function doFormPostProc(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let requests = [];

        function callback(resp) {
            resp.forEach(function (row) {
                row.isDefault = false;
                requests.push(
                    f.datasource.request({
                        method: "POST",
                        name: "Form",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        id: row.id,
                        data: row
                    }, true)
                );
            });

            Promise.all(requests).then(resolve).catch(reject);
        }

        if (
            (
                !obj.oldRec && obj.newRec.isDefault
            ) ||
            (
                obj.oldRec && !obj.oldRec.isDefault && obj.newRec.isDefault
            )
        ) {
            f.datasource.request({
                method: "GET",
                name: "Form",
                client: obj.client,
                user: obj.client.currentUser(),
                filter: {
                    criteria: [{
                        property: "feather",
                        value: obj.newRec.feather
                    }, {
                        property: "id",
                        operator: "!=",
                        value: obj.newRec.id
                    }, {
                        property: "isDefault",
                        value: true
                    }]
                }
            }, true).then(callback).catch(reject);
            return;
        }

        resolve();
    });
}


f.datasource.registerFunction(
    "POST",
    "Form",
    doFormPostProc,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "Form",
    doFormPostProc,
    f.datasource.TRIGGER_AFTER
);

/*
  Module
*/
function doUpdateModule(obj) {
    "use strict";

    return new Promise(function (resolve) {
        if (obj.newRec.name !== obj.oldRec.name) {
            throw new Error("Module name cannot be changed.");
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "PATCH",
    "Module",
    doUpdateModule,
    f.datasource.TRIGGER_BEFORE
);

function doDeleteModule(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload = {
            method: "GET",
            name: "Module",
            showDeleted: true,
            id: obj.id,
            client: obj.client
        };

        function callback(resp) {
            payload = {
                method: "DELETE",
                name: "deleteModule",
                data: {
                    name: resp.name
                },
                client: obj.client
            };

            f.datasource.request(payload, true).then(resolve).catch(reject);
        }

        f.datasource.request(payload, true).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "DELETE",
    "Module",
    doDeleteModule,
    f.datasource.TRIGGER_AFTER
);

/*
  Role
*/
function updateRole(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let n = 0;
        let oldRec = obj.oldRec;
        let newRec = obj.newRec;
        let requests = [];
        let superPayload = {
            method: "GET",
            name: "isSuperUser",
            client: obj.client
        };

        if (obj.oldRec.name !== obj.newRec.name) {
            throw new Error("Name cannot be changed");
        }

        function handleMembership(userIsSuper) {
            if (obj.oldRec.isSuper !== obj.newRec.isSuper && !userIsSuper) {
                throw new Error(
                    "You must have super user privileges to alter" +
                    " super user status on a user account."
                );
            }

            // compare old and new membership, where different grant or revoke
            if (oldRec.membership.length < newRec.membership.length) {
                oldRec.membership.length = newRec.membership.length;
            }

            // Revoke changed roles
            while (n < oldRec.membership.length) {
                if (
                    newRec.membership[n] === undefined ||
                    newRec.membership[n] === null || (
                        oldRec.membership[n] !== undefined &&
                        oldRec.membership[n] !== null &&
                        oldRec.membership[n].role !== newRec.membership[n].role
                    )
                ) {
                    requests.push(
                        f.datasource.request(
                            {
                                method: "POST",
                                name: "revokeMembership",
                                data: {
                                    fromRole: oldRec.membership[n].role,
                                    toRole: oldRec.name
                                },
                                client: obj.client
                            },
                            true
                        )
                    );
                }
                n += 1;
            }

            // Grant changed roles
            n = 0;
            while (n < oldRec.membership.length) {
                if (
                    oldRec.membership[n] === undefined ||
                    oldRec.membership[n] === null || (
                        newRec.membership[n] !== undefined &&
                        newRec.membership[n] !== null &&
                        oldRec.membership[n].role !== newRec.membership[n].role
                    )
                ) {
                    requests.push(
                        f.datasource.request(
                            {
                                method: "POST",
                                name: "grantMembership",
                                data: {
                                    fromRole: newRec.membership[n].role,
                                    toRole: oldRec.name
                                },
                                client: obj.client
                            },
                            true
                        )
                    );
                }
                n += 1;
            }

            Promise.all(requests).then(resolve).catch(reject);
        }

        f.datasource.request(superPayload).then(handleMembership).catch(reject);
    });
}

function createRole(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let requests = [];
        let membership = obj.newRec.membership || [];
        let re = new RegExp(" ", "g");
        let options = obj.roleOptions || {
            name: obj.newRec.name.toLowerCase().replace(re, "_"),
            isLogin: true,
            password: obj.newRec.password,
            isInherits: false
        };
        let superPayload = {
            method: "GET",
            name: "isSuperUser",
            client: obj.client
        };
        let rolePayload = {
            method: "POST",
            name: "createRole",
            client: obj.client,
            data: options
        };

        function doCreateRole(userIsSuper) {
            return new Promise(function (resolve, reject) {
                if (obj.newRec.isSuper && !userIsSuper) {
                    throw new Error(
                        "You must have super user privileges to create" +
                        " a super user."
                    );
                }

                f.datasource.request(rolePayload).then(resolve).catch(reject);
            });
        }

        function doGrant() {
            membership.forEach(function (item) {
                let mpayload = {
                    method: "POST",
                    name: "grantMembership",
                    client: obj.client,
                    data: {
                        fromRole: item.role,
                        toRole: obj.newRec.name
                    }
                };

                requests.push(
                    f.datasource.request(
                        mpayload,
                        true
                    )
                );
            });

            Promise.all(requests).then(resolve).catch(reject);
        }

        f.datasource.request(
            superPayload,
            true
        ).then(doCreateRole).then(doGrant).catch(reject);
    });
}

function deleteRole(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload = {
            method: "POST",
            name: "dropRole",
            client: obj.client,
            data: {
                name: obj.oldRec.name
            }
        };

        f.datasource.request(payload, true).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "Role",
    createRole,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Role",
    updateRole,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "DELETE",
    "Role",
    deleteRole,
    f.datasource.TRIGGER_BEFORE
);

/*
  User Account
*/
function updateUserAccount(obj) {
    return new Promise(function (resolve, reject) {
        let requests = [];
        let pswd = obj.newRec.password;

        if (!obj.newRec.contact) {
            reject("Contact is required");
            return;
        }

        if (!obj.newRec.contact.email) {
            reject("Contact must have a primary email address");
            return;
        }

        if (!obj.newRec.isLocked) {
            obj.newRec.signInAttempts = 0;
        }

        function callback(config) {
            if (pswd) {
                if (
                    config.passwordLength &&
                    pswd.length < config.passwordLength
                ) {
                    reject(
                        "Password length must be at least " +
                        config.passwordLength + " characters"
                    );
                    return;
                }

                obj.newRec.password = "";
                obj.newRec.changePassword = true;
                requests.push(f.datasource.request(
                    {
                        method: "POST",
                        name: "changeRolePassword",
                        client: obj.client,
                        data: {
                            name: obj.newRec.name.toLowerCase(),
                            password: pswd
                        }
                    },
                    true
                ));
            }

            if (obj.newRec.isActive !== obj.oldRec.isActive) {
                requests.push(f.datasource.request(
                    {
                        method: "POST",
                        name: "changeRoleLogin",
                        client: obj.client,
                        data: {
                            name: obj.newRec.name.toLowerCase(),
                            isLogin: obj.newRec.isActive
                        }
                    },
                    true
                ));
            }

            if (obj.newRec.isSuper !== obj.oldRec.isSuper) {
                requests.push(f.datasource.request(
                    {
                        method: "POST",
                        name: "changeRoleCreateDb",
                        client: obj.client,
                        data: {
                            name: obj.newRec.name.toLowerCase(),
                            isLogin: obj.newRec.isSuper
                        }
                    },
                    true
                ));
            }

            Promise.all(requests).then(resolve).catch(reject);
        }

        f.datasource.config().then(callback).catch(reject);
    });
}

async function createUserAccount(obj) {
    if (!obj.newRec.contact) {
        return Promise.reject("Contact is required.");
    }

    let cntct = await f.datasource.request({
        client: obj.client,
        id: obj.newRec.contact.id,
        method: "GET",
        name: "Contact"
    }, true);

    if (!cntct) {
        return Promise.reject("Contact not found");
    }

    if (!cntct.email) {
        return Promise.reject("Contact must have a primary email address");
    }


    let config = await f.datasource.config();

    if (
        config.passwordLength &&
        obj.newRec.password.length < config.passwordLength
    ) {
        return Promise.reject(
            "Password length must be at least " +
            config.passwordLength + " characters"
        );
    }

    // Forward user account based options for role
    obj.roleOptions = {
        name: obj.newRec.name.toLowerCase(),
        isLogin: obj.newRec.isActive,
        isSuper: obj.newRec.isSuper,
        password: obj.newRec.password || f.createId(),
        isInherits: false
    };
    obj.newRec.password = "";
}

f.datasource.registerFunction(
    "POST",
    "UserAccount",
    createUserAccount,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "UserAccount",
    updateUserAccount,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "DELETE",
    "SendMail",
    function (obj) {
        obj.isHard = true;
        return Promise.resolve();
    },
    f.datasource.TRIGGER_BEFORE
);
