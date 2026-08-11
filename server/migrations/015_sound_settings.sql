CREATE TABLE server_sounds (
  event text PRIMARY KEY CHECK (event IN ('message', 'userJoin', 'userLeave', 'muteToggle', 'forceMuted')),
  enabled boolean NOT NULL DEFAULT true,
  audio_data text
);

INSERT INTO server_sounds (event) VALUES
  ('message'), ('userJoin'), ('userLeave'), ('muteToggle'), ('forceMuted');

ALTER TABLE users ADD COLUMN sound_volumes jsonb NOT NULL DEFAULT '{}'::jsonb;
