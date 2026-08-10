ALTER TABLE server_settings
  ADD COLUMN max_image_size_mb integer NOT NULL DEFAULT 5 CHECK (max_image_size_mb BETWEEN 1 AND 50),
  ADD COLUMN max_file_size_mb integer NOT NULL DEFAULT 10 CHECK (max_file_size_mb BETWEEN 1 AND 50);

CREATE TABLE message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 127),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 52428800),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_attachments_message_idx ON message_attachments (message_id);
