PRAGMA foreign_keys = ON;

-- The public contact model exposes one identifier per supported platform.
-- Keep the canonical identity row as the routing/history anchor, while this
-- table selects the single identity that represents each platform on a contact.
-- Older duplicate identities remain intact so conversations are never orphaned.
CREATE TABLE IF NOT EXISTS contact_platform_ids (
  workspace_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('whatsapp','telegram','instagram','facebook','email')),
  profile_id TEXT NOT NULL,
  identity_id TEXT NOT NULL REFERENCES contact_identities(identity_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, contact_id, platform),
  UNIQUE (identity_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_platform_ids_lookup
  ON contact_platform_ids(workspace_id, platform, profile_id);

-- Prefer the explicitly primary identity, then the identity with the most
-- recent route activity.  This resolves legacy duplicates deterministically
-- without deleting any identity or its message history.
INSERT OR IGNORE INTO contact_platform_ids
    (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
SELECT workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at
FROM (
  SELECT ci.workspace_id,ci.contact_id,ci.platform,ci.profile_id,ci.identity_id,
         ci.created_at,ci.updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY ci.workspace_id,ci.contact_id,ci.platform
           ORDER BY CASE WHEN json_extract(ci.metadata_json,'$.isPrimary')=1 THEN 0 ELSE 1 END,
                    COALESCE((SELECT MAX(NULLIF(binding.last_seen_at,''))
                      FROM channel_identity_bindings binding
                      WHERE binding.workspace_id=ci.workspace_id
                        AND binding.identity_id=ci.identity_id),'') DESC,
                    ci.updated_at DESC,ci.created_at,ci.identity_id
         ) AS rank_in_platform
  FROM contact_identities ci
  WHERE ci.platform IN ('whatsapp','telegram','instagram','facebook','email')
) ranked
WHERE rank_in_platform=1;
