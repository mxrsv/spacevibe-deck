-- No IP address, user agent, location, persistent install ID or arbitrary payload.
CREATE TABLE usage_days (
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  daily_id TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('darwin', 'win32')),
  arch TEXT NOT NULL CHECK (arch IN ('arm64', 'x64')),
  agents TEXT NOT NULL CHECK (json_valid(agents)),
  surfaces TEXT NOT NULL CHECK (json_valid(surfaces)),
  max_tabs INTEGER NOT NULL CHECK (max_tabs BETWEEN 0 AND 1000000),
  max_panes INTEGER NOT NULL CHECK (max_panes BETWEEN 0 AND 1000000),
  restored_sessions INTEGER NOT NULL CHECK (restored_sessions IN (0, 1)),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (schema_version, daily_id, day)
) WITHOUT ROWID;
CREATE INDEX usage_days_retention ON usage_days (received_at);

-- Internal coarse totals only. There is no public statistics/export endpoint.
CREATE TABLE usage_aggregates (
  schema_version INTEGER NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  participating_installs INTEGER NOT NULL,
  agents TEXT NOT NULL CHECK (json_valid(agents)),
  surfaces TEXT NOT NULL CHECK (json_valid(surfaces)),
  tabs_total INTEGER NOT NULL,
  panes_total INTEGER NOT NULL,
  restored_total INTEGER NOT NULL,
  PRIMARY KEY (schema_version, day, version, platform, arch)
) WITHOUT ROWID;
