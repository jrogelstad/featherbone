/*jslint devel unordered*/
/*
    The address of the instance a change came from, so a link in a
    message opens that instance rather than a fixed one. The framework
    keeps it on the instance (protocol, host and database name) from the
    requests it serves. Without one, as for work started outside a
    request, fall back to the original address.
*/
function instanceUrl(obj) {
    let tenant = (
        typeof obj.client.tenant === "function"
        ? obj.client.tenant()
        : undefined
    );
    let url = tenant && tenant.baseUrl;

    return (
        url
        ? url.replace(/\/+$/, "")
        : "https://tracker.featherbone.com"
    );
}

function doInsertUserAccount(obj) {
    return new Promise(function (resolve, reject) {
        function getContact() {
            return f.datasource.request({
                method: "GET",
                name: "Contact",
                client: obj.client,
                id: obj.newRec.contact.id,
                properties: ["id", "email", "firstName"]
            }, true);
        }

        function doSend(cnt) {
            if (cnt && cnt.email) {
                return f.datasource.request({
                    method: "POST",
                    name: "sendMail",
                    client: obj.client,
                    data: {
                        message: {
                            to: cnt.email,
                            from: "support@featherbone.com",
                            subject: "New Featherbone account created",
                            html: (
                                "Hello " + cnt.firstName + ",<br><br>" +
                                "A new account was created for you " +
                                "at this link:<br><br>" +
                                "<a href=\"" + instanceUrl(obj) + "\">" +
                                "Featherbone Tracker</a> " +
                                "<br><br>User account: " + obj.newRec.name +
                                "<br>" +
                                "Password: " + obj.newRec.password
                            )
                        }
                    }
                }, true);
            }

            return Promise.resolve();
        }
        if (obj.newRec.contact) {
            getContact().then(
                doSend
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
    "UserAccount",
    doInsertUserAccount,
    f.datasource.TRIGGER_BEFORE
);