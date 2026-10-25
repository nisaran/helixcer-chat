PRAGMA foreign_keys = ON;

-- Logical provider type is separate from the legacy connector CHECK constraint.
-- Instagram rows retain generic_http in connector_type for schema compatibility,
-- while all application routing uses provider_type.
ALTER TABLE channels ADD COLUMN provider_type TEXT NOT NULL DEFAULT '';
UPDATE channels SET provider_type=connector_type WHERE provider_type='';

-- Remove only the untouched channel that 0003 seeded for the former
-- single-connection setup. Any edited or referenced channel is preserved.
DELETE FROM channels
WHERE channel_id='wa-main'
  AND workspace_id='ws_default'
  AND name='WhatsApp'
  AND connector_type='whatsapp_cloud'
  AND provider_type='whatsapp_cloud'
  AND enabled=1
  AND capabilities_json='["text"]'
  AND config_json='{"apiVersion":"v25.0"}'
  AND secret_key='WA_MAIN'
  AND NOT EXISTS (SELECT 1 FROM channel_identities WHERE channel_id='wa-main')
  AND NOT EXISTS (SELECT 1 FROM conversations WHERE channel_id='wa-main')
  AND NOT EXISTS (SELECT 1 FROM messages WHERE channel_id='wa-main')
  AND NOT EXISTS (SELECT 1 FROM webhook_events WHERE channel_id='wa-main');

CREATE TABLE IF NOT EXISTS channel_credentials (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  credential_key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, channel_id, credential_key)
);

CREATE INDEX IF NOT EXISTS idx_channel_credentials_channel
  ON channel_credentials(workspace_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_workspace_provider
  ON channels(workspace_id, provider_type, enabled, name);

-- Provider identities may be reused by different workspaces, but never by two
-- connections in the same workspace. Telegram's bot ID is learned at verify time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_workspace_whatsapp_phone
  ON channels(workspace_id, json_extract(config_json, '$.phoneNumberId'))
  WHERE provider_type='whatsapp_cloud'
    AND json_valid(config_json)
    AND COALESCE(json_extract(config_json, '$.phoneNumberId'), '')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_workspace_instagram_account
  ON channels(workspace_id, json_extract(config_json, '$.instagramAccountId'))
  WHERE provider_type='instagram'
    AND json_valid(config_json)
    AND COALESCE(json_extract(config_json, '$.instagramAccountId'), '')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_workspace_telegram_bot
  ON channels(workspace_id, json_extract(config_json, '$.verifiedProviderId'))
  WHERE provider_type='telegram'
    AND json_valid(config_json)
    AND COALESCE(json_extract(config_json, '$.verifiedProviderId'), '')<>'';
