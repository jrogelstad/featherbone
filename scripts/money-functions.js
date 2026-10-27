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

    /*
        PL/pgSQL, so the common cases return before any query runs: a
        settled value, or no value, costs a field test. The first version
        was one SQL statement that looked the base currency up through
        the currency views on every call, settled or not -- 30 µs a value,
        five seconds for one column of a demo's 109,000 inventory
        transactions, and an inventory drill-down that took a minute
        (John, Oct 2026). The lookups read the tables, not the views.
    */
    const SQL = (
        "CREATE OR REPLACE FUNCTION money_base(" +
        "  m mono, on_date date DEFAULT NULL) " +
        "RETURNS numeric AS $$ " +
        "DECLARE " +
        "  until timestamptz; " +
        "  base_code text; " +
        "  base_minor integer; " +
        "  from_code text; " +
        "  rate numeric; " +
        "BEGIN " +
        "  IF m IS NULL OR (m).amount IS NULL THEN " +
        "    RETURN NULL; " +
        "  END IF; " +
        "  IF (m).effective IS NOT NULL AND (m).base_amount IS NOT NULL THEN " +
        "    RETURN (m).base_amount; " +
        "  END IF; " +
        "  IF (m).currency IS NULL THEN " +
        "    RETURN (m).amount; " +
        "  END IF; " +

        // The base currency in force by the end of the day, or the
        // earliest there is for a day before them all.
        "  until := (COALESCE(on_date, current_date) + 1)::timestamptz; " +
        "  SELECT c.code, c.minor_unit INTO base_code, base_minor " +
        "  FROM base_currency bc " +
        "  JOIN currency c ON c._pk = bc._currency_currency_pk " +
        "  WHERE NOT bc.is_deleted " +
        "  ORDER BY (bc.effective <= until) DESC, " +
        "    CASE WHEN bc.effective <= until THEN bc.effective END DESC, " +
        "    bc.effective ASC " +
        "  LIMIT 1; " +
        "  IF base_code IS NULL OR (m).currency = base_code THEN " +
        "    RETURN (m).amount; " +
        "  END IF; " +

        // The latest rate between the two on or before the day.
        "  SELECT fc.code, cc.ratio INTO from_code, rate " +
        "  FROM currency_conversion cc " +
        "  JOIN currency fc ON fc._pk = cc._from_currency_currency_pk " +
        "  JOIN currency tc ON tc._pk = cc._to_currency_currency_pk " +
        "  WHERE NOT cc.is_deleted " +
        "    AND fc.code IN ((m).currency, base_code) " +
        "    AND tc.code IN ((m).currency, base_code) " +
        "    AND cc.effective < until " +
        "  ORDER BY cc.effective DESC " +
        "  LIMIT 1; " +
        "  IF rate IS NULL OR rate = 0 THEN " +
        "    RETURN NULL; " +
        "  END IF; " +
        "  IF from_code = base_code THEN " +
        "    RETURN round((m).amount / rate, COALESCE(base_minor, 2)); " +
        "  END IF; " +
        "  RETURN round((m).amount * rate, COALESCE(base_minor, 2)); " +
        "END; " +
        "$$ LANGUAGE plpgsql STABLE;"
    );

    exports.execute = async function (obj) {
        await obj.client.query(SQL);
    };

}(exports));
