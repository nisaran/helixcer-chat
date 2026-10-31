PRAGMA foreign_keys = ON;

-- Persist who sent each outbound message as first-class columns so delivery
-- status updates cannot wipe attribution stored only in payload_json.
ALTER TABLE messages ADD COLUMN sender_login TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN sender_name TEXT NOT NULL DEFAULT '';

-- Backfill from the earlier payload_json.senderName field when present.
UPDATE messages
SET sender_name = TRIM(COALESCE(json_extract(payload_json, '$.senderName'), ''))
WHERE direction = 'outbound'
  AND TRIM(COALESCE(json_extract(payload_json, '$.senderName'), '')) <> '';

UPDATE messages
SET sender_login = 'API'
WHERE direction = 'outbound'
  AND sender_name = 'API'
  AND sender_login = '';
