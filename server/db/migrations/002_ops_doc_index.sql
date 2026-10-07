-- Look up a doc's history (latest writer) without scanning dojo_ops. Portable (SQLite and Postgres).
CREATE INDEX IF NOT EXISTS dojo_ops_doc ON dojo_ops (tbl, id);
