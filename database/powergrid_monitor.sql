CREATE DATABASE IF NOT EXISTS powergrid_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE powergrid_monitor;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS app_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  session_signing_key VARCHAR(64) NULL,
  tariff_per_kwh DECIMAL(10, 2) NOT NULL DEFAULT 31.20,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

INSERT INTO app_settings (id, tariff_per_kwh) VALUES (1, 31.20)
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  display_name VARCHAR(80) NOT NULL,
  permissions JSON NOT NULL
) ENGINE=InnoDB;

INSERT INTO roles (id, display_name, permissions) VALUES
  ('customer', 'Потребитель', JSON_ARRAY('portal:read', 'support:write')),
  ('operator', 'Диспетчер', JSON_ARRAY('telemetry:read', 'alarms:read', 'alarms:acknowledge', 'support:manage')),
  ('engineer', 'Инженер', JSON_ARRAY('telemetry:read', 'equipment:read', 'reports:read', 'alarms:resolve')),
  ('administrator', 'Администратор', JSON_ARRAY('*'))
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), permissions = VALUES(permissions);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subject_id CHAR(36) NOT NULL UNIQUE,
  username VARCHAR(80) NOT NULL UNIQUE,
  display_name VARCHAR(160) NOT NULL,
  password_salt VARCHAR(32) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'customer',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT users_role_fk FOREIGN KEY (role) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS substations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  district VARCHAR(160) NOT NULL,
  nominal_voltage_kv INT NOT NULL,
  load_percent DECIMAL(6, 2) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'normal',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

INSERT INTO substations (id, name, district, nominal_voltage_kv, load_percent, status) VALUES
  ('north', 'ПС Северная', 'Северный район', 110, 68, 'normal'),
  ('central', 'ПС Центральная', 'Центральный район', 220, 84, 'warning'),
  ('east', 'ПС Восточная', 'Восточный район', 110, 52, 'normal'),
  ('south', 'ПС Южная', 'Южный район', 110, 39, 'normal'),
  ('west', 'ПС Западная', 'Западный район', 35, 91, 'critical')
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS equipment (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  substation_id VARCHAR(64) NOT NULL,
  connected_substation_id VARCHAR(64) NULL,
  name VARCHAR(160) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'normal',
  CONSTRAINT equipment_substation_fk FOREIGN KEY (substation_id) REFERENCES substations(id),
  CONSTRAINT equipment_connected_substation_fk FOREIGN KEY (connected_substation_id) REFERENCES substations(id)
) ENGINE=InnoDB;

INSERT INTO equipment (id, substation_id, connected_substation_id, name, kind, status) VALUES
  ('transformer-west-2', 'west', NULL, 'Трансформатор Т-2', 'transformer', 'warning'),
  ('line-07', 'north', 'central', 'Линия Л-07', 'line', 'normal'),
  ('line-12', 'central', 'east', 'Линия Л-12', 'line', 'normal'),
  ('line-03', 'central', 'south', 'Линия Л-03', 'line', 'normal'),
  ('line-20', 'central', 'south', 'Линия Л-20', 'line', 'normal'),
  ('line-14', 'east', 'west', 'Линия Л-14', 'line', 'warning')
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS alarms (
  id CHAR(36) NOT NULL PRIMARY KEY,
  equipment_id VARCHAR(64) NULL,
  severity VARCHAR(32) NOT NULL,
  title VARCHAR(240) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'active',
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  CONSTRAINT alarms_equipment_fk FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  INDEX alarms_state_time_idx (state, occurred_at)
) ENGINE=InnoDB;

