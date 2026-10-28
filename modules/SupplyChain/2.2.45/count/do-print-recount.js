/*jslint unordered*/
/*global console*/

function doPrintRecount(obj) {
    return new Promise(function (resolve, reject) {
        if (!obj.data.ids[0]) {
            reject("A count Id must be provided");
            return;
        }

        function fetch() {
            return f.datasource.request({
                method: "GET",
                name: "PhysicalCount",
                client: obj.client,
                id: obj.data.ids[0]
            }, true);
        }

        function process(count) {
            if (!count) {
                return Promise.reject("Physical count not found");
            }

            if (!count.isActive) {
                return Promise.reject("Physical count is not active");
            }

            count.tags = count.tags.filter((tag) => tag.isRecount);

            if (!count.tags.length) {
                return Promise.reject("No tags flagged for recount");
            }

            return f.datasource.printPdfForm(
                obj.data.form,
                count,
                count.number,
                obj.client.currentUser(),
                {},
                obj.client.tenant()
            );
        }

        Promise.resolve().then(
            fetch
        ).then(
            process
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doPrintRecount",
    doPrintRecount
);