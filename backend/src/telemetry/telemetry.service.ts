import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { ListQueryDto } from '../common/list-query.dto'
import { assertDatabaseAvailable, getPagination, paginated } from '../common/pagination'
import { DatabaseService } from '../database/database.service'
import { demoEquipment, demoSubstations } from '../demo-data'
import { TelemetryGateway } from './telemetry.gateway'

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

type EquipmentContext = {
  substationId: string
  connectedSubstationId: string | null
  nominalVoltageKv: number
}
type TelemetryInput = Pick<TelemetrySample, 'equipmentId' | 'voltage' | 'current' | 'activePower' | 'frequency' | 'measuredAt'>
type QualityEvent = { equipmentId: string; eventCode: string; details: Record<string, unknown>; measuredAt: string; receivedAt: string }

@Injectable()
export class TelemetryService {
  private readonly samples: TelemetrySample[] = []
  private readonly memoryQualityEvents: QualityEvent[] = []

  constructor(private readonly database: DatabaseService, private readonly gateway: TelemetryGateway) {}

  async append(input: TelemetryInput, principal: AuthPrincipal) {
    const equipment = await this.getEquipmentContext(input.equipmentId)
    if (!equipment) throw new NotFoundException('Equipment not found')
    if (!principal.substationIds.includes('*')
      && !principal.substationIds.includes(equipment.substationId)
      && (!equipment.connectedSubstationId || !principal.substationIds.includes(equipment.connectedSubstationId))) {
      throw new ForbiddenException('Access to this equipment is denied')
    }

    await this.markSourceSeen()
    const measuredAt = Date.parse(input.measuredAt)
    const receivedAt = Date.now()
    if (!Number.isFinite(measuredAt)) throw new BadRequestException('Measurement timestamp is invalid')
    if (measuredAt > receivedAt + 5 * 60 * 1000) {
      await this.recordQualityEvent(input.equipmentId, 'future', new Date(measuredAt), { maxFutureSkewMs: 300000 })
      throw new UnprocessableEntityException('Measurement timestamp is too far in the future')
    }
    if (receivedAt - measuredAt > 10 * 60 * 1000) {
      await this.recordQualityEvent(input.equipmentId, 'stale', new Date(measuredAt), { maxAgeMs: 600000 })
      throw new UnprocessableEntityException('Measurement is too old')
    }

    const qualityFlags = this.qualityFlags(input, equipment.nominalVoltageKv)
    const sample: TelemetrySample = {
      ...input,
      measuredAt: new Date(measuredAt).toISOString(),
      qualityStatus: qualityFlags.length ? 'suspect' : 'valid',
      qualityFlags,
    }

    if (this.database.isConnected()) {
      const saved = await this.database.query<TelemetrySample>(
        `INSERT IGNORE INTO telemetry
          (equipment_id, voltage, current, active_power, frequency, measured_at, quality_status, quality_flags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.equipmentId, input.voltage, input.current, input.activePower, input.frequency, new Date(measuredAt), sample.qualityStatus, JSON.stringify(sample.qualityFlags)],
      )
      if (saved.affectedRows === 0) {
        await this.recordQualityEvent(input.equipmentId, 'duplicate', new Date(measuredAt), {})
        throw new ConflictException('Duplicate measurement')
      }
      const persisted = await this.database.query<TelemetrySample>(
        `SELECT equipment_id AS equipmentId, voltage, current, active_power AS activePower, frequency,
          measured_at AS measuredAt, quality_status AS qualityStatus, quality_flags AS qualityFlags
         FROM telemetry WHERE equipment_id = ? AND measured_at = ?`,
        [input.equipmentId, new Date(measuredAt)],
      )
      const result = persisted.rows[0]
      if (qualityFlags.length) {
        await this.recordQualityEvent(input.equipmentId, 'out_of_range', new Date(measuredAt), { flags: qualityFlags })
      }
      this.gateway.publish(result, [equipment.substationId, ...(equipment.connectedSubstationId ? [equipment.connectedSubstationId] : [])])
      return result
    }

    assertDatabaseAvailable()
    if (this.samples.some((stored) => stored.equipmentId === sample.equipmentId && stored.measuredAt === sample.measuredAt)) {
      await this.recordQualityEvent(input.equipmentId, 'duplicate', new Date(measuredAt), {})
      throw new ConflictException('Duplicate measurement')
    }
    if (qualityFlags.length) await this.recordQualityEvent(input.equipmentId, 'out_of_range', new Date(measuredAt), { flags: qualityFlags })
    this.samples.unshift(sample)
    this.samples.length = Math.min(this.samples.length, 500)
    this.gateway.publish(sample, [equipment.substationId, ...(equipment.connectedSubstationId ? [equipment.connectedSubstationId] : [])])
    return sample
  }

  async sourceStatus() {
    if (this.database.isConnected()) {
      const result = await this.database.query<{ status: string; lastSeenAt: string | Date | null }>(
        `SELECT status, last_seen_at AS lastSeenAt FROM data_sources WHERE id = 'demo-simulator'`,
      )
      const source = result.rows[0]
      if (!source?.lastSeenAt) return { status: 'unknown', lastSeenAt: null }
      const lastSeenAt = new Date(source.lastSeenAt).toISOString()
      const status = Date.now() - Date.parse(lastSeenAt) <= 15000 ? 'online' : 'offline'
      if (status !== source.status) {
        await this.database.query(
          `UPDATE data_sources SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = 'demo-simulator'`,
          [status],
        )
      }
      return { status, lastSeenAt }
    }

    return { status: 'unavailable', lastSeenAt: null }
  }

  async latest(query: ListQueryDto, principal: AuthPrincipal) {
    const pagination = getPagination(query)
    if (this.database.isConnected()) {
      const { where, values } = this.filters(query, principal)
      const count = await this.database.query<{ count: string }>(
        `SELECT COUNT(DISTINCT t.equipment_id) AS count FROM telemetry t JOIN equipment e ON e.id = t.equipment_id ${where}`,
        values,
      )
      const latestWhere = `${where}${where ? ' AND' : ' WHERE'} NOT EXISTS (
        SELECT 1 FROM telemetry newer
        WHERE newer.equipment_id = t.equipment_id AND newer.measured_at > t.measured_at
      )`
      const result = await this.database.query<TelemetrySample>(
        `SELECT t.equipment_id AS equipmentId, t.voltage, t.current,
          t.active_power AS activePower, t.frequency, t.measured_at AS measuredAt,
          t.quality_status AS qualityStatus, t.quality_flags AS qualityFlags
         FROM telemetry t JOIN equipment e ON e.id = t.equipment_id ${latestWhere}
         ORDER BY t.measured_at DESC LIMIT ? OFFSET ?`,
        [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      )
      return paginated(result.rows, Number(count.rows[0]?.count ?? 0), pagination)
    }

    assertDatabaseAvailable()
    const filtered = this.filterMemory(query, principal)
    const latestByEquipment = new Map<string, TelemetrySample>()
    for (const sample of filtered) {
      if (!latestByEquipment.has(sample.equipmentId)) latestByEquipment.set(sample.equipmentId, sample)
    }
    const rows = [...latestByEquipment.values()]
    const offset = (pagination.page - 1) * pagination.pageSize
    return paginated(rows.slice(offset, offset + pagination.pageSize), rows.length, pagination)
  }

  async history(query: ListQueryDto, principal: AuthPrincipal) {
    const pagination = getPagination(query)
    if (this.database.isConnected()) {
      const { where, values } = this.filters(query, principal)
      const count = await this.database.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM telemetry t JOIN equipment e ON e.id = t.equipment_id ${where}`,
        values,
      )
      const result = await this.database.query<TelemetrySample>(
        `SELECT t.equipment_id AS equipmentId, t.voltage, t.current, t.active_power AS activePower,
          t.frequency, t.measured_at AS measuredAt, t.quality_status AS qualityStatus, t.quality_flags AS qualityFlags
         FROM telemetry t JOIN equipment e ON e.id = t.equipment_id ${where}
         ORDER BY t.measured_at DESC LIMIT ? OFFSET ?`,
        [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      )
      return paginated(result.rows, Number(count.rows[0]?.count ?? 0), pagination)
    }

    assertDatabaseAvailable()
    const filtered = this.filterMemory(query, principal)
    const offset = (pagination.page - 1) * pagination.pageSize
    return paginated(filtered.slice(offset, offset + pagination.pageSize), filtered.length, pagination)
  }

  async qualityEvents(query: ListQueryDto, principal: AuthPrincipal) {
    const pagination = getPagination(query)
    if (this.database.isConnected()) {
      const filters: string[] = []
      const values: unknown[] = []
      if (!principal.substationIds.includes('*')) {
        const allowed = principal.substationIds
        const placeholders = allowed.map(() => '?').join(', ') || 'NULL'
        filters.push(`EXISTS (SELECT 1 FROM equipment e WHERE e.id = q.equipment_id AND (e.substation_id IN (${placeholders}) OR e.connected_substation_id IN (${placeholders})))`)
        values.push(...allowed, ...allowed)
      }
      if (query.equipmentId) {
        filters.push('q.equipment_id = ?')
        values.push(query.equipmentId)
      }
      if (query.substationId) {
        if (!principal.substationIds.includes('*') && !principal.substationIds.includes(query.substationId)) {
          filters.push('false')
        } else {
          filters.push('EXISTS (SELECT 1 FROM equipment e WHERE e.id = q.equipment_id AND (e.substation_id = ? OR e.connected_substation_id = ?))')
          values.push(query.substationId, query.substationId)
        }
      }
      if (query.qualityCode) {
        filters.push('q.event_code = ?')
        values.push(query.qualityCode)
      }
      if (query.from) {
        filters.push('q.received_at >= ?')
        values.push(query.from)
      }
      if (query.to) {
        filters.push('q.received_at <= ?')
        values.push(query.to)
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const count = await this.database.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM telemetry_quality_events q ${where}`,
        values,
      )
      const result = await this.database.query(
        `SELECT q.id, q.equipment_id AS equipmentId, q.source_id AS sourceId, q.event_code AS eventCode,
          q.details, q.measured_at AS measuredAt, q.received_at AS receivedAt
         FROM telemetry_quality_events q ${where} ORDER BY q.received_at DESC
         LIMIT ? OFFSET ?`,
        [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      )
      return paginated(result.rows, Number(count.rows[0]?.count ?? 0), pagination)
    }

    assertDatabaseAvailable()
    const filtered = this.memoryQualityEvents.filter((event) => {
      const equipment = demoEquipment.find((item) => item.id === event.equipmentId)
      const allowed = principal.substationIds.includes('*')
        || Boolean(equipment && (principal.substationIds.includes(equipment.substationId)
          || (equipment.connectedSubstationId && principal.substationIds.includes(equipment.connectedSubstationId))))
      const receivedAt = Date.parse(event.receivedAt)
      return allowed
        && (!query.equipmentId || event.equipmentId === query.equipmentId)
        && (!query.substationId || Boolean(equipment && (equipment.substationId === query.substationId || equipment.connectedSubstationId === query.substationId)))
        && (!query.qualityCode || event.eventCode === query.qualityCode)
        && (!query.from || receivedAt >= Date.parse(query.from))
        && (!query.to || receivedAt <= Date.parse(query.to))
    })
    const offset = (pagination.page - 1) * pagination.pageSize
    return paginated(filtered.slice(offset, offset + pagination.pageSize), filtered.length, pagination)
  }

  private filters(query: ListQueryDto, principal: AuthPrincipal) {
    const filters: string[] = []
    const values: unknown[] = []
    if (!principal.substationIds.includes('*')) {
      const allowed = principal.substationIds
      const placeholders = allowed.map(() => '?').join(', ') || 'NULL'
      filters.push(`(e.substation_id IN (${placeholders}) OR e.connected_substation_id IN (${placeholders}))`)
      values.push(...allowed, ...allowed)
    }
    if (query.equipmentId) {
      filters.push('t.equipment_id = ?')
      values.push(query.equipmentId)
    }
    if (query.substationId) {
      if (!principal.substationIds.includes('*') && !principal.substationIds.includes(query.substationId)) {
        filters.push('false')
      } else {
        filters.push('(e.substation_id = ? OR e.connected_substation_id = ?)')
        values.push(query.substationId, query.substationId)
      }
    }
    if (query.from) {
      filters.push('t.measured_at >= ?')
      values.push(query.from)
    }
    if (query.to) {
      filters.push('t.measured_at <= ?')
      values.push(query.to)
    }
    return { where: filters.length ? `WHERE ${filters.join(' AND ')}` : '', values }
  }

  private filterMemory(query: ListQueryDto, principal: AuthPrincipal) {
    return this.samples.filter((sample) => {
      const equipment = demoEquipment.find((item) => item.id === sample.equipmentId)
      if (!equipment) return false
      const allowed = principal.substationIds.includes('*')
        || principal.substationIds.includes(equipment.substationId)
        || Boolean(equipment.connectedSubstationId && principal.substationIds.includes(equipment.connectedSubstationId))
      const measuredAt = Date.parse(sample.measuredAt)
      return allowed
        && (!query.equipmentId || sample.equipmentId === query.equipmentId)
        && (!query.substationId || equipment.substationId === query.substationId || equipment.connectedSubstationId === query.substationId)
        && (!query.from || measuredAt >= Date.parse(query.from))
        && (!query.to || measuredAt <= Date.parse(query.to))
    })
  }

  private async getEquipmentContext(equipmentId: string): Promise<EquipmentContext | null> {
    if (this.database.isConnected()) {
      const result = await this.database.query<{
        substationId: string
        connectedSubstationId: string | null
        nominalVoltageKv: number
      }>(
        `SELECT e.substation_id AS substationId, e.connected_substation_id AS connectedSubstationId,
          s.nominal_voltage_kv AS nominalVoltageKv
         FROM equipment e JOIN substations s ON s.id = e.substation_id WHERE e.id = ?`,
        [equipmentId],
      )
      return result.rows[0] ?? null
    }

    const equipment = demoEquipment.find((item) => item.id === equipmentId)
    if (!equipment) return null
    const station = demoSubstations.find((item) => item.id === equipment.substationId)
    return station ? {
      substationId: equipment.substationId,
      connectedSubstationId: equipment.connectedSubstationId,
      nominalVoltageKv: station.voltageKv,
    } : null
  }

  private qualityFlags(sample: TelemetryInput, nominalVoltageKv: number) {
    const flags: string[] = []
    if (sample.voltage < nominalVoltageKv * 0.8 || sample.voltage > nominalVoltageKv * 1.2) flags.push('voltage_deviation')
    if (sample.voltage < 1 || sample.voltage > 500) flags.push('voltage_out_of_range')
    if (sample.current > 20000) flags.push('current_out_of_range')
    if (Math.abs(sample.activePower) > 5000) flags.push('power_out_of_range')
    if (sample.frequency < 45 || sample.frequency > 55) flags.push('frequency_out_of_range')
    return flags
  }

  private async markSourceSeen() {
    if (!this.database.isConnected()) throw new ServiceUnavailableException('MariaDB/MySQL is unavailable')
    await this.database.query(
      `UPDATE data_sources SET status = 'online', last_seen_at = CURRENT_TIMESTAMP(3), last_error = NULL, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = 'demo-simulator'`,
    )
  }

  private async recordQualityEvent(
    equipmentId: string,
    eventCode: 'stale' | 'future' | 'duplicate' | 'out_of_range',
    measuredAt: Date,
    details: Record<string, unknown>,
  ) {
    if (this.database.isConnected()) {
      await this.database.query(
        `INSERT INTO telemetry_quality_events (equipment_id, source_id, event_code, details, measured_at)
         VALUES (?, 'demo-simulator', ?, ?, ?)`,
        [equipmentId, eventCode, JSON.stringify(details), measuredAt],
      )
      return
    }
    throw new ServiceUnavailableException('MariaDB/MySQL is unavailable; telemetry quality events will not be stored in memory')
  }
}