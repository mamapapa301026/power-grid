export const demoSubstations = [
  { id: 'north', name: 'ПС Северная', district: 'Северный район', voltageKv: 110, loadPercent: 68, status: 'normal' },
  { id: 'central', name: 'ПС Центральная', district: 'Центральный район', voltageKv: 220, loadPercent: 84, status: 'warning' },
  { id: 'east', name: 'ПС Восточная', district: 'Восточный район', voltageKv: 110, loadPercent: 52, status: 'normal' },
  { id: 'south', name: 'ПС Южная', district: 'Южный район', voltageKv: 110, loadPercent: 39, status: 'normal' },
  { id: 'west', name: 'ПС Западная', district: 'Западный район', voltageKv: 35, loadPercent: 91, status: 'critical' },
]

export const demoEquipment = [
  { id: 'transformer-west-2', substationId: 'west', connectedSubstationId: null, name: 'Трансформатор Т-2', kind: 'transformer', status: 'warning' },
  { id: 'line-07', substationId: 'north', connectedSubstationId: 'central', name: 'Линия Л-07', kind: 'line', status: 'normal' },
  { id: 'line-12', substationId: 'central', connectedSubstationId: 'east', name: 'Линия Л-12', kind: 'line', status: 'normal' },
  { id: 'line-03', substationId: 'central', connectedSubstationId: 'south', name: 'Линия Л-03', kind: 'line', status: 'normal' },
  { id: 'line-20', substationId: 'central', connectedSubstationId: 'south', name: 'Линия Л-20', kind: 'line', status: 'normal' },
  { id: 'line-14', substationId: 'east', connectedSubstationId: 'west', name: 'Линия Л-14', kind: 'line', status: 'warning' },
]

export const demoAlarms = [
  { id: 'alarm-001', severity: 'critical', title: 'Перегрузка трансформатора', equipmentId: 'transformer-west-2', acknowledged: false, occurredAt: '2026-11-02T10:42:18Z' },
  { id: 'alarm-002', severity: 'warning', title: 'Отклонение напряжения', equipmentId: 'line-14', acknowledged: false, occurredAt: '2026-11-02T10:38:05Z' },
]