-- @featherbone-dev-script v1
-- @name      Sales regions (US census regions, all states)
-- @target    instance
--
-- Puts back SalesRegion / SalesRegionState: Northeast, Midwest, South and West over
-- all fifty states and DC. The demo data file loads the same rows; this is for an
-- instance that already has the demo data and has lost them. Insert only, and it
-- stops if any region exists, so it cannot double up.
--
--   npm run dev:load -- --script scripts/dev/demo-data/sales-regions.sql --db demo
--   psql -d demo -f scripts/dev/demo-data/sales-regions.sql

\set ON_ERROR_STOP on
BEGIN;

DO $guard$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "$db" WHERE kind = 'instance') THEN
        RAISE EXCEPTION 'Not a Featherbone instance database.';
    END IF;
    IF to_regclass('public.sales_region') IS NULL OR to_regclass('public.sales_region_state') IS NULL THEN
        RAISE EXCEPTION 'SalesRegion is not installed here.';
    END IF;
    IF EXISTS (SELECT 1 FROM ONLY public.sales_region) OR EXISTS (SELECT 1 FROM ONLY public.sales_region_state) THEN
        RAISE EXCEPTION 'Sales regions already exist; nothing loaded.';
    END IF;
END
$guard$;

WITH r(code, description, states) AS (VALUES
    ('NORTHEAST', 'Northeast', 'CT ME MA NH RI VT NJ NY PA'),
    ('MIDWEST',   'Midwest',   'IL IN MI OH WI IA KS MN MO NE ND SD'),
    ('SOUTH',     'South',     'DE FL GA MD NC SC VA DC WV AL KY MS TN AR LA OK TX'),
    ('WEST',      'West',      'AZ CO ID MT NV NM UT WY AK CA HI OR WA')),
ins AS (
    INSERT INTO sales_region (id, created, created_by, updated, updated_by, is_deleted, owner, etag, code, description, note)
    SELECT substr(md5('fbregion' || code), 1, 12), now(), 'admin', now(), 'admin', false,
           'admin', substr(md5('etgregion' || code), 1, 12), code, description, ''
    FROM r
    RETURNING _pk, code)
INSERT INTO sales_region_state (id, created, created_by, updated, updated_by, is_deleted, state, _region_sales_region_pk)
SELECT substr(md5('fbregionstate' || s), 1, 12), now(), 'admin', now(), 'admin', false, s, ins._pk
FROM ins JOIN r USING (code), unnest(string_to_array(r.states, ' ')) AS s;

DO $check$
DECLARE v_r bigint; v_s bigint;
BEGIN
    SELECT count(*) INTO v_r FROM ONLY public.sales_region;
    SELECT count(*) INTO v_s FROM ONLY public.sales_region_state;
    IF v_r <> 4 OR v_s <> 51 THEN RAISE EXCEPTION 'Expected 4 regions and 51 states, got % and %', v_r, v_s; END IF;
    RAISE NOTICE 'Loaded % sales regions covering % states.', v_r, v_s;
END
$check$;

COMMIT;
