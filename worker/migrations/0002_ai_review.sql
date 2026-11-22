-- Only for databases created before the AI reviewer existed.
ALTER TABLE packs ADD COLUMN ai_verdict TEXT;
ALTER TABLE packs ADD COLUMN ai_confidence REAL;
ALTER TABLE packs ADD COLUMN ai_summary TEXT;
ALTER TABLE packs ADD COLUMN ai_issues TEXT;
ALTER TABLE packs ADD COLUMN ai_checked_at TEXT;
ALTER TABLE versions ADD COLUMN ai_verdict TEXT;
