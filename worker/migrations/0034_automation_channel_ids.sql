PRAGMA foreign_keys = ON;

-- Per-rule channel allowlists for greeting and out-of-office automation.
-- Empty JSON array means the rule matches no channels (select channels to enable).
ALTER TABLE workspace_automation_settings
  ADD COLUMN greeting_channel_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE workspace_automation_settings
  ADD COLUMN ooo_channel_ids_json TEXT NOT NULL DEFAULT '[]';
