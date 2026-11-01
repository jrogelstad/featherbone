/*jslint unordered*/
/*global*/
let sql;

async function doIndentBom(obj) {
    let itemId = obj.data.itemId;
    let useEoq = obj.data.useEoq;
    let product = await f.datasource.request({
        method: "GET",
        name: "Product",
        client: obj.client,
        id: itemId,
        properties: [
            "cost",
            "created",
            "createdBy",
            "description",
            "drawingLink",
            "eoq",
            "id",
            "laborCost",
            "materialCost",
            "number",
            "revision",
            "overheadCost",
            "serviceCost",
            "status",
            "unit",
            "updated",
            "updatedBy"
        ]
    }, true);
    let pgClient = obj.client;
    if (!pgClient) {
        let config = await f.datasource.config();
        let creds = {
            host: config.pgHost,
            database: config.pgDatabase,
            user: config.pgUser,
            password: config.pgPassword,
            port: config.pgPort
        };
        pgClient = new f.PgClient(creds);
        await pgClient.connect();
    }
    let indented;

    indented = await pgClient.query(sql, [itemId]);
    if (!obj.client) {
        pgClient.end();
    }

    if (!product) {
        throw ("Product id " + itemId + " not found");
    }

    let bom = indented.rows.filter((r) => r.level === 1);
    let rem = indented.rows.filter((r) => r.level === 2);
    let lvl = 2;
    let ret = [];
    let qty = (
        useEoq
        ? product.eoq
        : 1
    );
    let child;
    let parent;
    let idx;

    function byLevel(r) {
        return r.level === lvl;
    }
    function bySequence(a, b) {
        return a.bom_sequence - b.bom_sequence;
    }
    function byParent(row) {
        return row.child_pk === child.parent_pk;
    }
    bom.sort(bySequence);
    while (rem.length) {
        rem.sort(bySequence);
        while (rem.length) {
            child = rem.pop();
            parent = bom.find(byParent);
            idx = bom.indexOf(parent) + 1;
            bom.splice(idx, 0, child);
        }
        lvl += 1;
        rem = indented.rows.filter(byLevel);
    }

    ret.push({
        created: product.created,
        createdBy: product.createdBy,
        cycle: false,
        drawingLink: product.drawingLink,
        revision: product.revison,
        id: product.id,
        product: {
            id: product.id,
            number: product.number,
            description: product.description,
            status: product.status,
            objectType: "Product"
        },
        fixedQuantity: 0,
        laborCost: product.laborCost,
        level: 0,
        materialCost: product.materialCost,
        overheadCost: product.overheadCost,
        quantityPer: qty,
        ratio: 1,
        serviceCost: product.serviceCost,
        status: product.status,
        totalCost: product.cost,
        type: product.type,
        unit: product.unit,
        updated: product.updated,
        updatedBy: product.updatedBy
    });

    function calcCost(prop, name) {
        let attr = "item_" + name + "_cost";
        let amt = Number(prop[attr]);
        return {
            currency: prop.item_cost_currency,
            amount: amt.times(
                qty
            ).times(
                Number(prop.bom_quantity_per)
            ).plus(
                Number(prop.bom_fixed_quantity)
            ).times(
                Number(prop.bom_ratio)
            )
        };
    }

    bom.forEach(function (row) {
        let dwg = null;
        if (row.product_drawing_id) {
            dwg = {
                id: row.product_drawing_id,
                displayValue: row.product_drawing_display_value,
                resource: row.product_drawing_resource,
                label: row.product_drawing_label,
                icon: row.product_drawing_icon
            };
        }

        ret.push({
            created: row.bom_created.toLocalDateTime(),
            createdBy: row.bom_created_by,
            cycle: row.cycle,
            drawingLink: dwg,
            id: row.bom_id,
            product: {
                id: row.item_id,
                number: row.item_number,
                description: row.item_description,
                status: row.item_status,
                objectType: "Product"
            },
            fixedQuantity: Number(row.bom_fixed_quantity),
            laborCost: calcCost(row, "labor"),
            level: row.level,
            materialCost: calcCost(row, "material"),
            overheadCost: calcCost(row, "overhead"),
            quantityPer: Number(row.bom_quantity_per),
            ratio: row.bom_ratio,
            serviceCost: calcCost(row, "service"),
            status: row.item_status,
            totalCost: calcCost(row, "total"),
            type: row.item_type,
            unit: {
                id: row.bom_unit_id,
                code: row.bom_unit_code,
                description: row.bom_unit_description
            },
            updated: row.bom_updated.toLocalDateTime(),
            updatedBy: row.bom_updated_by
        });
    });

    return ret;
}

