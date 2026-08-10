-- Replaces the admin/moderator/member role hierarchy with independent,
-- freely-assignable capabilities: manage_channels, manage_server, moderate,
-- publish_voice. A user holds any subset of these; there is no implicit
-- ranking between them (holding one never implies another).

CREATE TABLE user_capabilities (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN ('manage_channels', 'manage_server', 'moderate', 'publish_voice')),
  PRIMARY KEY (user_id, capability)
);

-- Preserve current effective access: admins get every capability, moderators
-- get moderate + publish_voice (they could already publish), members get
-- publish_voice only (everyone could already publish in voice channels).
INSERT INTO user_capabilities (user_id, capability)
SELECT id, cap FROM users, unnest(ARRAY['manage_channels', 'manage_server', 'moderate', 'publish_voice']) AS cap
WHERE role = 'admin';

INSERT INTO user_capabilities (user_id, capability)
SELECT id, 'moderate' FROM users WHERE role = 'moderator';

INSERT INTO user_capabilities (user_id, capability)
SELECT id, 'publish_voice' FROM users WHERE role IN ('member', 'moderator');

ALTER TABLE users DROP COLUMN role;

ALTER TABLE channels ADD COLUMN required_capability text
  CHECK (required_capability IN ('manage_channels', 'manage_server', 'moderate', 'publish_voice'));
UPDATE channels SET required_capability = 'moderate' WHERE min_role = 'moderator';
UPDATE channels SET required_capability = 'manage_server' WHERE min_role = 'admin';
ALTER TABLE channels DROP COLUMN min_role;
