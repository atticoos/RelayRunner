-- One-time rename of migrations applied under the old counter names (0000_init.sql, ...).
-- Wrangler tracks applied migrations by filename in d1_migrations, so without this it would
-- re-run the renamed files. Idempotent: on a fresh database, or once the rows are renamed,
-- the UPDATEs match nothing. The CREATE mirrors the table Wrangler makes itself.
CREATE TABLE IF NOT EXISTS d1_migrations(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
UPDATE d1_migrations SET name = '20261104052836_init.sql' WHERE name = '0000_init.sql';
UPDATE d1_migrations SET name = '20261104160202_workspaces.sql' WHERE name = '0001_workspaces.sql';
UPDATE d1_migrations SET name = '20261104163332_installation_repository_selection.sql' WHERE name = '0002_installation_repository_selection.sql';
UPDATE d1_migrations SET name = '20261104164926_installation_github_state_at.sql' WHERE name = '0003_installation_github_state_at.sql';
