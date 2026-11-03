export type SubstationStatus = 'normal' | 'warning' | 'critical'

export type Substation = {
  id: string
  name: string
  district: string
  voltageKv: number
  loadPercent: number
  status: SubstationStatus
}

export type TelemetrySample = {
  equipmentId: string
  voltage: number
  current: number
  activePower: number
  frequency: number
  measuredAt: string
  qualityStatus: 'valid' | 'suspect'
  qualityFlags: string[]
}