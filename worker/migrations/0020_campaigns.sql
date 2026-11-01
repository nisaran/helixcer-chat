PRAGMA foreign_keys = ON;

-- Bulk messaging campaigns and per-recipient delivery tracking.
CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  audience_source TEXT NOT NULL DEFAULT 'contacts',
  message_type TEXT NOT NULL DEFAULT 'text',
  template_name TEXT NOT NULL DEFAULT '',
  template_language TEXT NOT NULL DEFAULT '',
  message_body TEXT NOT NULL DEFAULT '',
  variable_mapping_json TEXT NOT NULL DEFAULT '[]',
  field_mapping_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  total_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_created
  ON campaigns (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  recipient_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  contact_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  profile_id TEXT NOT NULL DEFAULT '',
  row_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
  ON campaign_recipients (workspace_id, campaign_id, created_at);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_message
  ON campaign_recipients (workspace_id, message_id)
  WHERE message_id <> '';
