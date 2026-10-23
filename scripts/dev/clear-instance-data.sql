/*
 * clear-instance-data.sql
 *
 * DEVELOPER USE ONLY. DESTRUCTIVE. NOT PART OF ANY INSTALL.
 *
 * Empties every application master-data and transaction table in ONE Featherbone
 * instance database, so it looks like a freshly installed instance with its
 * packages deployed but no business data (e.g. clears the Road Runner Campers
 * demo data). Nothing in the framework or installer reads, runs or ships this
 * file; run it by hand with psql against the instance database.
 *
 * WHAT IS CLEARED  (found by looking at what is installed, never a fixed list)
 *   - Every table of every feather whose owning module (feather.module) is not
 *     "Core". Install SupplyChain, Job Shop data feathers, Finance, or any
 *     other package and its tables are picked up on the next run.
 *   - A small list of Core master-data feathers: Contact (and its email, phone,
 *     address and social account rows), Address, Comment, Kind.
 *     Override with featherbone.clear_core_data.
 *   - Document-number sequences (autonumber) are restarted at their start value.
 *   - $auth rows that belong to cleared records (row-level authorization).
 *   - Relation columns in KEPT tables that point at cleared records are set to
 *     NULL (for example user_account.contact), so users still sign in.
 *
 * WHAT IS KEPT  (the framework and the packages themselves)
 *   - Control tables: "$settings", "$workbook", "$feather", "$navigation_category",
 *     "$auth", "$db", "$session", "$profiles", "$subscription".
 *   - All other Core feathers: feather, feather_property, feather_authorization,
 *     form*, print_form, layout, route, script/data_service/module*, style, role,
 *     role_membership, user_account, help_link, resource_link, and Core
 *     reference data (country, state, currency*, honorific, social_network, unit,
 *     base_currency, currency_conversion).
 *   - Run history (server_process, send_mail, notice, log) unless
 *     featherbone.clear_history = on.
 *   - object__pk_seq and every other sequence owned by a table. (_pk is shared
 *     by the control tables, so it is never reset.)
 *
 * HOW IT IS SAFE
 *   - Dry run by default. It prints what it would do and changes nothing.
 *   - To execute you must set featherbone.clear_execute = on AND
 *     featherbone.clear_confirm to the exact database name.
 *   - A database whose "$db".mode is prod also needs featherbone.clear_allow_prod = on.
 *   - Refuses a manager database, and any database with other open connections
 *     (stop the Featherbone server first) unless clear_allow_clients = on.
 *   - It is a single DO block, so it is one transaction: any error rolls
 *     everything back. Uses TRUNCATE ONLY (never touches inheriting tables that
 *     are not on the list) and takes its own lock_timeout.
 *   - Settings stored in "$settings" are NOT edited. Settings that mention
 *     cleared records are listed so you can reconfigure them.
 *
 * HOW TO RUN  (take a backup first; nothing here can be undone once committed)
 *
 *   1. Stop the Featherbone server.
 *   2. Dry run:
 *        psql -d demo -f clear-instance-data.sql
 *   3. Read the report. Then execute:
 *        PGOPTIONS="-c featherbone.clear_execute=on -c featherbone.clear_confirm=demo -c featherbone.clear_allow_prod=on" \
 *          psql -d demo -f clear-instance-data.sql
 *      (or uncomment the SET lines below; SET only lasts for that session.)
 *   4. Start the server. Re-enter anything the report listed under settings.
 *
 * OPTIONS  (all are session settings; defaults shown)
 *   featherbone.clear_execute      off   on = really do it
 *   featherbone.clear_confirm      ''    must equal current_database() to execute
 *   featherbone.clear_allow_prod   off   needed when "$db".mode = prod
 *   featherbone.clear_allow_clients off  allow other connections to be open
 *   featherbone.clear_history      off   also clear server_process, send_mail, notice, log
 *   featherbone.clear_reset_seqs   on    restart document-number sequences
 *   featherbone.clear_core_data    Contact,ContactAddress,ContactEmail,
 *                                  ContactPhone,ContactSocialAccount,Address,
 *                                  Comment,Kind     (Core feathers to clear)
 *   featherbone.clear_keep         ''    comma list of feather names to KEEP even
 *                                        though their module is cleared, e.g.
 *                                        configuration-like feathers such as
 *                                        Terms,TaxType,ShipMethod,Site
 */

-- SET featherbone.clear_execute = 'on';
-- SET featherbone.clear_confirm = 'demo';
-- SET featherbone.clear_allow_prod = 'on';
-- SET featherbone.clear_keep = '';

