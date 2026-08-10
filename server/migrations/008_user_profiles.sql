ALTER TABLE users
  ADD COLUMN email text,
  ADD COLUMN avatar_url text,
  ADD COLUMN description text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_email_length CHECK (email IS NULL OR length(email) <= 254),
  ADD CONSTRAINT users_avatar_length CHECK (avatar_url IS NULL OR length(avatar_url) <= 700000),
  ADD CONSTRAINT users_description_length CHECK (length(description) <= 190);
