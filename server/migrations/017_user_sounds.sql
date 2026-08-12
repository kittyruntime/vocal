CREATE TABLE user_sounds (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('message', 'userJoin', 'userLeave', 'muteToggle', 'forceMuted', 'screenShare')),
  audio_data text NOT NULL,
  PRIMARY KEY (user_id, event)
);
