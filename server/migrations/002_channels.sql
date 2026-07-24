CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('text', 'voice')),
  min_role text NOT NULL DEFAULT 'member' CHECK (min_role IN ('admin', 'moderator', 'member')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channels_order_idx ON channels (position, created_at);
