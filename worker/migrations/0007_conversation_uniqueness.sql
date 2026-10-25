PRAGMA foreign_keys = ON;

-- Earlier releases opened a new conversation whenever a customer replied to a
-- closed thread. Keep the most recently active row as the canonical thread,
-- move every message into it, and preserve accumulated activity/unread state.
CREATE TABLE conversation_merge_0007 (
  duplicate_id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL
);

INSERT INTO conversation_merge_0007 (duplicate_id, canonical_id)
SELECT source.conversation_id,
  (SELECT target.conversation_id
   FROM conversations target
   WHERE target.workspace_id=source.workspace_id
     AND target.contact_id=source.contact_id
     AND target.channel_id=source.channel_id
   ORDER BY target.last_message_at DESC, target.updated_at DESC,
     target.created_at DESC, target.conversation_id DESC
   LIMIT 1)
FROM conversations source
WHERE source.conversation_id<>(
  SELECT target.conversation_id
  FROM conversations target
  WHERE target.workspace_id=source.workspace_id
    AND target.contact_id=source.contact_id
    AND target.channel_id=source.channel_id
  ORDER BY target.last_message_at DESC, target.updated_at DESC,
    target.created_at DESC, target.conversation_id DESC
  LIMIT 1
);

UPDATE conversations
SET unread_count=unread_count+COALESCE((
      SELECT SUM(duplicate.unread_count)
      FROM conversation_merge_0007 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ), 0),
    last_message_at=MAX(last_message_at, COALESCE((
      SELECT MAX(duplicate.last_message_at)
      FROM conversation_merge_0007 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ), last_message_at)),
    created_at=MIN(created_at, COALESCE((
      SELECT MIN(duplicate.created_at)
      FROM conversation_merge_0007 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ), created_at)),
    updated_at=MAX(updated_at, COALESCE((
      SELECT MAX(duplicate.updated_at)
      FROM conversation_merge_0007 map
      JOIN conversations duplicate ON duplicate.conversation_id=map.duplicate_id
      WHERE map.canonical_id=conversations.conversation_id
    ), updated_at))
WHERE conversation_id IN (SELECT canonical_id FROM conversation_merge_0007);

UPDATE messages
SET conversation_id=(
  SELECT canonical_id
  FROM conversation_merge_0007
  WHERE duplicate_id=messages.conversation_id
)
WHERE conversation_id IN (SELECT duplicate_id FROM conversation_merge_0007);

DELETE FROM conversations
WHERE conversation_id IN (SELECT duplicate_id FROM conversation_merge_0007);

DROP TABLE conversation_merge_0007;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_workspace_contact_channel_unique
  ON conversations(workspace_id, contact_id, channel_id);
