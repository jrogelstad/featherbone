/*jslint devel browser this unordered*/
/*global printJS*/
const catalog = f.catalog();
const store = catalog.store();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;

/**
    Ship Engine Carrier
*/
function seCarrier(data, feather) {
    feather = feather || catalog.getFeather("ShipEngineCarrier");
    let model = f.createModel(data, feather);
    let d = model.data;

    model.onLoad(function () {
        let ro = [
            "code",
            "description"
        ];
        ro.forEach(function (attr) {
            if (d[attr]) {
                d[attr].isReadOnly(true);
            }
        });
    });

    return model;
}

catalog.registerModel("ShipEngineCarrier", seCarrier);

seCarrier.static().import = function (viewModel) {
    let dialog = viewModel.confirmDialog();

    function importCarriers() {
        return new Promise(function (resolve, reject) {
            let payload = {
                method: "POST",
                path: "/ship-engine/import-carriers",
                body: {
                    subscription: {
                        id: f.createId(),
                        eventKey: catalog.eventKey()
                    }
                }
            };

            f.datasource().request(payload).then(resolve).catch(reject);
        });
    }

    importCarriers().catch(
        error.bind(null, dialog)
    );
};

/**
    Ship Engine Service
*/
function seService(data, feather) {
    feather = feather || catalog.getFeather("ShipEngineService");
    let model = f.createModel(data, feather);
    let d = model.data;

    model.onLoad(function () {
        let ro = [
            "code",
            "description",
            "serviceCode",
            "international",
            "domestic",
            "isMultiPackageSupported"
        ];
        ro.forEach(function (attr) {
            if (d[attr]) {
                d[attr].isReadOnly(true);
            }
        });
        let parent = model.parent();
        let ps = (
            parent
            ? parent.data.packages()
            : []
        );
        d.packageType.filter().criteria.push({
            property: "id",
            operator: "IN",
            value: ps.map((p) => p.id())
        });
    });

    return model;
}

catalog.registerModel("ShipEngineService", seService);