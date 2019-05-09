/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
**/
/*jslint browser*/
/*global f*/

/**
  Feather specification
*/
function doUpsertFeather(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload;
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
                delete prop.name;
            }
        });
        feather.overloads = {};
        overloads.forEach(function (o) {
            let overload = {};

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

            feather.overloads[o.name] = overload;
        });

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

/**
  Contact
*/
function handleContact(obj) {
    "use strict";

    return new Promise(function (resolve) {
        let newRec = obj.newRec;

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

/**
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
                    let data;

                    if (result.length) {
                        data = result[0];
                        data.isBase = false;

                        payload = {
                            method: "POST",
                            name: "Currency",
                            id: data.id,
                            data: data,
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

/**
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

/**
  Document
*/
function handleDocument(obj) {
    "use strict";

    return new Promise(function (resolve) {
        let newRec = obj.newRec;

        if (!newRec.owner) {
            newRec.owner = obj.user;
        }

        resolve();
    });
}

f.datasource.registerFunction(
    "POST",
    "Document",
    handleDocument,
    f.datasource.TRIGGER_BEFORE
);

/**
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

            obj.newRec.attrs.forEach(function (attr) {
                let prop = feather.properties[attr.attr];
                let cpayload;

                function handleColumns(resp) {
                    return new Promise(function (resolve) {
                        let cfeather = resp;

                        attr.columns.forEach(function (col) {
                            let cprop;
                            let isRef = col.attr.indexOf(".") !== -1;

                            if (!isRef) {
                                cprop = cfeather.properties[col.attr];
                            }

                            if (!isRef && !cprop) {
                                throw new Error(
                                    "Invalid column '" + attr.attr + "'"
                                );
                            }

                            if (
                                isRef ||
                                cprop.type !== "object" ||
                                cprop.format !== "money"
                            ) {
                                col.showCurrency = false;
                            }

                            if (
                                isRef ||
                                cprop.type === "object" ||
                                cprop.type === "boolean"
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

/**
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

/**
  Role
*/
function updateRole(obj) {
    "use strict";

    return new Promise(function (resolve) {
        if (obj.oldRec.name !== obj.newRec.name) {
            throw new Error("Name cannot be changed");
        }

        resolve();
    });
}

function createRole(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload = {
            method: "POST",
            name: "createRole",
            client: obj.client,
            data: {
                name: obj.newRec.name.toLowerCase(),
                isLogin: false,
                isInherits: true
            }
        };

        f.datasource.request(payload, true).then(resolve).catch(reject);
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

/**
  User Account
*/
function updateUserAccount(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload = {
            method: "POST",
            name: "changeRolePassword",
            client: obj.client,
            data: {
                name: obj.newRec.name.toLowerCase(),
                password: obj.newRec.password
            }
        };

        if (obj.oldRec.name !== obj.newRec.name) {
            throw new Error("Name cannot be changed");
        }

        if (obj.newRec.password) {
            obj.newRec.password = "";
            f.datasource.request(
                payload, 
                true
            ).then(resolve).catch(reject);
            return;
        }

        resolve();
    });
}

function createUserAccount(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let payload = {
            method: "POST",
            name: "createRole",
            client: obj.client,
            data: {
                name: obj.newRec.name.toLowerCase(),
                isLogin: true,
                password: obj.newRec.password,
                isInherits: false
            }
        };

        obj.newRec.name = obj.newRec.name.toLowerCase();
        obj.newRec.password = "";

        f.datasource.request(payload, true).then(resolve).catch(reject);
    });
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
    "UserAccount",
    deleteRole,
    f.datasource.TRIGGER_BEFORE
);