f.datasource.registerFunction(
    "POST",
    "doIndentedBillOfMaterial",
    doIndentBom
);

sql = (
    "WITH RECURSIVE bom( " +
    "pk, " +
    "parent_pk, " +
    "child_pk, " +
    "level, " +
    "bom_created, " +
    "bom_created_by, " +
    "bom_fixed_quantity, " +
    "bom_id," +
    "bom_quantity_per, " +
    "bom_ratio, " +
    "bom_sequence, " +
    "bom_unit_id, " +
    "bom_unit_code, " +
    "bom_unit_description, " +
    "bom_updated, " +
    "bom_updated_by, " +
    "item_id, " +
    "item_cost_currency, " +
    "item_description, " +
    "item_labor_cost, " +
    "item_material_cost, " +
    "item_number, " +
    "item_overhead_cost, " +
    "item_service_cost, " +
    "item_type, " +
    "item_status, " +
    "item_total_cost, " +
    "product_drawing_id, " +
    "product_drawing_display_value, " +
    "product_drawing_icon, " +
    "product_drawing_label, " +
    "product_drawing_resource, " +
    "product_revision, " +
    "path, " +
    "cycle " +
    ") AS ( " +
    "SELECT  " +
    "bi._pk, " +
    "bi._product_product_pk, " +
    "item._pk, " +
    "1, " +
    "bi.created, " +
    "bi.created_by, " +
    "bi.fixed_quantity, " +
    "bi.id, " +
    "bi.quantity_per, " +
    "bi.ratio, " +
    "bi.sequence, " +
    "u.id, " +
    "u.code, " +
    "u.description, " +
    "bi.updated, " +
    "bi.updated_by, " +
    "item.id, " +
    "(item.cost).currency, " +
    "item.description, " +
    "(item.labor_cost).amount, " +
    "(item.material_cost).amount, " +
    "item.number, " +
    "(item.overhead_cost).amount, " +
    "(item.service_cost).amount, " +
    "item.type, " +
    "item.status, " +
    "(item.cost).amount, " +
    "rs.id, " +
    "rs.display_value, " +
    "rs.icon, " +
    "rs.label, " +
    "rs.resource, " +
    "COALESCE(product.revision, ''), " +
    "ARRAY[bi._pk], " +
    "false " +
    "FROM product_bill_of_material_item bi, item_unit u, product, item " +
    "LEFT JOIN product dp ON dp._pk = item._pk " +
    "LEFT JOIN resource_link rs ON " +
    "     dp._drawing_link_resource_link_pk = rs._pk " +
    "WHERE item._pk = bi._item_item_pk " +
    "    AND product._pk = bi._product_product_pk " +
    "    AND bi._unit_item_unit_pk = u._pk " +
    "    AND NOT bi.is_deleted " +
    "    AND product.id = $1 " +
    "UNION " +
    "SELECT  " +
    "bi._pk, " +
    "bi._product_product_pk, " +
    "item._pk, " +
    "bom.level + 1, " +
    "bi.created, " +
    "bi.created_by, " +
    "bi.fixed_quantity, " +
    "bi.id, " +
    "bi.quantity_per, " +
    "bi.ratio, " +
    "bi.sequence, " +
    "u.id, " +
    "u.code, " +
    "u.description, " +
    "bi.updated, " +
    "bi.updated_by, " +
    "item.id, " +
    "(item.cost).currency, " +
    "item.description, " +
    "(item.labor_cost).amount, " +
    "(item.material_cost).amount, " +
    "item.number, " +
    "(item.overhead_cost).amount, " +
    "(item.service_cost).amount, " +
    "item.type, " +
    "item.status, " +
    "(item.cost).amount, " +
    "rs.id, " +
    "rs.display_value, " +
    "rs.icon, " +
    "rs.label, " +
    "rs.resource, " +
    "COALESCE(product.revision, ''), " +
    "bom.path || bi._pk, " +
    "bi._pk = ANY(bom.path) " +
    "FROM bom, product_bill_of_material_item bi, item_unit u, item " +
    "LEFT JOIN product ON product._pk = item._pk " +
    "LEFT JOIN resource_link rs ON " +
    "  item._drawing_link_resource_link_pk = rs._pk  " +
    "WHERE item._pk = bi._item_item_pk " +
    "  AND bi._unit_item_unit_pk = u._pk " +
    "  AND bi._product_product_pk = bom.child_pk " +
    "  AND NOT bi.is_deleted " +
    "  AND NOT cycle " +
    ") SELECT * FROM bom "
);