CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS substations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT NOT NULL,
  nominal_voltage_kv INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  substation_id TEXT NOT NULL REFERENCES substations(id),
  connected_substation_id TEXT REFERENCES substations(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'normal'
);

CREATE TABLE IF NOT EXISTS alarms (
  id TEXT PRIMARY KEY,
  equipment_id TEXT REFERENCES equipment(id),
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry_measurements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  voltage DOUBLE PRECISION NOT NULL,
  current DOUBLE PRECISION NOT NULL,
  active_power DOUBLE PRECISION NOT NULL,
  frequency DOUBLE PRECISION NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS telemetry_equipment_time_idx
  ON telemetry_measurements (equipment_id, measured_at DESC);