INSERT INTO alarms (id, equipment_id, severity, title, state, acknowledged, occurred_at) VALUES
  ('alarm-001', 'transformer-west-2', 'critical', 'Перегрузка трансформатора', 'active', FALSE, UTC_TIMESTAMP(3) - INTERVAL 3 MINUTE),
  ('alarm-002', 'line-14', 'warning', 'Отклонение напряжения', 'active', FALSE, UTC_TIMESTAMP(3) - INTERVAL 7 MINUTE)
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS data_sources (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  last_seen_at DATETIME(3) NULL,
  last_error TEXT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

INSERT INTO data_sources (id, name, source_type, status) VALUES
  ('demo-simulator', 'Локальный симулятор', 'simulator', 'unknown')
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS telemetry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  equipment_id VARCHAR(64) NOT NULL,
  voltage DOUBLE NOT NULL,
  current DOUBLE NOT NULL,
  active_power DOUBLE NOT NULL,
  frequency DOUBLE NOT NULL,
  measured_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  quality_status VARCHAR(16) NOT NULL DEFAULT 'valid',
  quality_flags JSON NOT NULL,
  CONSTRAINT telemetry_equipment_fk FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  CONSTRAINT telemetry_equipment_measured_unique UNIQUE (equipment_id, measured_at),
  INDEX telemetry_equipment_time_idx (equipment_id, measured_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS telemetry_quality_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  equipment_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NULL,
  event_code VARCHAR(32) NOT NULL,
  details JSON NOT NULL,
  measured_at DATETIME(3) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT quality_equipment_fk FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  CONSTRAINT quality_source_fk FOREIGN KEY (source_id) REFERENCES data_sources(id),
  INDEX telemetry_quality_equipment_time_idx (equipment_id, received_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subject_id CHAR(36) NULL,
  action VARCHAR(32) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(160) NULL,
  details JSON NOT NULL,
  source_ip VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX audit_logs_subject_time_idx (subject_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_conversations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_subject CHAR(36) NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  title VARCHAR(240) NOT NULL DEFAULT 'Консультация',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  assigned_to CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX support_conversations_owner_updated_idx (owner_subject, updated_at),
  INDEX support_conversations_status_updated_idx (status, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_messages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  sender_subject CHAR(36) NOT NULL,
  sender_type VARCHAR(16) NOT NULL,
  body VARCHAR(4000) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT support_messages_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES support_conversations(id) ON DELETE CASCADE,
  INDEX support_messages_conversation_time_idx (conversation_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_subject CHAR(36) NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(240) NOT NULL,
  building VARCHAR(160) NOT NULL,
  meter_id VARCHAR(64) NOT NULL UNIQUE,
  meter_status VARCHAR(16) NOT NULL DEFAULT 'offline',
  supply_status ENUM('unknown', 'connected', 'disconnected') NOT NULL DEFAULT 'unknown',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT customers_owner_fk FOREIGN KEY (owner_subject) REFERENCES users(subject_id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO customers (id, name, address, building, meter_id, meter_status) VALUES
  ('CL-2041', 'Мария Иванова', 'ул. Садовая, 12, кв. 8', 'Дом 12 · Северный', 'SM-88-1041', 'online'),
  ('CL-2042', 'Дмитрий Петров', 'пр. Мира, 44, кв. 21', 'Дом 44 · Центральный', 'SM-88-1042', 'online'),
  ('CL-2043', 'Елена Соколова', 'ул. Лесная, 5, кв. 3', 'Дом 5 · Восточный', 'SM-88-1043', 'stale'),
  ('CL-2044', 'ООО «Маяк»', 'ул. Промышленная, 7', 'Дом 7 · Западный', 'SM-88-1044', 'online')
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS meter_readings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  reading_month DATE NOT NULL,
  consumption_kwh DECIMAL(12, 2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT meter_readings_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT meter_readings_month_unique UNIQUE (customer_id, reading_month)
) ENGINE=InnoDB;

INSERT INTO meter_readings (customer_id, reading_month, consumption_kwh) VALUES
  ('CL-2041', DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), 248),
  ('CL-2042', DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), 612),
  ('CL-2043', DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), 194),
  ('CL-2044', DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), 1840),
  ('CL-2041', DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH), 231),
  ('CL-2042', DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH), 428),
  ('CL-2043', DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH), 201),
  ('CL-2044', DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH), 1510)
ON DUPLICATE KEY UPDATE consumption_kwh = VALUES(consumption_kwh);

CREATE TABLE IF NOT EXISTS customer_balances (
  customer_id VARCHAR(64) NOT NULL PRIMARY KEY,
  unpaid_balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT customer_balances_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB;

INSERT INTO customer_balances (customer_id, unpaid_balance) VALUES
  ('CL-2041', 0), ('CL-2042', 15900), ('CL-2043', 0), ('CL-2044', 0)
ON DUPLICATE KEY UPDATE unpaid_balance = VALUES(unpaid_balance);

CREATE TABLE IF NOT EXISTS service_requests (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  owner_subject CHAR(36) NULL,
  kind VARCHAR(40) NOT NULL,
  summary VARCHAR(1000) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  assigned_to VARCHAR(160) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT service_requests_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT service_requests_owner_fk FOREIGN KEY (owner_subject) REFERENCES users(subject_id) ON DELETE SET NULL,
  INDEX service_requests_status_created_idx (status, created_at)
) ENGINE=InnoDB;

INSERT INTO service_requests (id, customer_id, kind, summary, status) VALUES
  ('SR-5101', 'CL-2042', 'disconnection_review', 'Проверка задолженности и уведомления', 'pending_review'),
  ('SR-5100', 'CL-2043', 'repair', 'Проверить канал умного счётчика', 'assigned')
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS repair_crews (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  district VARCHAR(160) NOT NULL,
  skill VARCHAR(160) NOT NULL,
  status VARCHAR(80) NOT NULL,
  contact VARCHAR(40) NOT NULL
) ENGINE=InnoDB;

INSERT INTO repair_crews (id, name, district, skill, status, contact) VALUES
  ('RG-01', 'Бригада № 1', 'Северный / Центральный', 'Линии 0.4–110 кВ', 'Свободна', '+7 (000) 000-01-01'),
  ('RG-02', 'Бригада № 2', 'Восточный', 'Подстанции и счётчики', 'На заявке SR-5100', '+7 (000) 000-02-02'),
  ('RG-03', 'Бригада № 3', 'Южный / Западный', 'Аварийный выезд', 'Свободна', '+7 (000) 000-03-03')
ON DUPLICATE KEY UPDATE id = VALUES(id);
