ALTER TABLE server_settings
  ADD COLUMN enabled_accent_presets text[] NOT NULL DEFAULT ARRAY['amber', 'ember-red', 'magenta', 'glacier', 'emerald']
    CHECK (enabled_accent_presets <@ ARRAY['amber', 'ember-red', 'magenta', 'glacier', 'emerald']::text[]),
  ADD COLUMN default_accent_preset text NOT NULL DEFAULT 'amber'
    CHECK (default_accent_preset IN ('amber', 'ember-red', 'magenta', 'glacier', 'emerald'));

ALTER TABLE users ADD COLUMN accent_preset text
  CHECK (accent_preset IS NULL OR accent_preset IN ('amber', 'ember-red', 'magenta', 'glacier', 'emerald'));
