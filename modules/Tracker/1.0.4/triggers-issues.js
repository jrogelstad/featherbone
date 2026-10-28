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

function formatPriority(p) {
    let txt;
    switch (p) {
    case "1":
        txt = "<b><span style=\"color:Red;\">Showstopper</span></b>";
        break;
    case "2":
        txt = "<span style=\"color:Red;\">High</span>";
        break;
    case "3":
        txt = "Medium";
        break;
    case "4":
        txt = "Low";
        break;
    }
    return txt;
}

/*
    The email address of a user account, through the contact it
    points at. Nothing when the account has no contact or no address,
    or when the lookup fails: a message about an issue should still go
    to everyone else.
*/
function assigneeEmail(obj, name) {
    if (!name) {
        return Promise.resolve(undefined);
    }

    return f.datasource.request({
        method: "GET",
        name: "UserAccount",
        client: obj.client,
        filter: {criteria: [{property: "name", value: name}]},
        properties: ["id", "name", "contact"]
    }, true).then(function (rows) {
        let acct = rows[0];

        if (!acct || !acct.contact) {
            return undefined;
        }

        return f.datasource.request({
            method: "GET",
            name: "Contact",
            client: obj.client,
            id: acct.contact.id,
            properties: ["id", "email"]
        }, true).then(function (cnt) {
            return (
                cnt && cnt.email
                ? cnt.email
                : undefined
            );
        });
    }).catch(function () {
        return undefined;
    });
}

function addEmail(emails, email) {
    if (email && emails.indexOf(email) === -1) {
        emails.push(email);
    }
}

function doInsertIssue(obj) {
    return new Promise(function (resolve, reject) {
        let emails = [];
        let reporter;
        let url;

        function fetch() {
            return Promise.all([
                f.datasource.request({
                    method: "GET",
                    name: "Contact",
                    client: obj.client,
                    id: obj.newRec.reporter.id,
                    properties: ["id", "email", "fullName"]
                }, true),
                f.datasource.request({
                    method: "GET",
                    name: "Issue",
                    client: obj.client,
                    id: obj.newRec.id
                }, true),
                assigneeEmail(obj, obj.newRec.assignedTo)
            ]);
        }

        function doSend(resp) {
            let cnt = resp[0];
            let iss = resp[1];
            // The reporter is the contact itself; this used to look
            // for a "reporter" on it and so never found one
            addEmail(emails, cnt && cnt.email);
            addEmail(emails, resp[2]);
            reporter = (
                cnt
                ? cnt.fullName
                : "Not indicated"
            );
            url = (
                instanceUrl(obj) + "/#!/edit/" +
                iss.objectType + "/" +
                iss.id
            );
            return f.datasource.request({
                method: "POST",
                name: "sendMail",
                client: obj.client,
                data: {
                    message: {
                        to: "support@featherbone.com",
                        bcc: emails.join(";"),
                        from: "support@featherbone.com",
                        subject: (
                            "[NEW Issue " + iss.number + "] " +
                            iss.description
                        ),
                        html: (
                            "<html><p><b>Type</b>: " + iss.objectType +
                            "</p><p><b>Reporter</b>: " + reporter +
                            "</p><p><b>Priority</b>: " +
                            formatPriority(iss.priority) +
                            "</p><p><b>Reproduction</b>: " +
                            iss.reproduction +
                            "</p><p><b>Comments</b>: " + iss.comments +
                            "</p><p>Link</b>: <a href=\"" + url + "\">" +
                            "Issue #" + iss.number + "</a></p><html>"
                        )
                    }
                }
            }, true).then(resolve).catch(reject);
        }

        fetch().then(
            doSend
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "Issue",
    doInsertIssue,
    f.datasource.TRIGGER_AFTER
);

function doUpdateIssue(obj) {
    return new Promise(function (resolve, reject) {
        let emails = [];
        let reporter = (
            obj.newRec.reporter
            ? obj.newRec.reporter.fullName
            : "Not indicated"
        );
        let url = (
            instanceUrl(obj) + "/#!/edit/" +
            obj.newRec.objectType + "/" +
            obj.newRec.id
        );
        if (
            obj.newRec.reporter &&
            obj.newRec.reporter.email
        ) {
            emails.push(obj.newRec.reporter.email);
        }
        let status;
        let hstatus = "UPDATE";
        switch (obj.newRec.status) {
        case "N":
            status = "New";
            break;
        case "C":
            status = "Confirmed";
            break;
        case "I":
            status = "In process";
            break;
        case "T":
            status = "To be tested";
            break;
        case "R":
            status = "Resolved";
            break;
        case "W":
            status = "Withdrawn";
            break;
        case "E":
            status = "Enhancement";
            break;
        case "F":
            status = "Feedback";
            break;
        }

        if (obj.oldRec.assignedTo !== obj.newRec.assignedTo) {
            hstatus = "ASSIGNED";
        }
        if (obj.oldRec.status !== obj.newRec.status) {
            hstatus = status.toUpperCase();
        }
        // The person it is assigned to hears about every change to it
        // and, first of all, that it was given to them
        function doSend(assignee) {
            addEmail(emails, assignee);
            return f.datasource.request({
                method: "POST",
                name: "sendMail",
                client: obj.client,
                data: {
                    message: {
                        to: "support@featherbone.com",
                        bcc: emails.join(";"),
                        from: "support@featherbone.com",
                        subject: (
                            "[" + hstatus + " Issue " + obj.newRec.number
                            + "] " +
                            obj.newRec.description
                        ),
                        html: (
                            "<html>" +
                            "<body>" +
                            "<p><b>Type:</b> " + obj.newRec.objectType +
                            "</p><p><b>" +
                            "Status:</b>: " + status +
                            "</p><p><b>Priority:</b> " +
                            formatPriority(obj.newRec.priority) +
                            "</p><p><b>Reporter:</b> " + reporter +
                            "</p><b>Updated by:</b> " +
                            obj.newRec.updatedBy +
                            "</p><p><b>Reproduction:</b> " +
                            obj.newRec.reproduction +
                            "</p><p><b>Comments:</b> " +
                            obj.newRec.comments +
                            "</p><p><b>Assigned to:</b> " + (
                                obj.newRec.assignedTo || "To be determined"
                            ) +
                            "</p><p><b>Resolution:</b> " + (
                                obj.newRec.resolution || "To be determined"
                            ) +
                            "</p><p><b>Closed</b>: " + (
                                obj.newRec.isClosed
                                ? "Yes"
                                : "No"
                            ) +
                            "</p><p><b>Link:</b> <a href=\"" + url + "\">" +
                            "Issue #" + obj.newRec.number +
                            "</a></p><body></html> "
                        )
                    }
                }
            }, true);
        }
        assigneeEmail(obj, obj.newRec.assignedTo).then(
            doSend
        ).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "PATCH",
    "Issue",
    doUpdateIssue,
    f.datasource.TRIGGER_AFTER
);