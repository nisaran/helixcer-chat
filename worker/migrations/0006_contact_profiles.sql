PRAGMA foreign_keys = ON;

-- Contact profile fields belong to the contact instead of to one conversation.
-- Keeping them here lets a contact retain the same company and tags across every
-- channel conversation without changing any existing contact or identity IDs.
ALTER TABLE contacts ADD COLUMN company TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

-- Preserve the tags users already see on a contact's most recent conversation.
UPDATE contacts
SET tags_json = COALESCE((
  SELECT conversations.tags_json
  FROM conversations
  WHERE conversations.workspace_id = contacts.workspace_id
    AND conversations.contact_id = contacts.contact_id
  ORDER BY conversations.last_message_at DESC
  LIMIT 1
), '[]');

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_updated
  ON contacts(workspace_id, updated_at DESC);
