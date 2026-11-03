ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'valid';
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS quality_flags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE telemetry DROP CONSTRAINT IF EXISTS telemetry_frequency_check;
ALTER TABLE telemetry DROP CONSTRAINT IF EXISTS telemetry_frequency_nonnegative;
ALTER TABLE telemetry ADD CONSTRAINT telemetry_frequency_nonnegative CHECK (frequency >= 0);

DELETE FROM telemetry older
USING telemetry newer
WHERE older.equipment_id = newer.equipment_id
  AND older.measured_at = newer.measured_at
  AND older.id < newer.id;

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_equipment_measured_unique
  ON telemetry (equipment_id, measured_at);

CREATE TABLE IF NOT EXISTS telemetry_quality_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  source_id TEXT REFERENCES data_sources(id),
  event_code TEXT NOT NULL CHECK (event_code IN ('stale', 'future', 'duplicate', 'out_of_range')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  measured_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telemetry_quality_equipment_time_idx
  ON telemetry_quality_events (equipment_id, received_at DESC);