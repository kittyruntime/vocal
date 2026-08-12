ALTER TABLE server_settings
  ADD COLUMN enabled_accent_presets text[] NOT NULL DEFAULT ARRAY['amber', 'ember-red', 'magenta', 'glacier', 'emerald'],
  ADD COLUMN default_accent_preset text NOT NULL DEFAULT 'amber';

ALTER TABLE users ADD COLUMN accent_preset text;
