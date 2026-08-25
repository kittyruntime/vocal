ALTER TABLE channels
  DROP CONSTRAINT channels_default_audio_quality_check,
  ADD CONSTRAINT channels_default_audio_quality_check
    CHECK (default_audio_quality IN ('low', 'standard', 'high', 'ultra')),
  DROP CONSTRAINT channels_default_camera_quality_check,
  ADD CONSTRAINT channels_default_camera_quality_check
    CHECK (default_camera_quality IN ('low', 'standard', 'high', 'ultra')),
  DROP CONSTRAINT channels_default_screen_quality_check,
  ADD CONSTRAINT channels_default_screen_quality_check
    CHECK (default_screen_quality IN ('low', 'standard', 'high', 'ultra', 'game'));
