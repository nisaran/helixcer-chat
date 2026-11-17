PRAGMA foreign_keys = ON;

-- Workspace defaults for WhatsApp template variable auto-fill (inbox + campaigns).
-- External API sends do not read this table.
CREATE TABLE IF NOT EXISTS workspace_whatsapp_template_mappings (
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  mappings_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, channel_id, template_name, template_language)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_template_mappings_workspace
  ON workspace_whatsapp_template_mappings (workspace_id, updated_at DESC);
