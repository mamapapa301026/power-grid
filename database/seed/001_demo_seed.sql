INSERT INTO substations (id, name, district, nominal_voltage_kv, status) VALUES
  ('north', 'ПС Северная', 'Северный район', 110, 'normal'),
  ('central', 'ПС Центральная', 'Центральный район', 220, 'warning'),
  ('east', 'ПС Восточная', 'Восточный район', 110, 'normal'),
  ('south', 'ПС Южная', 'Южный район', 110, 'normal'),
  ('west', 'ПС Западная', 'Западный район', 35, 'critical')
ON CONFLICT (id) DO NOTHING;

INSERT INTO equipment (id, substation_id, connected_substation_id, name, kind, status) VALUES
  ('transformer-west-2', 'west', NULL, 'Трансформатор Т-2', 'transformer', 'warning'),
  ('line-07', 'north', 'central', 'Линия Л-07', 'line', 'normal'),
  ('line-12', 'central', 'east', 'Линия Л-12', 'line', 'normal'),
  ('line-03', 'central', 'south', 'Линия Л-03', 'line', 'normal'),
  ('line-20', 'central', 'south', 'Линия Л-20', 'line', 'normal'),
  ('line-14', 'east', 'west', 'Линия Л-14', 'line', 'warning')
ON CONFLICT (id) DO NOTHING;