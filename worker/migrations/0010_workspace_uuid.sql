PRAGMA foreign_keys = ON;

-- Replace the original bootstrap identifier with the workspace's permanent
-- UUID. The mapping table makes the database-generated value reusable across
-- every workspace-scoped table in this one atomic migration.
CREATE TABLE workspace_id_migration_0010 (
  old_workspace_id TEXT PRIMARY KEY,
  new_workspace_id TEXT NOT NULL UNIQUE,
  old_slug TEXT NOT NULL
);

INSERT INTO workspace_id_migration_0010 (old_workspace_id,new_workspace_id,old_slug)
SELECT workspace_id,
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-' ||
    '4' || substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  slug
FROM workspaces
WHERE workspace_id='ws_default';

-- Free the unique slug while cloning the parent row under its new primary key.
UPDATE workspaces
SET slug='__workspace_id_migration_0010__'
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

INSERT INTO workspaces (
  workspace_id,slug,name,created_at,updated_at,registered_name,address_line1,address_line2,
  city,state,postal_code,country,gstin,tax_details
)
SELECT migration.new_workspace_id,migration.old_slug,workspace.name,workspace.created_at,workspace.updated_at,
  workspace.registered_name,workspace.address_line1,workspace.address_line2,
  workspace.city,workspace.state,workspace.postal_code,workspace.country,workspace.gstin,workspace.tax_details
FROM workspaces workspace
JOIN workspace_id_migration_0010 migration ON migration.old_workspace_id=workspace.workspace_id;

-- AES-GCM additional data includes workspace_id. These values cannot be
-- rewritten in SQL, so require the administrator to reconnect each channel.
DELETE FROM channel_credentials
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

-- Encrypted queued provider payloads use the same workspace-bound AAD. Keep
-- their visible message history, but stop the jobs and mark them failed.
UPDATE messages
SET status='failed',error='Channel reconnection is required after the workspace ID migration.'
WHERE message_id IN (
  SELECT outbox.message_id
  FROM outbox
  JOIN workspace_id_migration_0010 migration ON migration.old_workspace_id=outbox.workspace_id
);

DELETE FROM outbox
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

DELETE FROM outbound_payloads
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

-- Credentials and provider verification must be completed again, but channel
-- IDs/configuration and all historical conversations remain available.
UPDATE channels
SET config_json=CASE WHEN json_valid(config_json) THEN json_remove(
      config_json,
      '$.credentialsVerifiedAt','$.webhookVerifiedAt','$.subscribedAppsAt',
      '$.verifiedPhoneNumber','$.verifiedName','$.verifiedUsername','$.verifiedProviderId'
    ) ELSE '{}' END,
    workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

UPDATE memberships SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE sessions SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE invitations SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE contacts SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE channel_identities SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE conversations SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE messages SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE agents SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE api_keys SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE external_api_requests SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);
UPDATE push_subscriptions SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

-- Preserve webhook deduplication across the rename by rewriting the embedded
-- workspace prefix as well as the scoped column.
UPDATE webhook_events
SET event_key=(SELECT new_workspace_id FROM workspace_id_migration_0010) ||
      substr(event_key, length((SELECT old_workspace_id FROM workspace_id_migration_0010)) + 1),
    workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010)
  AND event_key LIKE (SELECT old_workspace_id FROM workspace_id_migration_0010) || ':%';
UPDATE webhook_events SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010)
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

UPDATE audit_log
SET workspace_id=(SELECT new_workspace_id FROM workspace_id_migration_0010),
    target_id=CASE WHEN target_type='workspace' AND target_id=(SELECT old_workspace_id FROM workspace_id_migration_0010)
      THEN (SELECT new_workspace_id FROM workspace_id_migration_0010) ELSE target_id END
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

DELETE FROM workspaces
WHERE workspace_id IN (SELECT old_workspace_id FROM workspace_id_migration_0010);

DROP TABLE workspace_id_migration_0010;
