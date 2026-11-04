-- Deliberately no backfill: existing campaigns require an explicit recovery decision.
CREATE TABLE IF NOT EXISTS campaign_jobs (
  campaign_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  lease_until TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_due ON campaign_jobs(state, lease_until, created_at);
