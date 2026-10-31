-- Prevent duplicate provider deliveries / Interakt re-imports for the same channel message.
-- Empty provider_message_id values remain allowed (multiple pending outbound drafts).

DELETE FROM messages
WHERE message_id IN (
  SELECT m.message_id
  FROM messages m
  INNER JOIN (
    SELECT workspace_id, channel_id, provider_message_id, MIN(rowid) AS keep_rowid
    FROM messages
    WHERE provider_message_id <> ''
    GROUP BY workspace_id, channel_id, provider_message_id
    HAVING COUNT(*) > 1
  ) duplicates
    ON duplicates.workspace_id = m.workspace_id
   AND duplicates.channel_id = m.channel_id
   AND duplicates.provider_message_id = m.provider_message_id
   AND duplicates.keep_rowid <> m.rowid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_workspace_channel_provider_unique
  ON messages(workspace_id, channel_id, provider_message_id)
  WHERE provider_message_id <> '';
