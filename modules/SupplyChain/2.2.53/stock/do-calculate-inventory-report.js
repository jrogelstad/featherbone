/*jslint devel */
/*
    Inventory balances at a date, kept as an InventoryValue with one
    InventoryValueDetail per product and site.

    The inventory transactions are the ledger: what was on hand on a date,
    and what it was worth, is the sum of every transaction dated on or
    before it. So a balance at September 30 asked for on October 7 is right
    even after somebody posts a September transaction late -- it is worked
    out from the ledger as it stands, the same way bi.inventory_daily is
    rebuilt and the Inventory Value figure read. Values are in the base
    currency, from money_base at each transaction's date.

    Two kinds, told apart by `isClosing`:

      working  built for a drill-down from the dashboard (or anyone who
               asks for a date). Rebuilt only when the ledger has changed
               since: a working snapshot no transaction dated by then has
               been entered or changed after is reused as is. Older
               working snapshots for the same date and site go when a new
               one is built.

      closing  kept as reported when a period is closed, and never
               rebuilt -- one per date and site. What was posted since
               (a larger key; see below) with a date on or before it is
               what accountants chase a week after month end; the
               Inventory Late Postings figure lists exactly that
               (do-get-inventory-kpis.js).

    Request:  {asOf, siteId, notes, isClosing}; asOf defaults to today, no
              siteId is every site.
    Response: the InventoryValue's id.
*/

const VALUES = [
    ["material_value", "material_cost"],
    ["labor_value", "labor_cost"],
    ["overhead_value", "overhead_cost"],
    ["service_value", "service_cost"],
    ["total_value", "total_cost"]
];

// The base currency in force on the date, for the snapshot's own money.
const BASE_SQL = (
    "SELECT (bc.currency).code AS code FROM _base_currency bc " +
    "WHERE NOT bc.is_deleted " +
    "ORDER BY (bc.effective <= ($1::date + 1)::timestamptz) DESC, " +
    "CASE WHEN bc.effective <= ($1::date + 1)::timestamptz " +
    "THEN bc.effective END DESC, bc.effective ASC LIMIT 1;"
);

// Same site, or both every site.
const SAME_SITE = "v._site_site_pk IS NOT DISTINCT FROM $2::bigint ";

// A base-currency money value dated the snapshot's date. `cur` and
// `date` name the query's parameters for the currency and the date.
function money(expr, cur, date) {
    return (
        "ROW(" + expr + ", " + (cur || "$4") + "::text, " +
        (date || "$1") + "::date::timestamptz, " + expr + ")::mono"
    );
}