DO $clear_instance_data$
DECLARE
    v_execute       boolean := lower(coalesce(nullif(current_setting('featherbone.clear_execute', true), ''), 'off')) IN ('on', 'true', 'yes', '1');
    v_confirm       text    := coalesce(current_setting('featherbone.clear_confirm', true), '');
    v_allow_prod    boolean := lower(coalesce(nullif(current_setting('featherbone.clear_allow_prod', true), ''), 'off')) IN ('on', 'true', 'yes', '1');
    v_allow_clients boolean := lower(coalesce(nullif(current_setting('featherbone.clear_allow_clients', true), ''), 'off')) IN ('on', 'true', 'yes', '1');
    v_history       boolean := lower(coalesce(nullif(current_setting('featherbone.clear_history', true), ''), 'off')) IN ('on', 'true', 'yes', '1');
    v_reset_seqs    boolean := lower(coalesce(nullif(current_setting('featherbone.clear_reset_seqs', true), ''), 'on')) IN ('on', 'true', 'yes', '1');
    v_core_data     text[]  := coalesce(
        string_to_array(nullif(current_setting('featherbone.clear_core_data', true), ''), ','),
        ARRAY['Contact', 'ContactAddress', 'ContactEmail', 'ContactPhone',
              'ContactSocialAccount', 'Address', 'Comment', 'Kind']
    );
    v_keep          text[]  := coalesce(
        string_to_array(nullif(current_setting('featherbone.clear_keep', true), ''), ','),
        ARRAY[]::text[]
    );
    v_history_names text[]  := ARRAY['ServerProcess', 'SendMail', 'Notice', 'Log'];

    r               record;
    v_kind          text;
    v_mode          text;
    v_others        integer;
    v_tbl           regclass;
    v_is_feather    boolean;
    v_n             bigint;
    v_cnt           bigint;
    v_col           text;
    v_notnull       boolean;
    v_tables        regclass[] := ARRAY[]::regclass[];
    v_cleared       text[]     := ARRAY[]::text[];   -- feather names being cleared
    v_pks           bigint[]   := ARRAY[]::bigint[];  -- _pk of every row being cleared
    v_ids           text[]     := ARRAY[]::text[];    -- id of every row being cleared
    a_pks           bigint[];
    a_ids           text[];
    v_rows          bigint := 0;
    v_ntables       integer := 0;
    v_report        text := '';
    v_line          text;
