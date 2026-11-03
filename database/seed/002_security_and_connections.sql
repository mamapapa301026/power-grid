INSERT INTO roles (id, permissions) VALUES
  ('operator', '["telemetry:read", "alarms:read", "alarms:acknowledge"]'::jsonb),
  ('engineer', '["telemetry:read", "equipment:read", "reports:read"]'::jsonb),
  ('administrator', '["*"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (subject_id, display_name, role) VALUES
  ('demo-operator', 'Демо-диспетчер', 'operator')
ON CONFLICT (subject_id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT id, 'operator' FROM users WHERE subject_id = 'demo-operator'
ON CONFLICT DO NOTHING;

INSERT INTO network_connections (id, equipment_id, from_substation_id, to_substation_id) VALUES
  ('connection-line-07', 'line-07', 'north', 'central'),
  ('connection-line-12', 'line-12', 'central', 'east'),
  ('connection-line-03', 'line-03', 'central', 'south'),
  ('connection-line-20', 'line-20', 'central', 'south'),
  ('connection-line-14', 'line-14', 'east', 'west')
ON CONFLICT (id) DO NOTHING;

INSERT INTO data_sources (id, name, source_type, status) VALUES
  ('demo-simulator', 'Демо-симулятор', 'simulator', 'unknown')
ON CONFLICT (id) DO NOTHING;

UPDATE substations SET load_percent = CASE id
  WHEN 'north' THEN 68
  WHEN 'central' THEN 84
  WHEN 'east' THEN 52
  WHEN 'south' THEN 39
  WHEN 'west' THEN 91
  ELSE load_percent
END;