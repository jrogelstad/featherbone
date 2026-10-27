/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint node unordered*/
/*
    money_base(m mono, on_date date DEFAULT NULL) -> numeric

    What a money value is worth in the base currency, by the same rule
    the client's money editor shows it:

      * a value with `effective` set has been settled -- posted,
        received, invoiced -- and its `base_amount` is the answer, at
        whatever rate applied then;
      * a value already in the base currency is its own amount;
      * anything else is converted at the latest rate on or before
        `on_date` (today when null), divided where the rate is stored
        base to foreign and multiplied where it is foreign to base, and
        rounded to the base currency's minor unit -- what
        Services.Currency.convertCurrency does.

    No rate is no answer (NULL), not a zero: a sum that quietly drops a
    currency nobody entered a rate for reads as a smaller business.

    Money is an object precisely so a document can say what it is worth
    in its own currency and in the books' currency at once (John, Oct
    2026). Totals that add up `amount` across documents in different
    currencies, or `base_amount` on values nobody settled (it is empty
    until something sets `effective`), are both wrong; this is the one
    place the rule lives, for list totals here and for whatever a module
    adds up in SQL of its own.

    Created after the feathers, because it reads the currency views.
    CREATE OR REPLACE, so every upgrade re-runs it harmlessly.
*/
(function (exports) {
    "use strict";

    // The base currency in force on a day: the latest one that had taken
    // effect by the end of it, or the earliest there is for a day before
    // them all (Services.Currency.baseCurrency does the same).
    const BASE = (
        "SELECT (bc.currency).code AS code, " +
        "  (bc.currency).minor_unit AS minor " +
        "FROM _base_currency bc, d " +
        "WHERE NOT bc.is_deleted " +
        "ORDER BY (bc.effective <= d.until) DESC, " +
        "  CASE WHEN bc.effective <= d.until THEN bc.effective END DESC, " +
        "  bc.effective ASC " +
        "LIMIT 1"
    );

    const SQL = (
        "CREATE OR REPLACE FUNCTION money_base(" +
        "  m mono, on_date date DEFAULT NULL) " +
        "RETURNS numeric AS $$ " +
        "WITH d AS (SELECT (COALESCE(on_date, current_date) + 1)" +
        "  ::timestamptz AS until), " +
        "b AS (" + BASE + ") " +
        "SELECT CASE " +
        "  WHEN m IS NULL OR (m).amount IS NULL THEN NULL " +
        "  WHEN (m).effective IS NOT NULL AND (m).base_amount IS NOT NULL " +
        "    THEN (m).base_amount " +
        "  WHEN (m).currency IS NULL OR (m).currency = b.code " +
        "    THEN (m).amount " +
        "  ELSE (" +
        "    SELECT round(CASE " +
        "      WHEN (cc.from_currency).code = b.code " +
        "        THEN (m).amount / NULLIF(cc.ratio, 0) " +
        "      ELSE (m).amount * cc.ratio END, b.minor) " +
        "    FROM _currency_conversion cc, d " +
        "    WHERE NOT cc.is_deleted " +
        "      AND (cc.from_currency).code IN ((m).currency, b.code) " +
        "      AND (cc.to_currency).code IN ((m).currency, b.code) " +
        "      AND cc.effective < d.until " +
        "    ORDER BY cc.effective DESC LIMIT 1) " +
        "  END " +
        "FROM b " +
        "UNION ALL SELECT (m).amount WHERE NOT EXISTS (SELECT FROM b) " +
        "LIMIT 1; " +
        "$$ LANGUAGE sql STABLE;"
    );

    exports.execute = async function (obj) {
        await obj.client.query(SQL);
    };

}(exports));
