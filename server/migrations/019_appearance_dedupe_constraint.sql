CREATE FUNCTION appearance_array_has_duplicates(arr text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT cardinality(arr) <> (SELECT count(DISTINCT elem) FROM unnest(arr) AS elem);
$$;

ALTER TABLE server_settings
  ADD CONSTRAINT enabled_accent_presets_no_duplicates
  CHECK (NOT appearance_array_has_duplicates(enabled_accent_presets));
