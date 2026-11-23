PRAGMA foreign_keys = ON;

-- Platform-wide announcements created in Helixcer Admin and shown in the app bell.
CREATE TABLE IF NOT EXISTS platform_notifications (
  notification_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link_url TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'all',
  workspace_id TEXT NOT NULL DEFAULT '',
  target_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  recipient_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_platform_notifications_created
  ON platform_notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS platform_notification_deliveries (
  delivery_id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  UNIQUE (notification_id, membership_id),
  FOREIGN KEY (notification_id) REFERENCES platform_notifications(notification_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_notification_deliveries_member
  ON platform_notification_deliveries (membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_notification_deliveries_user_ws
  ON platform_notification_deliveries (user_id, workspace_id, created_at DESC);
