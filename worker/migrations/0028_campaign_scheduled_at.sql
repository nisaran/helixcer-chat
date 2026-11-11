PRAGMA foreign_keys = ON;

-- Optional send-at time for campaigns created with Schedule.
-- Empty string means send immediately (legacy / Review & send).
ALTER TABLE campaigns ADD COLUMN scheduled_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_due
  ON campaigns (scheduled_at)
  WHERE status = 'scheduled' AND scheduled_at <> '';