async function doCalcInvRpt(obj) {
    let data = obj.data || {};
    let client = obj.client;
    let user = client.currentUser();
    let asOf = data.asOf || f.today();
    let isClosing = data.isClosing === true;
    let sitePk = null;
    let found;
    let base;
    let id = f.createId();
    let header;
    let params;

    try {
        if (data.siteId) {
            found = await client.query(
                "SELECT _pk AS pk FROM site WHERE id = $1 AND NOT is_deleted;",
                [data.siteId]
            );
            if (!found.rows.length) {
                return Promise.reject("Site " + data.siteId + " not found");
            }
            sitePk = found.rows[0].pk;
        }

        if (isClosing) {
            found = await client.query(
                "SELECT id FROM inventory_value v " +
                "WHERE v.as_of = $1::date AND " + SAME_SITE +
                "AND v.is_closing AND NOT v.is_deleted;",
                [asOf, sitePk]
            );
            if (found.rows.length) {
                return Promise.reject(
                    "Inventory value at " + asOf + " was already kept " +
                    "at close" + (
                        sitePk
                        ? " for this site"
                        : ""
                    ) + "; a closing value is not recalculated"
                );
            }
        } else {
            /*
                Reuse a working snapshot the ledger has not moved under:
                no transaction dated by then has been entered since. "Since"
                is told by key, not by timestamp -- every record takes its
                key from one sequence, so a transaction entered after the
                snapshot has a larger one. Timestamps lie in demo data (its
                transactions are stamped with their own, future, dates),
                which made every snapshot look stale and rebuilt it on
                every click (John, Oct 2026). Transactions are never edited
                once posted, so nothing else can move a balance.
            */
            found = await client.query(
                "SELECT v.id FROM inventory_value v " +
                "WHERE v.as_of = $1::date AND " + SAME_SITE +
                "AND NOT v.is_closing AND NOT v.is_deleted " +
                "AND NOT EXISTS (SELECT FROM inventory_transaction t " +
                "  WHERE t._pk > v._pk AND t.date <= v.as_of " +
                "  AND ($2::bigint IS NULL OR t._site_site_pk = $2)) " +
                "ORDER BY v._pk DESC LIMIT 1;",
                [asOf, sitePk]
            );
            if (found.rows.length) {
                return found.rows[0].id;
            }

            // The ledger has moved: the old working ones are wrong now.
            await client.query(
                "DELETE FROM inventory_value_detail d " +
                "USING inventory_value v " +
                "WHERE d._inventory_value_inventory_value_pk = v._pk " +
                "AND v.as_of = $1::date AND " + SAME_SITE +
                "AND NOT v.is_closing;",
                [asOf, sitePk]
            );
            await client.query(
                "DELETE FROM inventory_value v " +
                "WHERE v.as_of = $1::date AND " + SAME_SITE +
                "AND NOT v.is_closing;",
                [asOf, sitePk]
            );
        }

        base = (await client.query(BASE_SQL, [asOf])).rows[0];
        if (!base) {
            return Promise.reject("No base currency");
        }
        params = [asOf, sitePk, user, base.code];

        header = await client.query(
            "INSERT INTO inventory_value (_pk, id, created, created_by, " +
            "updated, updated_by, is_deleted, lock, as_of, notes, " +
            "is_closing, _site_site_pk, " +
            VALUES.map((v) => v[0]).join(", ") + ") " +
            "VALUES (nextval('object__pk_seq'), $5, now(), $3, now(), $3, " +
            "false, null, $1::date, $6, $7, $2::bigint, " +
            VALUES.map(() => money("0")).join(", ") + ") " +
            "RETURNING _pk AS pk;",
            params.concat([id, data.notes || "", isClosing])
        );

        // One row per product and site with anything on hand or any
        // value left, from every transaction dated by then.
        await client.query(
            "INSERT INTO inventory_value_detail (_pk, id, created, " +
            "created_by, updated, updated_by, is_deleted, lock, " +
            "_inventory_value_inventory_value_pk, _site_site_pk, " +
            "_item_item_pk, quantity, " +
            VALUES.map((v) => v[0]).join(", ") + ") " +
            "SELECT nextval('object__pk_seq'), " +
            "substr(md5(random()::text || clock_timestamp()::text), 1, 12), " +
            "now(), $3, now(), $3, false, null, $5::bigint, s.site_pk, " +
            "s.item_pk, s.quantity, " +
            VALUES.map((v) => money("s." + v[0])).join(", ") + " " +
            "FROM (SELECT t._site_site_pk AS site_pk, " +
            "  t._item_item_pk AS item_pk, " +
            "  SUM(COALESCE(t.quantity, 0)) AS quantity, " +
            VALUES.map(function (v) {
                return (
                    "  COALESCE(SUM(money_base(t." + v[1] + ", t.date)), 0) " +
                    "AS " + v[0]
                );
            }).join(", ") + " " +
            "  FROM inventory_transaction t " +
            "  WHERE NOT t.is_deleted AND t.date <= $1::date " +
            "  AND ($2::bigint IS NULL OR t._site_site_pk = $2) " +
            "  GROUP BY 1, 2) s " +
            "WHERE s.quantity <> 0 OR s.total_value <> 0;",
            params.concat([header.rows[0].pk])
        );

        // The header is the sum of its lines.
        await client.query(
            "UPDATE inventory_value v SET " +
            VALUES.map(function (v) {
                return (
                    v[0] + " = " + money(
                        "COALESCE((SELECT SUM((d." + v[0] + ").amount) " +
                        "FROM inventory_value_detail d " +
                        "WHERE d._inventory_value_inventory_value_pk = v._pk)" +
                        ", 0)",
                        "$2",
                        "$1"
                    )
                );
            }).join(", ") + " " +
            "WHERE v._pk = $3::bigint;",
            [asOf, base.code, header.rows[0].pk]
        );

        return id;
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doCalculateInventoryReport",
    doCalcInvRpt
);
