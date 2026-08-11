CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 32),
  color text NOT NULL DEFAULT '#99aab5' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_capabilities (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN ('manage_channels', 'manage_server', 'moderate', 'publish_voice')),
  PRIMARY KEY (role_id, capability)
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
