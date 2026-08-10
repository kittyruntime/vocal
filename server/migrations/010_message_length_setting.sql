ALTER TABLE server_settings
  ADD COLUMN max_message_length integer NOT NULL DEFAULT 4000
    CHECK (max_message_length BETWEEN 100 AND 10000);
