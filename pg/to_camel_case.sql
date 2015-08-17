CREATE OR REPLACE FUNCTION to_camel_case(str text) RETURNS text AS $$
  SELECT replace(initcap($1), '_', '');
$$ LANGUAGE SQL IMMUTABLE;
