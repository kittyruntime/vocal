-- Direct messages: 1-to-1 and group conversations, independent of the
-- server's public/capability-gated channels. Access is governed purely by
-- conversation_participants membership, not by capabilities.

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('dm', 'group')),
  name text CHECK (name IS NULL OR length(name) BETWEEN 1 AND 64),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_participants_user_idx ON conversation_participants (user_id);

-- Messages now belong to either a channel or a conversation, never both.
ALTER TABLE messages ALTER COLUMN channel_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_one_target_check CHECK (
  (channel_id IS NOT NULL AND conversation_id IS NULL) OR
  (channel_id IS NULL AND conversation_id IS NOT NULL)
);

CREATE INDEX messages_conversation_time_idx ON messages (conversation_id, created_at DESC);
