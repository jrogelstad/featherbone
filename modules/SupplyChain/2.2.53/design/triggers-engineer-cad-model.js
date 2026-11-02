/*jslint unordered*/
/*global f*/
/**
  EngineerCadModel handler

  An engineering drawing is a 3D model that belongs to a product. Two
  things follow from saving one:

  - Its engineering bill of material (`ebom`) is read from the tree the
    model holds: a line for each part or assembly the file names, which an
    engineer maps to a product (a product whose number is exactly the
    line's name is mapped for them). The lines are a tree, each with its
    `level` (0 for the first). The first level is marked `sync` when it
    is first read; the engineer can mark the others.
  - The product's drawing link points to it. Taking a product's drawing
    over from another is asked about on the client, before the save; the
    server links the drawing it is given.
*/
const EBOM_PATH_SEPARATOR = " / ";

function isBody(node) {
    return node && node.body === true;
}

function nameOf(node) {
    // The file's own name, not the one made unique for the viewer
    return String(node.source_name || node.name || "").trim();
}

function partsOf(node) {
    return (
        Array.isArray(node.parts)
        ? node.parts.filter((p) => p && !isBody(p))
        : []
    );
}

/*
    The lines of an engineering bill of material for a shapes tree.

    One line for each part and assembly, with the assemblies above it as
    its path and the count of them as its level. Parts of the same name
    at the same place are one line and a quantity ("Knob", "Knob (2)" are
    two Knobs). The solids a part is made of are not lines. The file's top
    assembly, and the wrapper the
    importer puts around it, are the product itself and not part of it, so
    the tree is entered below them.
*/
function ebomRows(tree) {
    let rows = new Map();
    let start = tree;
    let kids = partsOf(start);
    let order = 0;

    function walk(node, path, depth) {
        partsOf(node).forEach(function (child) {
            let name = nameOf(child);
            let below = partsOf(child);
            let key = path + "\n" + name;
            let row = rows.get(key);

            if (!name) {
                return;
            }
            if (row) {
                row.quantity += 1;
            } else {
                order += 1;
                rows.set(key, {
                    isAssembly: below.length > 0,
                    level: depth,
                    name,
                    quantity: 1,
                    sequence: order,
                    treePath: path
                });
            }
            if (below.length) {
                walk(child, (
                    path
                    ? path + EBOM_PATH_SEPARATOR + name
                    : name
                ), depth + 1);
            }
        });
    }

    while (
        kids.length === 1 &&
        partsOf(kids[0]).length
    ) {
        start = kids[0];
        kids = partsOf(start);
    }
    walk(start, "", 0);

    return Array.from(rows.values());
}

/*
    Product ids by number, for the numbers that are one exactly.
*/
async function productsByNumber(client, numbers) {
    let found = {};
    let resp;

    if (!numbers.length) {
        return found;
    }
    resp = await client.query(
        "SELECT id, number FROM product " +
        "WHERE number = ANY($1::text[]) AND NOT is_deleted",
        [numbers]
    );
    resp.rows.forEach(function (row) {
        found[row.number] = row.id;
    });

    return found;
}

function hasProduct(line) {
    return Boolean(line.product && line.product.id);
}

/*
    The lines for a model, kept from the lines there were.
*/
function ebomLines(model, current) {
    let byKey = new Map();
    let lines = [];
    let rows = [];

    if (model) {
        try {
            rows = ebomRows(JSON.parse(model));
        } catch (e) {
            throw new Error(
                "The model could not be read for its bill of material: " +
                (e.message || e)
            );
        }
    }

    current.forEach(function (line) {
        let key = (line.treePath || "") + "\n" + line.name;
        let same = byKey.get(key) || [];

        same.push(line);
        byKey.set(key, same);
    });

    rows.forEach(function (row) {
        let key = row.treePath + "\n" + row.name;
        let same = byKey.get(key) || [];
        let line = same.shift();

        if (line) {
            Object.assign(line, {
                isAssembly: row.isAssembly,
                isInModel: true,
                level: row.level,
                quantity: row.quantity,
                sequence: row.sequence
            });
        } else {
            // Only the first level is synchronized, until someone says more
            line = Object.assign({
                id: f.createId(),
                isInModel: true,
                sync: row.level === 0
            }, row);
        }
        lines.push(line);
    });

    // What the tree no longer names, after what it does
    byKey.forEach(function (same) {
        same.forEach(function (line) {
            line.isInModel = false;
            line.sequence = lines.length + 1;
            lines.push(line);
        });
    });

    return lines;
}

