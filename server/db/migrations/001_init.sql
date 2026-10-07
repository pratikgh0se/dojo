-- Dojo storage v1. Plain SQL that runs unchanged on SQLite and Postgres (see the spec, section 2).
-- Text ids, ISO-8601 UTC text timestamps, JSON kept in text columns (jsonb on Postgres).
CREATE TABLE IF NOT EXISTS dojo_schema_migrations (
  version text NOT NULL PRIMARY KEY,
  applied_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS dojo_docs (
  tbl text NOT NULL,
  id text NOT NULL,
  doc text NOT NULL,
  updated_at text NOT NULL,
  deleted integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tbl, id)
);

CREATE TABLE IF NOT EXISTS dojo_ops (
  seq bigint NOT NULL PRIMARY KEY,
  at text NOT NULL,
  client_id text NOT NULL,
  tbl text NOT NULL,
  op text NOT NULL,
  id text,
  doc text,
  op_id text UNIQUE
);
