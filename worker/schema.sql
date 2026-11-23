CREATE TABLE IF NOT EXISTS packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  icon_key TEXT,
  linkvertise_id TEXT,                      -- unused: now stored per creator
  loot_url TEXT,                            -- unused: now generated per version
  showcase_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  review_note TEXT,
  ai_verdict TEXT,                          -- approve | reject | error | skipped
  ai_confidence REAL,
  ai_summary TEXT,
  ai_issues TEXT,
  ai_checked_at TEXT,
  ai_runs INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS packs_owner ON packs(owner_id);
CREATE INDEX IF NOT EXISTS packs_status ON packs(status);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  review_note TEXT,
  ai_verdict TEXT,
  loot_url TEXT,                            -- LootLabs link, generated automatically
  loot_tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_pack ON versions(pack_id);

-- One row per creator: earnings setup and public profile.
CREATE TABLE IF NOT EXISTS creators (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  linkvertise_id TEXT,
  loot_token TEXT,                          -- LootLabs API token, AES-GCM encrypted
  loot_status TEXT,                         -- untested | ok | failed: ...
  draft_json TEXT,                          -- what the creator typed {bio, socials, videos}
  public_json TEXT,                         -- what passed review and is shown publicly
  profile_status TEXT NOT NULL DEFAULT 'approved',  -- pending | approved
  profile_note TEXT,
  profile_ai TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS creators_username ON creators(username);

-- Views (version_id = 0) and downloads per pack per day.
CREATE TABLE IF NOT EXISTS stats_daily (
  pack_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pack_id, version_id, day)
);
CREATE INDEX IF NOT EXISTS stats_day ON stats_daily(day);

-- Hashes of visitor+item+day so one person is counted once a day.
CREATE TABLE IF NOT EXISTS seen (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL
);

-- ===== Follows, direct messages and blocks =====
-- Ids are accounts-worker user ids (users.id in this same database).

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows(followee_id);

-- pair is the two user ids sorted and joined with "|", one per conversation.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(pair, id);
CREATE INDEX IF NOT EXISTS messages_unread ON messages(recipient_id, read_at);
CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id, created_at);

-- A block stops messages and follows in both directions.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- Small facts the worker learns about the site, e.g. which account is the
-- site owner (so lists and DMs can badge them without asking the accounts
-- worker about every person).
CREATE TABLE IF NOT EXISTS site_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Which version of the terms a user agreed to when uploading (one row per
-- user and version). The version must match TERMS_VERSION in src/index.js and
-- upload.js, and the date shown on the terms page.
CREATE TABLE IF NOT EXISTS consents (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, version)
);

-- Messaging privacy: followers_only = 1 means only people who follow this
-- account can start or continue a conversation with them.
CREATE TABLE IF NOT EXISTS dm_settings (
  user_id TEXT PRIMARY KEY,
  followers_only INTEGER NOT NULL DEFAULT 0
);
