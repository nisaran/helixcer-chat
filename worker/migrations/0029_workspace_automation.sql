PRAGMA foreign_keys = ON;

-- Workspace-level greeting and out-of-office auto-replies.
CREATE TABLE IF NOT EXISTS workspace_automation_settings (
  workspace_id TEXT PRIMARY KEY,
  greeting_enabled INTEGER NOT NULL DEFAULT 0,
  greeting_message TEXT NOT NULL DEFAULT '',
  greeting_interval_hours REAL NOT NULL DEFAULT 24,
  ooo_enabled INTEGER NOT NULL DEFAULT 0,
  ooo_message TEXT NOT NULL DEFAULT '',
  ooo_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ooo_start_time TEXT NOT NULL DEFAULT '18:00',
  ooo_end_time TEXT NOT NULL DEFAULT '09:00',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS automation_send_log (
  log_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL,
  day_key TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_automation_send_log_conversation
  ON automation_send_log (workspace_id, conversation_id, rule_type, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_send_log_day
  ON automation_send_log (workspace_id, conversation_id, rule_type, day_key);
