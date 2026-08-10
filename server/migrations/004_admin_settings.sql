ALTER TABLE channels
  ADD COLUMN default_audio_quality text NOT NULL DEFAULT 'standard'
    CHECK (default_audio_quality IN ('low', 'standard', 'high')),
  ADD COLUMN default_camera_quality text NOT NULL DEFAULT 'standard'
    CHECK (default_camera_quality IN ('low', 'standard', 'high')),
  ADD COLUMN default_screen_quality text NOT NULL DEFAULT 'standard'
    CHECK (default_screen_quality IN ('low', 'standard', 'high', 'game'));

CREATE TABLE server_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  registration_open boolean NOT NULL DEFAULT true
);

INSERT INTO server_settings (singleton, registration_open) VALUES (true, true);
