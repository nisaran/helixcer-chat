PRAGMA foreign_keys = ON;

-- Personal profile fields editable from the account menu. Email / login ID stays on users.email.
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN address_line1 TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN address_line2 TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT '';
