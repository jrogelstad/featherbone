/*jslint browser devel*/
const catalog = f.catalog();
const jsSettings = catalog.store().models().jobShopSettings() || {};
const module = catalog.store().models().module;
const error = catalog.register("functions").error;
let edition = jsSettings.data.edition() || "Standard";

/*Configure job shop model */
const confOpts = Object.freeze({
    description: "Model to configure edition",
    inherits: "Object",
    isSystem: true,
    name: "ConfigureEdition",
    properties: {
        edition: {
            dataList: [
                {
                    label: "Standard",
                    value: "Standard"
                },
                {
                    label: "Professional",
                    value: "Professional"
                },
                {
                    label: "Enterprise",
                    value: "Enterprise"
                }
            ],
            description: "Edition selection",
            type: "string"
        },
        id: {
            default: "createId()",
            type: "string"
        }
    }
});

catalog.register("feathers", "ConfigureEdition", confOpts);
catalog.registerModel(
    "ConfigureEdition",
    () => f.createModel(undefined, confOpts)
);

const confOptsForm = {
    attrs: [{attr: "edition"}]
};

module.static().configure = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let theModel = f.createModel("ConfigureEdition");
    let vm = f.createViewModel("FormWidget", {
        config: confOptsForm,
        containerId: dialog.ids().dialog,
        id: f.createId(),
        isScrollable: false,
        model: theModel,
        outsideElementIds: [
            dialog.ids().header,
            dialog.ids().buttonOk
        ]
    });
    let widget = f.getComponent("FormWidget");

    theModel.data.edition(edition);

    async function onOk() {
        try {
            await f.datasource().request({
                body: {edition: theModel.data.edition()},
                method: "POST",
                path: "/job-shop/do-configure/"
            });
            window.location.reload();
        } catch (e) {
            error(e);
        }
    }

    dialog.content = () => m(widget, {viewModel: vm});
    dialog.title("Configure Edition");
    dialog.icon("checklist");
    dialog.onOk(onOk);
    dialog.show();
};

let hiders = [
    "BaseCurrency",
    "BillOfLading",
    "BillOfLadingInformation",
    "BillOfLadingOrder",
    "BillOfLadingShipment",
    "ConfigureEdition",
    "Container",
    "ConvertPlannedPurchaseOptions",
    "CurrencyConversion",
    "CurrencyUnit",
    "CurrencyUnitConversion",
    "DataListOption",
    "DataService",
    "Document",
    "Edition",
    "Feather",
    "FeatherAuthorization",
    "FeatherProperty",
    "FeatherOverload",
    "FinalWhereUsed",
    "Form",
    "FormAction",
    "FormAttr",
    "FormAttrAction",
    "FormAttrColumn",
    "FormTab",
    "GanttTimeline",
    "HelpLink",
    "IndentedWhereUsed",
    "IndentedWorkOrder",
    "InventoryPlan",
    "InventoryTrace",
    "ItemIndentedBom",
    "Kind",
    "Layout",
    "Log",
    "Module",
    "ModuleDependency",
    "ModuleNpm",
    "Money",
    "Object",
    "ObjectAuthorization",
    "PlannedOrder",
    "PlannedOperation",
    "ProjectTaskLink",
    "Receipt",
    "ReceiptLine",
    "RelationSearchColumn",
    "RelationWidget",
    "ReportOperationCompletion",
    "Role",
    "RoleMembership",
    "Route",
    "SendMail",
    "Shipment",
    "SystemPrintForm",
    "Script",
    "Style",
    "Tenant",
    "TenantService",
    "Trace",
    "Workbook",
    "WorkbookAuthorization",
    "WorkbookDefaultConfig",
    "WorkbookLocalConfig",
    "WorkbookList",
    "Worksheet",
    "WorksheetAction",
    "WorksheetColumn"
];
if (edition === "Standard") {
    hiders = hiders.concat([
        "LaborResource",
        "MachineResource",
        "Operation",
        "OperationCompletion",
        "OutsideProcess",
        "OutsideProcessShipment",
        "ProductOperation",
        "WorkOrderOperation"
    ]);
}

if (
    edition === "Standard" ||
    edition === "Professional"
) {
    hiders = hiders.concat([
        "InventoryAdjustmentDetail",
        "InventoryLocation",
        "Location",
        "MoveInventory",
        "PhysicalCount",
        "PhysicalCountOptions",
        "PhysicalCountTag",
        "PurchaseOrderReceiptDetail",
        "ReceiptDetail",
        "ShipmentDetail",
        "WorkOrderReceiptDetail"
    ]);
}
f.hiddenFeathers(hiders);
