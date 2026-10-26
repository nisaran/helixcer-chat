PRAGMA foreign_keys = ON;

-- A deployment currently has exactly one workspace, but the profile remains
-- workspace-scoped so a future multi-tenant release does not need a data move.
ALTER TABLE workspaces ADD COLUMN registered_name TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN address_line1 TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN address_line2 TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN gstin TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN tax_details TEXT NOT NULL DEFAULT '';
