/*jslint devel*/
/**
  Alert handler
*/

f.datasource.registerFunction(
    "POST",
    "Alert",
    function (obj) {
        let theUser = obj.client.currentUser();
        let theTenant = obj.client.tenant() || false;
        let ds = f.datasource;
        let newRec = obj.newRec;

        obj.client.onCommit(async function () {
            let aSettings = await ds.request({
                data: {name: "alertSettings"},
                method: "GET",
                name: "getSettings",
                tenant: theTenant,
                user: theUser
            }, true);
            if (!aSettings || !aSettings.emailTo) {
                return;
            }
            if (
                aSettings.severity === "Warning" &&
                newRec.severity === "Information"
            ) {
                return;
            }
            if (
                aSettings.severity === "Critical" &&
                (
                    newRec.severity === "Information" ||
                    newRec.severity === "Warning"
                )
            ) {
                return;
            }

            let url;
            if (newRec.relation) {
                url = (
                    theTenant.baseUrl + "/#!/edit/" +
                    newRec.relation.objectType + "/" + newRec.relation.id
                );
            }
            let theHtml = `<html><p>${newRec.message}</p>`;

            if (url) {
                theHtml += (
                    `<p>Click <a href=\"${url}\"` +
                    `>here</a> to view the affected record.` +
                    `</p></html>`
                );
            }

            await f.datasource.request({
                data: {
                    message: {
                        html: theHtml,
                        subject: (
                            newRec.severity +
                            " alert on " + newRec.category + " " +
                            (
                                newRec.releation
                                ? newRec.relation.code
                                : ""
                            )
                        ),
                        text: newRec.message,
                        to: aSettings.emailTo
                    }
                },
                method: "POST",
                name: "sendMail",
                tenant: theTenant,
                user: theUser
            });
        });
    },
    f.datasource.TRIGGER_AFTER
);
