/*jslint unordered*/
/*global*/

let sql;

async function doIndentWhereUsed(obj) {
    let itemId = obj.data.itemId;
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

    let bom = indented.rows.filter((r) => r.level === 0);
    let rem = indented.rows.filter((r) => r.level === 1);
    let lvl = 1;
    let ret = [];
    let child;
    let parent;
    let idx;

    function byLevel(r) {
        return r.level === lvl;
    }
    function byNumber(a, b) {
        if (a.item_number > b.item_number) {
            return 1;
        } else {
            return -1;
        }
    }
    function byParent(row) {
        return row.child_pk === child.parent_pk;
    }
    bom.sort(byNumber);

    while (rem.length) {
        rem.sort(byNumber);
        while (rem.length) {
            child = rem.pop();
            parent = bom.find(byParent);
            idx = bom.indexOf(parent) + 1;
            bom.splice(idx, 0, child);
        }
        lvl += 1;
        rem = indented.rows.filter(byLevel);
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
                isSold: row.item_is_sold,
                status: row.item_status,
                objectType: "Product"
            },
            fixedQuantity: Number(row.bom_fixed_quantity),
            level: row.level,
            quantityPer: Number(row.bom_quantity_per),
            ratio: row.bom_ratio,
            status: row.item_status,
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

    if (obj.data.flatten) {
        bom = ret.slice();
        ret.length = 0;
        bom.forEach(function (row) {
            if (
                row.product.isSold &&
                !ret.find((r) => row.product.id === r.product.id)
            ) {
                ret.push(row);
            }
        });
        ret.sort(function (a, b) {
            if (a.product.number > b.product.number) {
                return 1;
            } else {
                return -1;
            }
        });
    }

    return ret;
}

f.datasource.registerFunction(
    "POST",
    "doIndentedWhereUsed",
    doIndentWhereUsed
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
    "item_description, " +
    "item_number, " +
    "item_type, " +
    "item_status, " +
    "item_is_sold, " +
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
    "product._pk, " +
    "bi._product_product_pk, " +
    "0, " +
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
    "item.description, " +
    "item.number, " +
    "item.type, " +
    "item.status, " +
    "item.is_sold, " +
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
    "WHERE item._pk = bi._product_product_pk " +
    "    AND product._pk = bi._item_item_pk " +
    "    AND bi._unit_item_unit_pk = u._pk " +
    "    AND NOT bi.is_deleted " +
    "    AND product.id = $1 " +
    "UNION " +
    "SELECT  " +
    "bi._pk, " +
    "bom.child_pk, " +
    "bi._product_product_pk, " +
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
    "product.id, " +
    "product.description, " +
    "product.number, " +
    "product.type, " +
    "product.status, " +
    "product.is_sold, " +
    "rs.id, " +
    "rs.display_value, " +
    "rs.icon, " +
    "rs.label, " +
    "rs.resource, " +
    "COALESCE(product.revision, ''), " +
    "bom.path || bi._pk, " +
    "bi._pk = ANY(bom.path) " +
    "FROM bom, product_bill_of_material_item bi, item_unit u, product " +
    "LEFT JOIN resource_link rs ON " +
    "  product._drawing_link_resource_link_pk = rs._pk  " +
    "WHERE product._pk = bi._product_product_pk " +
    "  AND bi._unit_item_unit_pk = u._pk " +
    "  AND bi._item_item_pk = bom.child_pk  " +
    "  AND NOT bi.is_deleted " +
    "  AND NOT cycle " +
    ") SELECT * FROM bom "
);