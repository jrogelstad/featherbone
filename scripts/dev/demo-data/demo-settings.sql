-- @featherbone-dev-script v1
-- @name      Settings (point every setting at a record that exists)
-- @target    instance
--
-- A load clears master data and leaves settings alone, and the rows it creates get new ids
-- each time, so a setting that names one goes stale (the default site did: New Product then
-- failed with `Relation not found in "Site"`). This reads each setting's own definition,
-- finds every property that is a relation, and makes it name a record that exists:
--
--   * names one that exists: its copy of the name, code, title, ... is refreshed;
--   * names one that is missing or deleted: repointed at the record with the same
--     feather and name (forms), code or name, else the only active record (sites);
--   * names nothing and the relation is to master data with one record: that record
--     (the default site). Forms are never guessed.
--
-- load.js runs this after every data script. Run by hand it is the same, and safe to repeat.
-- Stop the server first: it caches settings.
--
--   npm run dev:load -- --allow-prod --script scripts/dev/demo-data/demo-settings.sql --db demo

\set ON_ERROR_STOP on
BEGIN;

DO $guard$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "$db" WHERE kind = 'instance') THEN
        RAISE EXCEPTION 'Not a Featherbone instance database.';
    END IF;
    IF to_regclass('public."$settings"') IS NULL THEN
        RAISE EXCEPTION 'No settings table here.';
    END IF;
END
$guard$;

DO $reconcile$
DECLARE
    s record;
    p record;
    d jsonb;
    cur jsonb;
    found jsonb;
    found_tbl text;
    tbl text;
    shown text[];
    k text;
    col text;
    obj_type text;
    newv jsonb;
    same boolean;
    n int;
    has_feather boolean;
    n_fixed int := 0;
    n_left int := 0;
