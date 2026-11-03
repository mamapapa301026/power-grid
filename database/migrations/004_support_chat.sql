CREATE TABLE IF NOT EXISTS support_conversations (
  id UUID PRIMARY KEY,
  owner_subject TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Консультация',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_subject TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'operator', 'assistant')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_conversations_owner_updated_idx
  ON support_conversations (owner_subject, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_conversation_time_idx
  ON support_messages (conversation_id, created_at ASC);