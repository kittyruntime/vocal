ALTER TABLE invites
  ADD COLUMN max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 100),
  ADD COLUMN use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  ADD COLUMN revoked_at timestamptz;
