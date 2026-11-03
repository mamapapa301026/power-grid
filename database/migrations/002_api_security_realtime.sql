CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS network_connections (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL UNIQUE REFERENCES equipment(id) ON DELETE CASCADE,
  from_substation_id TEXT NOT NULL REFERENCES substations(id),
  to_substation_id TEXT NOT NULL REFERENCES substations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  voltage DOUBLE PRECISION NOT NULL CHECK (voltage >= 0),
  current DOUBLE PRECISION NOT NULL CHECK (current >= 0),
  active_power DOUBLE PRECISION NOT NULL,
  frequency DOUBLE PRECISION NOT NULL CHECK (frequency >= 0),
  measured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE alarms ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE alarms ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE substations ADD COLUMN IF NOT EXISTS load_percent DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS telemetry_equipment_time_idx
  ON telemetry (equipment_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS alarms_state_time_idx
  ON alarms (state, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_subject_time_idx
  ON audit_logs (subject_id, created_at DESC);