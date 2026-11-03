ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS supply_status ENUM('unknown', 'connected', 'disconnected') NOT NULL DEFAULT 'unknown'
  AFTER meter_status;

ALTER TABLE customers
  MODIFY COLUMN supply_status ENUM('unknown', 'connected', 'disconnected') NOT NULL DEFAULT 'unknown';
