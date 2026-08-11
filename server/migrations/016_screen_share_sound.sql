ALTER TABLE server_sounds DROP CONSTRAINT server_sounds_event_check;
ALTER TABLE server_sounds ADD CONSTRAINT server_sounds_event_check
  CHECK (event IN ('message', 'userJoin', 'userLeave', 'muteToggle', 'forceMuted', 'screenShare'));

INSERT INTO server_sounds (event) VALUES ('screenShare') ON CONFLICT (event) DO NOTHING;
