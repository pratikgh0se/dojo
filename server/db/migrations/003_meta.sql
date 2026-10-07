-- Database identity (C2). One row, key 'db_id', written by runMigrations right after this migration
-- because plain SQL has no portable random id. A browser syncs only to the db_id it adopted, so a
-- replaced or restored dojo.db is never written by a browser that has not adopted it.
CREATE TABLE IF NOT EXISTS dojo_meta (
  key text NOT NULL PRIMARY KEY,
  value text NOT NULL
);
