/*
    common/string.js: String.prototype helpers used everywhere to map
    feather/property names between camelCase (client, API), snake_case
    (database columns), spinal-case (URLs) and display names.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

require(path.join(__dirname, "..", "..", "common", "string.js"));

// [input, toCamelCase(), toCamelCase(true), toSnakeCase(), toSpinalCase(),
//  toProperCase(), toName()]
const TABLE = [
    ["contact_name", "contactName", "ContactName", "contact_name",
            "contact_name", "Contact_name", "Contact Name"],
    ["contact-name", "contactName", "ContactName", "contact-name",
            "contact-name", "Contact-name", "Contact Name"],
    ["contactName", "contactName", "ContactName", "contact_name",
            "contact-name", "Contact Name", "Contact Name"],
    ["foo__bar", "fooBar", "FooBar", "foo__bar", "foo__bar", "Foo__bar",
            "Foo Bar"],
    ["customerID", "customerID", "CustomerID", "customer_id", "customer-id",
            "Customer ID", "Customer ID"],
    ["already-camel_Case", "alreadyCamelCase", "AlreadyCamelCase",
            "already-camel_case", "already-camel_case", "Already-camel_Case",
            "Already Camel Case"],
    ["SalesOrderLine", "salesOrderLine", "SalesOrderLine",
            "sales_order_line", "sales-order-line", "Sales Order Line",
            "Sales Order Line"],
    ["", "", "", "", "", "", ""]
];

describe("common/string.js", function () {
    TABLE.forEach(function (row) {
        it("converts " + JSON.stringify(row[0]), function () {
            let s = row[0];
            assert.deepEqual([
                s.toCamelCase(),
                s.toCamelCase(true),
                s.toSnakeCase(),
                s.toSpinalCase(),
                s.toProperCase(),
                s.toName()
            ], row.slice(1));
        });
    });

    it("keeps runs of capitals together (acronyms are not split)",
            function () {
        // Only a lower->upper boundary inserts a separator
        assert.equal("URLValue".toSnakeCase(), "urlvalue");
        assert.equal("URLValue".toSpinalCase(), "urlvalue");
        assert.equal("URLValue".toProperCase(), "URLValue");
        assert.equal("URLValue".toCamelCase(), "uRLValue");
        assert.equal("HTMLParser".toName(), "H TMLParser");
        assert.equal("ID".toCamelCase(), "iD");
        assert.equal("ID".toSnakeCase(), "id");
    });

    it("toName turns a dot path into a display name", function () {
        assert.equal("contact.name".toName(), "Contact Name");
        assert.equal("contact.address.city".toName(), "Contact Address City");
        assert.equal("a.b".toName(), "A B");
        assert.equal("billTo.address.postalCode".toName(),
                "Bill To Address Postal Code");
    });

    it("treats a comma as a word separator in toCamelCase", function () {
        // The regex class is [_,-] (comma included), pinned as-is
        assert.equal("a,b".toCamelCase(), "aB");
    });

    it("round trips feather names between API and database forms",
            function () {
        ["purchaseOrderLine", "currencyUnitConversion", "isDeleted"].forEach(
            function (name) {
                assert.equal(name.toSnakeCase().toCamelCase(), name);
                assert.equal(name.toSpinalCase().toCamelCase(), name);
            }
        );
        assert.equal(
            "PurchaseOrder".toSpinalCase().toCamelCase(true),
            "PurchaseOrder"
        );
    });

    it("returns primitives, not String objects", function () {
        assert.equal(typeof "abc".toCamelCase(), "string");
        assert.equal(typeof "abc".toSnakeCase(), "string");
        assert.equal(typeof "abc".toName(), "string");
    });

    it("keeps the first letter when the string starts with a separator",
            {todo: "defect: '_foo'.toCamelCase() drops 'f' and yields '_oo'"},
            function () {
        // common/string.js: first char is taken from the original string,
        // rest from the replaced one, so a leading separator eats a letter
        assert.equal("_foo".toCamelCase(), "foo");
    });

    it("pins current output for a leading separator", function () {
        assert.equal("_foo".toSnakeCase(), "_foo");
        assert.equal("_foo".toProperCase(), "_foo");
    });
});
