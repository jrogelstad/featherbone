/*jslint devel unordered*/
const DIR = "./files/downloads/";
const readFileSync = "readFileSync"; // Lint dogma
const pdfLib = () => f.PdfLib || missingLibrary();
const writeFileSync = "writeFileSync";
const PAGE_WIDTH = 288; // 4 x 6 inch label
const PAGE_HEIGHT = 432;
const fs = f.Fs;

// Raised when a print is asked for and pdf-lib was not loaded, rather than
// when the server starts, so the rest of the module still loads
function missingLibrary() {
    throw (
        "The pdf-lib library is not loaded. Install the SupplyChain " +
        "package so it can install its libraries, or run npm install " +
        "pdf-lib in the Featherbone folder, then restart the server."
    );
}

function printLabels(obj) {
    return new Promise(function (resolve, reject) {
        let shipments = obj.data.shipment;
        let woLabels;
        let eKey = f.createId();

        if (!obj.data.shipmentIds) {
            reject("No shipmentIds passed");
            return;
        }

        function getShipments() {
            return f.datasource.request({
                method: "GET",
                name: "Shipment",
                properties: [
                    "id",
                    "labelId",
                    "labelUrl",
                    "labelVoid",
                    "shipMethod"
                ],
                client: obj.client,
                filter: {
                    criteria: [{
                        property: "id",
                        operator: "IN",
                        value: obj.data.shipmentIds
                    }, {
                        property: "shipMethod.objectType",
                        value: "ShipEngineService"
                    }]
                }
            }, true);
        }

        async function lockShipments(resp) {
            shipments = resp;
            let n = 0;
            while (n < shipments.length) {
                if (!shipments[n].labelId || shipments[n].labelVoid) {
                    await f.datasource.lock(
                        shipments[n].id,
                        obj.client.currentUser(),
                        eKey,
                        "Printing ship label",
                        obj.client
                    );
                }
                n += 1;
            }
        }

        function getLabels() {
            return new Promise(function (resolve, reject) {
                let requests = [];

                function callback(labels) {
                    let idx = 0;

                    while (idx < woLabels.length) {
                        woLabels[idx].labelId = labels[idx].labelId;
                        woLabels[idx].labelUrl = labels[idx].labelDownload.pdf;
                        idx += 1;
                    }

                    resolve();
                }

                if (!shipments.length) {
                    resolve();
                }

                woLabels = shipments.filter((s) => !s.labelId || s.labelVoid);
                woLabels.forEach(function (shipment) {
                    requests.push(f.datasource.request({
                        method: "POST",
                        name: "doCreateShipmentLabel",
                        client: obj.client,
                        eventKey: eKey,
                        data: {shipmentId: shipment.id}
                    }, true));
                });

                Promise.all(requests).then(callback).catch(reject);
            });
        }

        function downloadPdfs() {
            let requests = [];
            shipments.forEach(function (shipment) {
                let dl = new f.DownloaderHelper(shipment.labelUrl, DIR);
                let idx = shipment.labelUrl.lastIndexOf("/") + 1;
                let name = shipment.labelUrl.slice(idx);
                let download = function () {
                    return new Promise(function (resolve, reject) {
                        dl.on("end", resolve);
                        dl.on("error", reject);
                        dl.start();
                    });
                };
                shipment.labelName = name;
                requests.push(download());
            });

            return Promise.all(requests);
        }

        // One label to a page. A label that is not the page's size is
        // scaled down to fit, from the top left, as it always was.
        async function printPdf() {
            let doc = await pdfLib().PDFDocument.create();
            let file = f.createId() + ".pdf";
            let paths = shipments.map((shpmt) => DIR + shpmt.labelName);
            let n = 0;
            let src;
            let label;
            let page;
            let scale;

            try {
                while (n < paths.length) {
                    src = await pdfLib().PDFDocument.load(
                        fs[readFileSync](paths[n])
                    );
                    n += 1;
                    label = (await doc.embedPdf(src, [0]))[0];
                    scale = Math.min(
                        1,
                        PAGE_WIDTH / label.width,
                        PAGE_HEIGHT / label.height
                    );
                    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
                    page.drawPage(label, {
                        x: 0,
                        y: PAGE_HEIGHT - label.height * scale,
                        width: label.width * scale,
                        height: label.height * scale
                    });
                }

                fs[writeFileSync](DIR + file, await doc.save());
            } finally {
                // Remove label files
                paths.forEach(function (filePath) {
                    fs.unlink(filePath, () => true);
                });
            }

            return file;
        }

        Promise.resolve().then(
            getShipments
        ).then(
            lockShipments
        ).then(
            getLabels
        ).then(
            downloadPdfs
        ).then(
            printPdf
        ).then(
            resolve
        ).catch(
            reject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doPrintShipmentLabels",
    printLabels
);