PRAGMA foreign_keys = ON;

-- Agents may be limited to specific messaging channels. An empty JSON array means
-- unrestricted access (legacy members and non-agent roles). Admins and owners always
-- have full channel access regardless of this column.
ALTER TABLE memberships ADD COLUMN allowed_channel_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE invitations ADD COLUMN allowed_channel_ids_json TEXT NOT NULL DEFAULT '[]';
