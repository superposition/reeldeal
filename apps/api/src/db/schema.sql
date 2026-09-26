PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES orgs(id),
  label TEXT NOT NULL,
  wallet TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fish_scans (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  device_id TEXT,
  user_id TEXT REFERENCES users(id),
  captured_at INTEGER NOT NULL,
  image_ref TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'captured',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES fish_scans(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'recorded',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES fish_scans(id),
  observation_id TEXT NOT NULL REFERENCES observations(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  question_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('choice', 'score', 'noul')),
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confidence_source TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  runtime TEXT NOT NULL,
  model_sha256 TEXT,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  status TEXT NOT NULL DEFAULT 'recorded',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES fish_scans(id),
  lot_id TEXT REFERENCES lots(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  field TEXT NOT NULL,
  model_value TEXT,
  human_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  scan_id TEXT NOT NULL REFERENCES fish_scans(id),
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  user_id TEXT REFERENCES users(id),
  species_label TEXT,
  weight_g REAL,
  price_jpy INTEGER NOT NULL CHECK (price_jpy >= 0),
  status TEXT NOT NULL DEFAULT 'draft',
  gate_reason TEXT,
  gate_policy_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL UNIQUE REFERENCES lots(id),
  seller_org_id TEXT NOT NULL REFERENCES orgs(id),
  price_jpy INTEGER NOT NULL CHECK (price_jpy >= 0),
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  bidder_user_id TEXT NOT NULL REFERENCES users(id),
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy >= 0),
  bidder TEXT NOT NULL,
  nonce TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bids_listing_nonce ON bids(listing_id, nonce);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL UNIQUE REFERENCES listings(id),
  bid_id TEXT NOT NULL UNIQUE REFERENCES bids(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  buyer_user_id TEXT NOT NULL REFERENCES users(id),
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy >= 0),
  status TEXT NOT NULL DEFAULT 'agreed',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy >= 0),
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'quoted',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provenance_records (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  payload_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT,
  anchor_status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  org_id TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'device', 'wallet', 'system')),
  actor_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  request_id TEXT NOT NULL,
  payload_json TEXT,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS observations_scan_created ON observations(scan_id, created_at);
CREATE INDEX IF NOT EXISTS decisions_scan_created ON decisions(scan_id, created_at);
CREATE INDEX IF NOT EXISTS audit_entity_at ON audit_log(entity_type, entity_id, at);
