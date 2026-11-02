/*jslint browser devel*/
/*global console*/

async function doCreate(obj) {
    let d = obj.data;

    let shipments;
    let bol;
    let bolId = f.createId();
    let first;
    let packageNumbers = [];
    let fct = "";
    let infos = [];

    shipments = await f.datasource.request({
        client: obj.client,
        filter: {
            criteria: [{
                operator: "IN",
                property: "id",
                value: d.ids
            }]
        },
        method: "GET",
        name: "SalesOrderShipment"
    }, true);

    if (!shipments.length) {
        return Promise.reject("Shipment(s) not found");
    }

    first = shipments[0];
    shipments.forEach(function (s) {
        packageNumbers = packageNumbers.concat(
            s.containers.map((c) => c.number)
        );

        s.containers.forEach(function (cont) {
            let boxes = cont.quantities.reduce(
                (prev, curr) => prev.plus(curr.boxes),
                0
            );
            let found = infos.find(function (i) {
                return (
                    cont.length === i.length &&
                    cont.width === i.width &&
                    cont.container.id === i.containerItem.id &&
                    (
                        (!cont.freightCode && !i.freightCode) ||
                        (
                            cont.freightCode &&
                            i.freightCode &&
                            cont.freightCode.id === i.freightCode.id
                        )
                    )
                );
            });
            if (found) {
                found.handlingQuantity += 1;
                found.weight = found.weight.plus(cont.weight);
                found.packagingQuantity = found.weight.plus(boxes);
                if (found.packagingQuantity) {
                    found.packagingType = "BOXES";
                }
            } else {
                infos.push({
                    containerItem: cont.container,
                    freightCode: cont.freightCode,
                    handlingQuantity: 1,
                    handlingType: cont.container.number,
                    length: cont.length,
                    packagingQuantity: boxes,
                    packagingType: (
                        boxes
                        ? "BOXES"
                        : ""
                    ),
                    weight: cont.weight,
                    width: cont.width
                });
            }
        });
    });

    // TODO: Need to make this more generic
    // Freight Charge Terms
    switch (first.payMethodType) {
    case "1":
    case "5":
        fct = "Prepaid";
        break;
    case "2":
    case "4":
    case "6":
        fct = "Collect";
        break;
    case "3":
        fct = "3rd Party";
        break;
    }

    bol = {
        billTo: first.freightBillTo,
        carrier: first.carrier,
        date: shipments.shipDate,
        freightChargeTerms: fct,
        id: bolId,
        information: infos.map(function (i) {
            let fc = i.freightCode || {};
            return {
                class: fc.class,
                commodityDescription: fc.description,
                handlingQuantity: i.handlingQuantity,
                handlingType: i.handlingType,
                nmfcNumber: fc.code,
                packageQuantity: i.packageQuantity,
                packageType: i.packageType,
                weight: i.weight
            };
        }),
        orders: shipments.map(function (s) {
            return {
                isPallet: s.containers.some((c) => c.container.isPallet),
                numberOfPackages: s.containers.length,
                orderNumber: (
                    s.salesOrder.number +
                    " - PO#:" + s.salesOrder.purchaseOrder
                ),
                weight: s.shipWeight
            };
        }),
        proNumber: shipments.map((s) => s.trackingNumber).filter(
            (p) => p
        ).join(),
        purchaseOrders: shipments.map(
            (s) => s.salesOrder.purchaseOrder
        ).join(),
        salesOrders: shipments.map((s) => s.salesOrder.number).join(),
        serialNumbers: packageNumbers.join(),
        shipFrom: first.site.address,
        shipTo: first.shipTo,
        shipments: shipments.map(function (s) {
            return {shipment: s};
        })
    };

    await f.datasource.request({
        client: obj.client,
        data: bol,
        method: "POST",
        name: "BillOfLading"
    }, true);

    return bolId;
}

f.datasource.registerFunction(
    "POST",
    "doCreateBillOfLading",
    doCreate
);