BEGIN
    PERFORM set_config('search_path', 'public, pg_catalog', true);
    PERFORM set_config('lock_timeout', '10s', true);

    ----------------------------------------------------------------------
    -- 1. Guards
    ----------------------------------------------------------------------
    IF to_regclass('public."$db"') IS NULL OR to_regclass('public.feather') IS NULL THEN
        RAISE EXCEPTION 'This does not look like a Featherbone database ("$db" or feather missing). Nothing done.';
    END IF;

    SELECT d.kind, d.mode INTO v_kind, v_mode FROM public."$db" d LIMIT 1;

    IF v_kind IS DISTINCT FROM 'instance' THEN
        RAISE EXCEPTION 'Database % is of kind "%", not "instance". This script only clears instances. Nothing done.',
            current_database(), coalesce(v_kind, '(none)');
    END IF;

    SELECT count(*) INTO v_others
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND backend_type = 'client backend';

    IF v_execute THEN
        IF v_confirm <> current_database() THEN
            RAISE EXCEPTION 'To execute, set featherbone.clear_confirm to this database''s name (%). Nothing done.',
                current_database();
        END IF;
        IF v_mode = 'prod' AND NOT v_allow_prod THEN
            RAISE EXCEPTION 'Database % is marked mode=prod. Set featherbone.clear_allow_prod=on if you really mean it. Nothing done.',
                current_database();
        END IF;
        IF v_others > 0 AND NOT v_allow_clients THEN
            RAISE EXCEPTION '% other connection(s) are open on %. Stop the Featherbone server first (or set featherbone.clear_allow_clients=on). Nothing done.',
                v_others, current_database();
        END IF;
    END IF;

    v_report := format(E'%s on database "%s" (kind=%s, mode=%s, %s other connection(s))\n',
        CASE WHEN v_execute THEN 'EXECUTE' ELSE 'DRY RUN' END,
        current_database(), v_kind, v_mode, v_others);

    ----------------------------------------------------------------------
    -- 2. Discover the tables to clear, one feather at a time
    ----------------------------------------------------------------------
    FOR r IN
        SELECT f.name, f.module,
               lower(regexp_replace(f.name, '([a-z0-9])([A-Z])', '\1_\2', 'g')) AS tbl
        FROM public.feather f
        WHERE NOT f.is_deleted
          AND f.module IS NOT NULL
          AND NOT (f.name = ANY (v_keep))
          AND (   f.module <> 'Core'
               OR f.name = ANY (v_core_data)
               OR (v_history AND f.name = ANY (v_history_names)))
        ORDER BY f.module, f.name
    LOOP
        v_tbl := to_regclass(format('public.%I', r.tbl));

        IF v_tbl IS NULL THEN
            v_report := v_report || format(E'  WARNING  %s.%s: no table "%s" found, skipped\n', r.module, r.name, r.tbl);
            CONTINUE;
        END IF;

        -- Only ever touch tables that descend from the object base table.
        WITH RECURSIVE anc(oid) AS (
            SELECT inhparent FROM pg_inherits WHERE inhrelid = v_tbl
            UNION
            SELECT i.inhparent FROM pg_inherits i JOIN anc ON i.inhrelid = anc.oid
        )
        SELECT coalesce(bool_or(oid = 'public.object'::regclass), false) INTO v_is_feather FROM anc;

        IF NOT v_is_feather OR r.tbl LIKE '$%' OR r.tbl = 'object' THEN
            v_report := v_report || format(E'  WARNING  %s.%s: table "%s" is not a feather data table, skipped\n', r.module, r.name, r.tbl);
            CONTINUE;
        END IF;

        EXECUTE format('SELECT count(*), coalesce(array_agg(_pk), ARRAY[]::bigint[]), '
                       'coalesce(array_agg(id) FILTER (WHERE id IS NOT NULL), ARRAY[]::text[]) FROM ONLY %s',
                       v_tbl::text)
           INTO v_n, a_pks, a_ids;

        v_tables  := v_tables || v_tbl;
        v_cleared := v_cleared || r.name;
        v_ntables := v_ntables + 1;
        v_rows    := v_rows + v_n;
        v_pks     := v_pks || a_pks;
        v_ids     := v_ids || a_ids;

        IF v_n > 0 THEN
            v_report := v_report || format(E'  clear    %-12s %-34s %8s rows\n', r.module, r.tbl, v_n);
        END IF;
    END LOOP;

    v_report := v_report || format(E'  => %s tables selected (%s rows)\n', v_ntables, v_rows);

    IF v_ntables = 0 THEN
        RAISE EXCEPTION 'No tables were selected, which means feather.module is not populated as expected. Nothing done.';
    END IF;

    -- Feather tables that no feather accounts for: reported, never touched.
    FOR r IN
        SELECT c.relname
        FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace
          AND c.relkind = 'r'
          AND c.relname NOT LIKE '$%'
          AND c.relname <> 'object'
          AND NOT EXISTS (
              SELECT 1 FROM public.feather f
              WHERE NOT f.is_deleted
                AND lower(regexp_replace(f.name, '([a-z0-9])([A-Z])', '\1_\2', 'g')) = c.relname)
        ORDER BY 1
    LOOP
        v_report := v_report || format(E'  NOTE     table %s belongs to no installed feather, left alone\n', r.relname);
    END LOOP;

    ----------------------------------------------------------------------
    -- 3. Relation columns in KEPT tables that point at cleared records
    ----------------------------------------------------------------------
    FOR r IN
        WITH RECURSIVE chain(root, name, inherits) AS (
            SELECT name, name, inherits FROM public.feather WHERE NOT is_deleted
            UNION ALL
            SELECT c.root, f.name, f.inherits
            FROM chain c JOIN public.feather f ON f.name = c.inherits AND NOT f.is_deleted
        )
        SELECT DISTINCT c.root AS feather, p.name AS prop, (p.type::jsonb ->> 'relation') AS rel
        FROM chain c
        JOIN public.feather f ON f.name = c.name AND NOT f.is_deleted
        JOIN public.feather_property p ON p._parent_feather_pk = f._pk
        WHERE p.type::jsonb ? 'relation'
        ORDER BY 1, 2
    LOOP
        CONTINUE WHEN r.feather = ANY (v_cleared) OR r.rel IS NULL;

        v_tbl := to_regclass(format('public.%I', lower(regexp_replace(r.feather, '([a-z0-9])([A-Z])', '\1_\2', 'g'))));
        CONTINUE WHEN v_tbl IS NULL;

        v_col := '_' || lower(regexp_replace(r.prop, '([a-z0-9])([A-Z])', '\1_\2', 'g'))
                     || '_' || lower(regexp_replace(r.rel, '([a-z0-9])([A-Z])', '\1_\2', 'g')) || '_pk';

        SELECT a.attnotnull INTO v_notnull
        FROM pg_attribute a
        WHERE a.attrelid = v_tbl AND a.attname = v_col AND a.attnum > 0 AND NOT a.attisdropped;
        CONTINUE WHEN NOT FOUND;

        EXECUTE format('SELECT count(*) FROM ONLY %s WHERE %I IN (SELECT unnest($1))', v_tbl::text, v_col)
           INTO v_cnt USING v_pks;
        CONTINUE WHEN v_cnt = 0;

        IF v_notnull THEN
            RAISE EXCEPTION '%.% (%) is NOT NULL but % row(s) point at records being cleared. Add % to featherbone.clear_keep or clear its table too. Nothing done.',
                v_tbl, v_col, r.rel, v_cnt, r.rel;
        END IF;

        v_report := v_report || format(E'  unlink   %-34s %-34s %6s row(s) set to NULL\n', v_tbl::text, v_col, v_cnt);

        IF v_execute THEN
            EXECUTE format('UPDATE ONLY %s SET %I = NULL WHERE %I IN (SELECT unnest($1))', v_tbl::text, v_col, v_col)
               USING v_pks;
        END IF;
    END LOOP;

    ----------------------------------------------------------------------
    -- 4. Row-level authorization belonging to cleared records
    ----------------------------------------------------------------------
    SELECT count(*) INTO v_cnt FROM public."$auth" WHERE object_pk IN (SELECT unnest(v_pks));
    IF v_cnt > 0 THEN
        v_report := v_report || format(E'  delete   "$auth" rows for cleared records: %s\n', v_cnt);
        IF v_execute THEN
            DELETE FROM public."$auth" WHERE object_pk IN (SELECT unnest(v_pks));
        END IF;
    END IF;

    ----------------------------------------------------------------------
    -- 5. Settings that mention cleared records (reported, not edited)
    ----------------------------------------------------------------------
    FOR r IN
        SELECT s.name
        FROM public."$settings" s
        WHERE s.name <> 'catalog'
          AND EXISTS (SELECT 1 FROM unnest(v_ids) i
                      WHERE length(i) >= 8 AND position(i IN s.data::text) > 0)
        ORDER BY 1
    LOOP
        v_report := v_report || format(E'  REVIEW   settings "%s" refers to a record that is being cleared\n', r.name);
    END LOOP;

    ----------------------------------------------------------------------
    -- 6. Document-number sequences (not owned by a table, not used by kept feathers)
    ----------------------------------------------------------------------
    IF v_reset_seqs THEN
        FOR r IN
            SELECT s.oid::regclass AS seq
            FROM pg_class s
            WHERE s.relkind = 'S'
              AND s.relnamespace = 'public'::regnamespace
              AND NOT EXISTS (SELECT 1 FROM pg_depend d
                              WHERE d.objid = s.oid AND d.deptype IN ('a', 'i')
                                AND d.refclassid = 'pg_class'::regclass)
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.feather f
                  JOIN public.feather_property p ON p._parent_feather_pk = f._pk
                  WHERE NOT f.is_deleted
                    AND NOT (f.name = ANY (v_cleared))
                    AND p.autonumber IS NOT NULL
                    AND p.autonumber::jsonb ->> 'sequence' = s.relname)
            ORDER BY s.relname
        LOOP
            v_report := v_report || format(E'  restart  sequence %s\n', r.seq);
            IF v_execute THEN
                EXECUTE format('ALTER SEQUENCE %s RESTART', r.seq::text);
            END IF;
        END LOOP;
    END IF;

    ----------------------------------------------------------------------
    -- 7. Clear the tables
    ----------------------------------------------------------------------
    IF v_execute THEN
        EXECUTE 'TRUNCATE ONLY ' || (SELECT string_agg(t::text, ', ') FROM unnest(v_tables) t);

        FOREACH v_tbl IN ARRAY v_tables LOOP
            EXECUTE format('SELECT count(*) FROM ONLY %s', v_tbl::text) INTO v_n;
            IF v_n <> 0 THEN
                RAISE EXCEPTION 'Table % still has % rows after truncate. Rolling back.', v_tbl, v_n;
            END IF;
        END LOOP;

        v_report := v_report || E'DONE. Committing.\n';
    ELSE
        v_report := v_report || E'Dry run only: nothing was changed. Set featherbone.clear_execute=on and featherbone.clear_confirm to execute.\n';
    END IF;

    RAISE NOTICE E'\n%', v_report;
END
$clear_instance_data$;
