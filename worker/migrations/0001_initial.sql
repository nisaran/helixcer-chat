PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connector_type TEXT NOT NULL CHECK (connector_type IN ('whatsapp_cloud', 'generic_http', 'web_chat', 'telegram')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  capabilities_json TEXT NOT NULL DEFAULT '["text"]',
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  contact_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_identities (
  identity_id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE RESTRICT,
  channel_profile_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(channel_id, channel_profile_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE RESTRICT,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  assigned_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  last_message_at TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE RESTRICT,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_key TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  outbox_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(message_id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  next_attempt_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed')),
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_activity ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_status_activity ON conversations(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_channel ON conversations(contact_id, channel_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages(conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages(channel_id, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_identities_contact_channel ON channel_identities(contact_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp DESC);
