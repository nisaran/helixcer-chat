PRAGMA foreign_keys = ON;

-- Google Reviews contacts use platform='google' with profile IDs like review:{id}.
-- Expand the flat contact_platform_ids CHECK constraint and normalize any
-- identities that were previously stored as google_reviews.

UPDATE contact_identities
SET platform='google', updated_at=datetime('now')
WHERE platform IN ('google_reviews', 'google_business');

CREATE TABLE contact_platform_ids_0033 (
  workspace_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('whatsapp','telegram','instagram','facebook','email','google')),
  profile_id TEXT NOT NULL,
  identity_id TEXT NOT NULL REFERENCES contact_identities(identity_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, contact_id, platform),
  UNIQUE (identity_id)
);

INSERT INTO contact_platform_ids_0033
  (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
SELECT workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at
FROM contact_platform_ids;

DROP TABLE contact_platform_ids;
ALTER TABLE contact_platform_ids_0033 RENAME TO contact_platform_ids;

CREATE INDEX IF NOT EXISTS idx_contact_platform_ids_lookup
  ON contact_platform_ids(workspace_id, platform, profile_id);

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
  WHERE ci.platform='google'
) ranked
WHERE rank_in_platform=1;
