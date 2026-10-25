-- Doppelpunkt beta collector, initial schema (Cloudflare D1 / SQLite).
-- Nothing here holds an IP address, a raw install id, a name or an email address.
-- Retention (src/collector.ts, purge): crashes 90 days, feedback 1 year, installs 120 days after last upload.

-- "This is wrong / unclear" reports. No install id: reports can't be linked to each other or to stats.
CREATE TABLE feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at     INTEGER NOT NULL,           -- server time, ms since epoch
  app_version     TEXT    NOT NULL,
  content_version TEXT    NOT NULL,
  item_id         TEXT    NOT NULL,
  unit_id         TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  comment         TEXT,                       -- scrubbed again on the server
  answer          TEXT,                       -- only when the learner ticked "include my answer"; scrubbed
  at              TEXT    NOT NULL            -- client timestamp (ISO 8601)
);
CREATE INDEX feedback_received_at ON feedback (received_at);

-- Per-item counters, summed on insert. No install id per row.
CREATE TABLE item_stats (
  item_id         TEXT    NOT NULL,
  content_version TEXT    NOT NULL,
  app_version     TEXT    NOT NULL,
  band            TEXT    NOT NULL DEFAULT '', -- coarse level band, '' when unknown
  day             TEXT    NOT NULL,            -- ISO date of the upload
  cohort          TEXT    NOT NULL,            -- ISO week the uploading install was first seen
  attempts        INTEGER NOT NULL DEFAULT 0,
  bucket_low      INTEGER NOT NULL DEFAULT 0,  -- first-try score in [0, 0.5)
  bucket_mid      INTEGER NOT NULL DEFAULT 0,  -- [0.5, 0.8)
  bucket_high     INTEGER NOT NULL DEFAULT 0,  -- [0.8, 1]
  seconds         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, content_version, app_version, band, day, cohort)
) WITHOUT ROWID;
CREATE INDEX item_stats_day ON item_stats (day);

-- One row per opted-in install, for retention cohorts only.
CREATE TABLE installs (
  install_hash    TEXT    PRIMARY KEY,         -- HMAC-SHA-256(install id, INSTALL_SECRET)
  first_seen_day  TEXT    NOT NULL,
  first_seen_week TEXT    NOT NULL,            -- ISO week, e.g. 2026-W43
  last_seen_day   TEXT    NOT NULL,
  active_weeks    INTEGER NOT NULL DEFAULT 1   -- bit k = active in week k after the first week
) WITHOUT ROWID;
CREATE INDEX installs_last_seen_day ON installs (last_seen_day);

-- Crash reports, scrubbed on the device and again on the server.
CREATE TABLE crashes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  app_version TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  stack       TEXT,
  route       TEXT    NOT NULL,
  browser     TEXT    NOT NULL,
  at          TEXT    NOT NULL
);
CREATE INDEX crashes_received_at ON crashes (received_at);
