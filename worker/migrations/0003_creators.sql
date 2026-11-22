-- For databases created before creator tools existed. Run once.
ALTER TABLE packs ADD COLUMN ai_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE versions ADD COLUMN loot_url TEXT;
ALTER TABLE versions ADD COLUMN loot_tries INTEGER NOT NULL DEFAULT 0;
-- then re-run schema.sql, which adds the new tables.
