/*jslint unordered*/
async function doApprove(obj) {
    if (!obj.data.ids) {
        await obj.client.query(
            "DELETE FROM \"$subscription\" " +
            "WHERE objectid = 'proposed_cost';" +
            "UPDATE proposed_cost SET status = 'A'" +
            "WHERE status = 'P';"
        );
        return;
    }

    return new Promise(function (resolve, reject) {
        let fltr = {criteria: [{property: "status", value: "P"}]};

        fltr.criteria.push({
            property: "id",
            operator: "IN",
            value: obj.data.ids
        });

        function fetch() {
            return f.datasource.request({
                method: "GET",
                name: "ProposedCost",
                client: obj.client,
                filter: fltr
            }, true);
        }

        function update(resp) {
            function next() {
                if (!resp.length) {
                    resolve("Proposal(s) approved");
                    return;
                }

                f.datasource.request({
                    method: "PATCH",
                    name: "ProposedCost",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: resp.shift().id,
                    data: [{
                        op: "replace",
                        path: "/status",
                        value: "A"
                    }]
                }, true).then(next).catch(reject);
            }

            next();
        }

        Promise.resolve().then(
            fetch
        ).then(
            update
        ).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doApproveProposedCosts",
    doApprove
);