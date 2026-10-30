-- Give the operator's internal workspace its branded slug. Runtime code resolves
-- the internal workspace by kind, never by this slug; the rename is cosmetic for
-- the admin panel and delete-confirmation flow.
UPDATE workspaces SET slug='helixcer' WHERE slug='default';