BEGIN
    FOR s IN
        SELECT name, data::jsonb AS data, definition::jsonb AS def
        FROM "$settings" WHERE name <> 'catalog' AND definition IS NOT NULL ORDER BY name
    LOOP
        d := coalesce(s.data, '{}'::jsonb);

        FOR p IN
            SELECT key, value FROM jsonb_each(s.def->'properties')
            WHERE jsonb_typeof(value->'type') = 'object' AND value->'type' ? 'relation'
            ORDER BY key
        LOOP
            tbl := lower(regexp_replace(p.value->'type'->>'relation', '([a-z0-9])([A-Z])', '\1_\2', 'g'));
            IF to_regclass(format('public.%I', tbl)) IS NULL THEN
                RAISE NOTICE 'Skipped %.%: no table for %.', s.name, p.key, p.value->'type'->>'relation';
                CONTINUE;
            END IF;
            SELECT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'feather')
                INTO has_feather;
            cur := d->p.key;
            IF jsonb_typeof(cur) IS DISTINCT FROM 'object' THEN
                cur := NULL;
            END IF;
            found := NULL;

            -- 1. Does what it names exist?
            IF cur ? 'id' THEN
                EXECUTE format('SELECT to_jsonb(t), t.tableoid::regclass::text FROM public.%I t
                                WHERE t.id = $1 AND NOT t.is_deleted LIMIT 1', tbl)
                    INTO found, found_tbl USING cur->>'id';
            END IF;

            -- 2. If not, the same thing by its natural key
            IF found IS NULL AND cur IS NOT NULL THEN
                col := NULL;
                IF cur ? 'feather' AND cur ? 'name' AND has_feather THEN
                    EXECUTE format('SELECT count(*), min(t.id) FROM public.%I t
                                    WHERE NOT t.is_deleted AND t.name = $1 AND t.feather = $2', tbl)
                        INTO n, col USING cur->>'name', cur->>'feather';
                ELSIF cur ? 'code' THEN
                    EXECUTE format('SELECT count(*), min(t.id) FROM public.%I t
                                    WHERE NOT t.is_deleted AND t.code = $1', tbl)
                        INTO n, col USING cur->>'code';
                ELSIF cur ? 'name' THEN
                    EXECUTE format('SELECT count(*), min(t.id) FROM public.%I t
                                    WHERE NOT t.is_deleted AND t.name = $1', tbl)
                        INTO n, col USING cur->>'name';
                ELSE
                    n := 0;
                END IF;
                IF n = 1 THEN
                    EXECUTE format('SELECT to_jsonb(t), t.tableoid::regclass::text FROM public.%I t
                                    WHERE t.id = $1', tbl) INTO found, found_tbl USING col;
                END IF;
            END IF;

            -- 3. Master data with one record: that one, whether it named one or nothing
            IF found IS NULL AND NOT has_feather THEN
                EXECUTE format('SELECT count(*), min(t.id) FROM public.%I t WHERE NOT t.is_deleted', tbl)
                    INTO n, col;
                IF n = 1 THEN
                    EXECUTE format('SELECT to_jsonb(t), t.tableoid::regclass::text FROM public.%I t
                                    WHERE t.id = $1', tbl) INTO found, found_tbl USING col;
                END IF;
            END IF;

            IF found IS NULL THEN
                IF cur IS NOT NULL THEN
                    n_left := n_left + 1;
                    RAISE NOTICE 'Unresolved: %.% names "%" (%), and nothing matches it.',
                        s.name, p.key, coalesce(cur->>'name', cur->>'code'), cur->>'id';
                END IF;
                CONTINUE;
            END IF;

            -- Is what it holds already right? Compare the id and the copied fields.
            SELECT coalesce(array_agg(x), '{}') INTO shown
            FROM jsonb_array_elements_text(coalesce(p.value->'type'->'properties', '[]'::jsonb)) x;
            same := cur IS NOT NULL AND cur->>'id' = found->>'id';
            IF same THEN
                FOREACH k IN ARRAY shown LOOP
                    col := lower(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g'));
                    IF coalesce(cur->>k, '') IS DISTINCT FROM coalesce(found->>col, '') THEN
                        same := false;
                    END IF;
                END LOOP;
            END IF;
            CONTINUE WHEN same;

            SELECT f.name INTO obj_type FROM public.feather f
            WHERE NOT f.is_deleted AND lower(regexp_replace(f.name, '([a-z0-9])([A-Z])', '\1_\2', 'g')) = found_tbl
            LIMIT 1;
            newv := jsonb_build_object('id', found->>'id');
            FOREACH k IN ARRAY shown LOOP
                col := lower(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g'));
                IF found ? col THEN
                    newv := newv || jsonb_build_object(k, found->col);
                END IF;
            END LOOP;
            newv := newv || jsonb_build_object('objectType', coalesce(obj_type, ''));
            d := jsonb_set(d, ARRAY[p.key], newv);
            n_fixed := n_fixed + 1;
            RAISE NOTICE '%: %.% % -> % (%)',
                CASE WHEN cur IS NULL THEN 'Set' WHEN cur->>'id' = found->>'id' THEN 'Refreshed' ELSE 'Repointed' END,
                s.name, p.key, coalesce(cur->>'id', '(nothing)'), found->>'id',
                coalesce(found->>'name', found->>'code');
        END LOOP;

        -- Keys the definition no longer has: left alone, but said.
        FOR k IN SELECT key FROM jsonb_object_keys(d) key
                 WHERE key <> 'objectType' AND NOT (s.def->'properties' ? key) LOOP
            RAISE NOTICE 'Note: % holds "%", which is not one of its properties now.', s.name, k;
        END LOOP;

        IF d IS DISTINCT FROM s.data THEN
            UPDATE "$settings" SET data = d::json, updated = now(), updated_by = 'admin' WHERE name = s.name;
        END IF;
    END LOOP;

    RAISE NOTICE 'Settings: % reference(s) updated, % left unresolved.', n_fixed, n_left;
END
$reconcile$;

COMMIT;
