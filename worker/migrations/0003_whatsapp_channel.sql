-- The current single-workspace product exposes one WhatsApp Cloud API channel.
-- Credentials remain encrypted Worker secrets and are never stored in D1.
INSERT OR IGNORE INTO channels (
  channel_id,
  name,
  connector_type,
  enabled,
  capabilities_json,
  config_json,
  secret_key,
  created_at,
  updated_at,
  workspace_id
) VALUES (
  'wa-main',
  'WhatsApp',
  'whatsapp_cloud',
  1,
  '["text"]',
  '{"apiVersion":"v25.0"}',
  'WA_MAIN',
  datetime('now'),
  datetime('now'),
  'ws_default'
);