/*
    Make the lines of the bill of material match the model's tree. A
    line the tree still names keeps its product; a new one is mapped by
    number when it can be; one the tree no longer names stays, marked,
    so no one's mapping is lost to a re-import.
*/
async function doEbomBefore(obj) {
    let rec = obj.newRec;
    let old = obj.oldRec;
    let current = (
        Array.isArray(rec.ebom)
        ? rec.ebom
        : []
    );
    let isNewModel = (
        old
        ? old.model !== rec.model
        : Boolean(rec.model)
    );
    let lines = current;
    let unmapped;
    let found;
    let selfId = (
        rec.product
        ? rec.product.id
        : undefined
    );

    if (isNewModel) {
        lines = ebomLines(rec.model, current);
    }

    // A product may have been made since the line was
    unmapped = lines.filter(
        (line) => line.isInModel !== false && !hasProduct(line)
    );
    if (!isNewModel && !unmapped.length) {
        return;
    }
    found = await productsByNumber(
        obj.client,
        Array.from(new Set(unmapped.map((line) => line.name)))
    );
    unmapped.forEach(function (line) {
        // The drawing is of that product; it is not made of itself
        if (found[line.name] && found[line.name] !== selfId) {
            line.product = {id: found[line.name]};
        }
    });

    rec.ebom = lines;
}

f.datasource.registerFunction(
    "POST",
    "EngineerCadModel",
    doEbomBefore,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "EngineerCadModel",
    doEbomBefore,
    f.datasource.TRIGGER_BEFORE
);

/*
    The drawing a product has, if any, with what is needed to tell a
    newer revision of the same drawing from another drawing.
*/
async function drawingOf(client, productId) {
    let resp = await client.query(
        "SELECT p.number, rs.id, rs.display_value, rs.label, " +
        "  ecm.revision, ep.id AS product_id " +
        "FROM product p " +
        "JOIN resource_link rs ON rs._pk = p._drawing_link_resource_link_pk " +
        "LEFT JOIN engineer_cad_model ecm ON ecm._pk = rs._pk " +
        "LEFT JOIN product ep ON ep._pk = ecm._product_product_pk " +
        "WHERE p.id = $1 AND NOT rs.is_deleted",
        [productId]
    );

    return resp.rows[0];
}

/*
    Point a product's drawing link at the model, or take it off the
    product when it is still pointing at the model. This is the drawing's
    to do whatever the engineer may do to the product itself.
*/
async function linkProduct(obj, productId, modelId, isLinking) {
    let has;

    if (!isLinking) {
        has = await drawingOf(obj.client, productId);
        if (!has || has.id !== modelId) {
            return;
        }
    }

    await f.datasource.request({
        client: obj.client,
        data: [{
            op: "add",
            path: "/drawingLink",
            value: (
                isLinking
                ? {id: modelId}
                : null
            )
        }],
        id: productId,
        method: "PATCH",
        name: "Product",
        user: obj.client.currentUser()
    }, true);
}

async function doDrawingAfter(obj) {
    let rec = obj.newRec;
    let old = obj.oldRec;
    let productId = (
        rec.product
        ? rec.product.id
        : undefined
    );
    let oldId = (
        (old && old.product)
        ? old.product.id
        : undefined
    );

    if (productId === oldId) {
        return;
    }
    if (oldId) {
        await linkProduct(obj, oldId, rec.id, false);
    }
    if (productId) {
        await linkProduct(obj, productId, rec.id, true);
    }
}

f.datasource.registerFunction(
    "POST",
    "EngineerCadModel",
    doDrawingAfter,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "EngineerCadModel",
    doDrawingAfter,
    f.datasource.TRIGGER_AFTER
);

/*
    A product is not left pointing at a drawing that is gone.
*/
async function doDelete(obj) {
    let old = obj.oldRec;

    if (old && old.product && old.product.id) {
        await linkProduct(obj, old.product.id, old.id, false);
    }
}

f.datasource.registerFunction(
    "DELETE",
    "EngineerCadModel",
    doDelete,
    f.datasource.TRIGGER_BEFORE
);
