PRAGMA foreign_keys = ON;

-- Snapshot human-readable route data on each message.  Foreign keys preserve
-- the machine route, while these values keep historical bubbles intelligible
-- after a channel is renamed or disconnected.
ALTER TABLE messages ADD COLUMN route_connector_type TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN route_channel_name TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN route_channel_profile_id TEXT NOT NULL DEFAULT '';

UPDATE messages
SET route_connector_type=COALESCE((SELECT COALESCE(NULLIF(channel.provider_type,''),channel.connector_type)
      FROM channels channel WHERE channel.workspace_id=messages.workspace_id
        AND channel.channel_id=messages.channel_id),''),
    route_channel_name=COALESCE((SELECT channel.name FROM channels channel
      WHERE channel.workspace_id=messages.workspace_id AND channel.channel_id=messages.channel_id),''),
    route_channel_profile_id=COALESCE((SELECT binding.scoped_profile_id
      FROM channel_identity_bindings binding
      WHERE binding.workspace_id=messages.workspace_id
        AND binding.identity_id=messages.identity_id
        AND binding.channel_id=messages.channel_id
      ORDER BY binding.active DESC,binding.last_seen_at DESC LIMIT 1),'');

CREATE TRIGGER IF NOT EXISTS messages_route_snapshot_after_insert
AFTER INSERT ON messages
BEGIN
  UPDATE messages
  SET route_connector_type=COALESCE((SELECT COALESCE(NULLIF(channel.provider_type,''),channel.connector_type)
        FROM channels channel WHERE channel.workspace_id=NEW.workspace_id
          AND channel.channel_id=NEW.channel_id),''),
      route_channel_name=COALESCE((SELECT channel.name FROM channels channel
        WHERE channel.workspace_id=NEW.workspace_id AND channel.channel_id=NEW.channel_id),''),
      route_channel_profile_id=COALESCE((SELECT binding.scoped_profile_id
        FROM channel_identity_bindings binding
        WHERE binding.workspace_id=NEW.workspace_id
          AND binding.identity_id=NEW.identity_id
          AND binding.channel_id=NEW.channel_id
        ORDER BY binding.active DESC,binding.last_seen_at DESC LIMIT 1),'')
  WHERE message_id=NEW.message_id;
END;

-- A conversation is now the workspace-wide thread for one contact.  Messages
-- keep their own channel_id and identity_id, so moving older channel-specific
-- threads into the contact thread does not lose delivery or reply routing.
CREATE TABLE conversation_merge_0014 (
  duplicate_id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL
);

INSERT INTO conversation_merge_0014 (duplicate_id, canonical_id)
SELECT source.conversation_id,
  (SELECT target.conversation_id
   FROM conversations target
   WHERE target.workspace_id=source.workspace_id
     AND target.contact_id=source.contact_id
   ORDER BY target.last_message_at DESC,target.updated_at DESC,
     target.created_at DESC,target.conversation_id DESC
   LIMIT 1)
FROM conversations source
WHERE source.conversation_id<>(
  SELECT target.conversation_id
  FROM conversations target
  WHERE target.workspace_id=source.workspace_id
    AND target.contact_id=source.contact_id
  ORDER BY target.last_message_at DESC,target.updated_at DESC,
    target.created_at DESC,target.conversation_id DESC
  LIMIT 1
);

UPDATE conversations
SET unread_count=unread_count+COALESCE((
      SELECT SUM(duplicate.unread_count)
      FROM conversation_merge_0014 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ),0),
    created_at=MIN(created_at,COALESCE((
      SELECT MIN(duplicate.created_at)
      FROM conversation_merge_0014 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ),created_at)),
    updated_at=MAX(updated_at,COALESCE((
      SELECT MAX(duplicate.updated_at)
      FROM conversation_merge_0014 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ),updated_at)),
    last_message_at=MAX(last_message_at,COALESCE((
      SELECT MAX(duplicate.last_message_at)
      FROM conversation_merge_0014 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ),last_message_at)),
    status=CASE
      WHEN status='open' OR EXISTS(
        SELECT 1
        FROM conversation_merge_0014 map
        JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
        WHERE map.canonical_id=conversations.conversation_id
          AND duplicate.status='open'
      ) THEN 'open'
      WHEN status='pending' OR EXISTS(
        SELECT 1
        FROM conversation_merge_0014 map
        JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
        WHERE map.canonical_id=conversations.conversation_id
          AND duplicate.status='pending'
      ) THEN 'pending'
      ELSE 'closed'
    END
WHERE conversation_id IN (SELECT canonical_id FROM conversation_merge_0014);

UPDATE messages
SET conversation_id=(
  SELECT canonical_id FROM conversation_merge_0014
  WHERE duplicate_id=messages.conversation_id
)
WHERE conversation_id IN (SELECT duplicate_id FROM conversation_merge_0014);

UPDATE channel_identity_bindings
SET last_conversation_id=COALESCE((
  SELECT canonical_id FROM conversation_merge_0014
  WHERE duplicate_id=channel_identity_bindings.last_conversation_id
),last_conversation_id)
WHERE last_conversation_id IN (SELECT duplicate_id FROM conversation_merge_0014);

UPDATE identity_migration_issues
SET conversation_id=COALESCE((
  SELECT canonical_id FROM conversation_merge_0014
  WHERE duplicate_id=identity_migration_issues.conversation_id
),conversation_id)
WHERE conversation_id IN (SELECT duplicate_id FROM conversation_merge_0014);

DELETE FROM conversations
WHERE conversation_id IN (SELECT duplicate_id FROM conversation_merge_0014);

DROP TABLE conversation_merge_0014;

-- Preserve the most recent message route as the compatibility/default route
-- on the thread.  The authoritative route remains on every message row.
UPDATE conversations
SET channel_id=COALESCE((
      SELECT message.channel_id FROM messages message
      WHERE message.workspace_id=conversations.workspace_id
        AND message.conversation_id=conversations.conversation_id
      ORDER BY message.timestamp DESC,message.message_id DESC LIMIT 1
    ),channel_id),
    identity_id=COALESCE((
      SELECT NULLIF(message.identity_id,'') FROM messages message
      WHERE message.workspace_id=conversations.workspace_id
        AND message.conversation_id=conversations.conversation_id
      ORDER BY message.timestamp DESC,message.message_id DESC LIMIT 1
    ),identity_id);

DROP INDEX IF EXISTS idx_conversations_workspace_identity_channel_unique;
DROP INDEX IF EXISTS idx_conversations_workspace_legacy_contact_channel_unique;
DROP INDEX IF EXISTS idx_conversations_workspace_contact_channel_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_workspace_contact_unique
  ON conversations(workspace_id,contact_id);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_conversation_route
  ON messages(workspace_id,conversation_id,channel_id,identity_id,timestamp DESC);
