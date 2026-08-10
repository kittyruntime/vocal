ALTER TABLE users
  ADD COLUMN banner_url text,
  ADD CONSTRAINT users_banner_length CHECK (banner_url IS NULL OR length(banner_url) <= 700000);
