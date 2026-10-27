PRAGMA foreign_keys = ON;

-- A contact is the workspace-wide person/company record.  Provider identities
-- are deliberately independent from connected channel accounts so the same
-- WhatsApp number (or other provider identity) can be routed through more than
-- one connection without duplicating the contact.
CREATE TABLE IF NOT EXISTS contact_identities (
  identity_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  phone_number TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Do not merge two master contacts during migration.  Provider ids can also
  -- be app/account scoped (notably Instagram), so canonical uniqueness is per
  -- contact; the active channel binding below is the exact routing authority.
  UNIQUE(workspace_id, contact_id, platform, profile_id)
);

-- Bindings contain account-scoped addressing and retain route history.  They
-- are separate from identities because providers can expose a different scoped
-- identifier for the same person on each connected account.
CREATE TABLE IF NOT EXISTS channel_identity_bindings (
  binding_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  identity_id TEXT NOT NULL REFERENCES contact_identities(identity_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  scoped_profile_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_inbound_at TEXT NOT NULL DEFAULT '',
  last_outbound_at TEXT NOT NULL DEFAULT '',
  last_conversation_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_identities_workspace_contact
  ON contact_identities(workspace_id, contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_identities_workspace_lookup
  ON contact_identities(workspace_id, platform, profile_id);
CREATE INDEX IF NOT EXISTS idx_identity_bindings_workspace_identity
  ON channel_identity_bindings(workspace_id, identity_id, active, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_bindings_workspace_channel
  ON channel_identity_bindings(workspace_id, channel_id, scoped_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_bindings_active_channel_profile
  ON channel_identity_bindings(workspace_id, channel_id, scoped_profile_id)
  WHERE active=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_bindings_active_identity_channel
  ON channel_identity_bindings(workspace_id, identity_id, channel_id)
  WHERE active=1;

-- Backfill canonical identities from the legacy account-bound identity table.
-- Re-use the earliest legacy id for stable references, while collapsing the
-- same contact/platform/profile observed on several connected accounts.
INSERT OR IGNORE INTO contact_identities
    (identity_id,workspace_id,contact_id,platform,profile_id,username,phone_number,
     display_name,metadata_json,created_at,updated_at)
SELECT legacy.identity_id,
       legacy.workspace_id,
       legacy.contact_id,
       CASE COALESCE(NULLIF(ch.provider_type,''),ch.connector_type)
         WHEN 'whatsapp_cloud' THEN 'whatsapp'
         ELSE COALESCE(NULLIF(ch.provider_type,''),ch.connector_type)
       END AS platform,
       legacy.channel_profile_id,
       '',
       CASE COALESCE(NULLIF(ch.provider_type,''),ch.connector_type)
         WHEN 'whatsapp_cloud' THEN legacy.channel_profile_id
         ELSE ''
       END,
       legacy.display_name,
       legacy.metadata_json,
       legacy.created_at,
       legacy.created_at
FROM channel_identities legacy
JOIN channels ch ON ch.channel_id=legacy.channel_id AND ch.workspace_id=legacy.workspace_id
WHERE legacy.identity_id=(
  SELECT candidate.identity_id
  FROM channel_identities candidate
  JOIN channels candidate_channel
    ON candidate_channel.channel_id=candidate.channel_id
   AND candidate_channel.workspace_id=candidate.workspace_id
  WHERE candidate.workspace_id=legacy.workspace_id
    AND candidate.contact_id=legacy.contact_id
    AND candidate.channel_profile_id=legacy.channel_profile_id
    AND (CASE COALESCE(NULLIF(candidate_channel.provider_type,''),candidate_channel.connector_type)
           WHEN 'whatsapp_cloud' THEN 'whatsapp'
           ELSE COALESCE(NULLIF(candidate_channel.provider_type,''),candidate_channel.connector_type)
         END)=
        (CASE COALESCE(NULLIF(ch.provider_type,''),ch.connector_type)
           WHEN 'whatsapp_cloud' THEN 'whatsapp'
           ELSE COALESCE(NULLIF(ch.provider_type,''),ch.connector_type)
         END)
  ORDER BY candidate.created_at,candidate.identity_id
  LIMIT 1
);

INSERT OR IGNORE INTO channel_identity_bindings
    (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,metadata_json,
     active,first_seen_at,last_seen_at,created_at,updated_at)
SELECT legacy.identity_id,
       legacy.workspace_id,
       canonical.identity_id,
       legacy.channel_id,
       legacy.channel_profile_id,
       legacy.metadata_json,
       1,
       legacy.created_at,
       legacy.created_at,
       legacy.created_at,
       legacy.created_at
FROM channel_identities legacy
JOIN channels ch ON ch.channel_id=legacy.channel_id AND ch.workspace_id=legacy.workspace_id
JOIN contact_identities canonical
  ON canonical.workspace_id=legacy.workspace_id
 AND canonical.contact_id=legacy.contact_id
 AND canonical.profile_id=legacy.channel_profile_id
 AND canonical.platform=(CASE COALESCE(NULLIF(ch.provider_type,''),ch.connector_type)
      WHEN 'whatsapp_cloud' THEN 'whatsapp'
      ELSE COALESCE(NULLIF(ch.provider_type,''),ch.connector_type)
    END);

-- Empty means the old data was ambiguous and continues to use the legacy
-- contact/channel fallback.  New writes always persist an exact identity.
ALTER TABLE conversations ADD COLUMN identity_id TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN identity_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS identity_migration_issues (
  issue_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  resolved_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_identity_migration_issues_workspace_open
  ON identity_migration_issues(workspace_id,resolved_at,created_at);

UPDATE conversations
SET identity_id=COALESCE((
  SELECT MIN(binding.identity_id)
  FROM channel_identity_bindings binding
  JOIN contact_identities identity ON identity.identity_id=binding.identity_id
  WHERE binding.workspace_id=conversations.workspace_id
    AND binding.channel_id=conversations.channel_id
    AND identity.contact_id=conversations.contact_id
  HAVING COUNT(*)=1
), '')
WHERE identity_id='';

-- Do not guess when old rows have no route or several possible routes.  Keep
-- compatibility behavior and record an inspectable issue for an administrator
-- or later repair job.
INSERT OR IGNORE INTO identity_migration_issues
    (issue_id,workspace_id,conversation_id,issue_type,candidate_count,details_json,created_at,resolved_at)
SELECT conversations.conversation_id||':identity-backfill',
       conversations.workspace_id,
       conversations.conversation_id,
       CASE WHEN COUNT(binding.binding_id)=0 THEN 'missing_identity' ELSE 'ambiguous_identity' END,
       COUNT(binding.binding_id),
       json_object('contactId',conversations.contact_id,'channelId',conversations.channel_id),
       datetime('now'),
       ''
FROM conversations
LEFT JOIN contact_identities identity
  ON identity.workspace_id=conversations.workspace_id
 AND identity.contact_id=conversations.contact_id
LEFT JOIN channel_identity_bindings binding
  ON binding.workspace_id=conversations.workspace_id
 AND binding.identity_id=identity.identity_id
 AND binding.channel_id=conversations.channel_id
 AND binding.active=1
WHERE conversations.identity_id=''
GROUP BY conversations.workspace_id,conversations.conversation_id
HAVING COUNT(binding.binding_id)<>1;

UPDATE messages
SET identity_id=COALESCE((
  SELECT conversation.identity_id
  FROM conversations conversation
  WHERE conversation.workspace_id=messages.workspace_id
    AND conversation.conversation_id=messages.conversation_id
), '')
WHERE identity_id='';

UPDATE channel_identity_bindings
SET last_inbound_at=COALESCE((SELECT MAX(m.timestamp) FROM messages m
      WHERE m.workspace_id=channel_identity_bindings.workspace_id
        AND m.identity_id=channel_identity_bindings.identity_id
        AND m.channel_id=channel_identity_bindings.channel_id
        AND m.direction='inbound'),''),
    last_outbound_at=COALESCE((SELECT MAX(m.timestamp) FROM messages m
      WHERE m.workspace_id=channel_identity_bindings.workspace_id
        AND m.identity_id=channel_identity_bindings.identity_id
        AND m.channel_id=channel_identity_bindings.channel_id
        AND m.direction='outbound'),''),
    last_conversation_id=COALESCE((SELECT c.conversation_id FROM conversations c
      WHERE c.workspace_id=channel_identity_bindings.workspace_id
        AND c.identity_id=channel_identity_bindings.identity_id
        AND c.channel_id=channel_identity_bindings.channel_id
      ORDER BY c.last_message_at DESC,c.created_at DESC LIMIT 1),'');

UPDATE channel_identity_bindings
SET last_seen_at=MAX(last_seen_at,last_inbound_at,last_outbound_at);

DROP INDEX IF EXISTS idx_conversations_workspace_contact_channel_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_workspace_identity_channel_unique
  ON conversations(workspace_id, identity_id, channel_id)
  WHERE identity_id<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_workspace_legacy_contact_channel_unique
  ON conversations(workspace_id, contact_id, channel_id)
  WHERE identity_id='';
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_contact_channel_compat
  ON conversations(workspace_id, contact_id, channel_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_workspace_identity_time
  ON messages(workspace_id, identity_id, timestamp DESC);
