import { randomUUID } from 'node:crypto'
import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { ListQueryDto } from '../common/list-query.dto'
import { assertDatabaseAvailable, getPagination, paginated, validateTimeRange } from '../common/pagination'
import { DatabaseService } from '../database/database.service'
import { demoAlarms, demoEquipment } from '../demo-data'
import { CreateAlarmDto } from './create-alarm.dto'

type MemoryAlarm = {
  id: string
  equipmentId: string
  severity: string
  title: string
  state: string
  acknowledged: boolean
  occurredAt: string
  resolvedAt?: string
}

@Controller('alarms')
@Roles('operator', 'engineer', 'administrator')
export class AlarmsController {
  private readonly memoryAlarms: MemoryAlarm[] = demoAlarms.map((alarm) => ({
    ...alarm,
    state: alarm.acknowledged ? 'acknowledged' : 'active',
  }))

  constructor(private readonly database: DatabaseService) {}

  @Get()
  async listAlarms(@Query() query: ListQueryDto, @Req() request: { user: AuthPrincipal }) {
    validateTimeRange(query)
    const pagination = getPagination(query)
    if (this.database.isConnected()) {
      const filters: string[] = []
      const values: unknown[] = []
      if (!request.user.substationIds.includes('*')) {
        const allowed = request.user.substationIds
        const placeholders = allowed.map(() => '?').join(', ') || 'NULL'
        filters.push(`EXISTS (SELECT 1 FROM equipment e WHERE e.id = a.equipment_id AND (e.substation_id IN (${placeholders}) OR e.connected_substation_id IN (${placeholders})))`)
        values.push(...allowed, ...allowed)
      }
      if (query.equipmentId) {
        filters.push('a.equipment_id = ?')
        values.push(query.equipmentId)
      }
      if (query.severity) {
        filters.push('a.severity = ?')
        values.push(query.severity)
      }
      if (query.status) {
        filters.push('a.state = ?')
        values.push(query.status)
      }
      if (query.from) {
        filters.push('a.occurred_at >= ?')
        values.push(query.from)
      }
      if (query.to) {
        filters.push('a.occurred_at <= ?')
        values.push(query.to)
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const count = await this.database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM alarms a ${where}`, values)
      const rows = await this.database.query(
        `SELECT a.id, a.equipment_id AS equipmentId, a.severity, a.title, a.state, a.acknowledged,
          a.occurred_at AS occurredAt, a.resolved_at AS resolvedAt
         FROM alarms a ${where} ORDER BY a.occurred_at DESC LIMIT ? OFFSET ?`,
        [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      )
      return paginated(rows.rows, Number(count.rows[0]?.count ?? 0), pagination)
    }

    assertDatabaseAvailable()
    const filtered = this.memoryAlarms.filter((alarm) => {
      const equipment = demoEquipment.find((item) => item.id === alarm.equipmentId)
      const allowed = request.user.substationIds.includes('*')
        || Boolean(equipment && (request.user.substationIds.includes(equipment.substationId)
          || (equipment.connectedSubstationId && request.user.substationIds.includes(equipment.connectedSubstationId))))
      const state = alarm.state
      const occurredAt = Date.parse(alarm.occurredAt)
      return allowed
        && (!query.equipmentId || alarm.equipmentId === query.equipmentId)
        && (!query.severity || alarm.severity === query.severity)
        && (!query.status || state === query.status)
        && (!query.from || occurredAt >= Date.parse(query.from))
        && (!query.to || occurredAt <= Date.parse(query.to))
    })
    const offset = (pagination.page - 1) * pagination.pageSize
    return paginated(filtered.slice(offset, offset + pagination.pageSize), filtered.length, pagination)
  }

  @Post()
  @Roles('operator', 'engineer', 'administrator')
  async createAlarm(@Body() input: CreateAlarmDto, @Req() request: { user: AuthPrincipal }) {
    let equipment: { substationId: string; connectedSubstationId: string | null } | undefined
    if (this.database.isConnected()) {
      const result = await this.database.query<{ substationId: string; connectedSubstationId: string | null }>(
        `SELECT substation_id AS substationId, connected_substation_id AS connectedSubstationId
         FROM equipment WHERE id = ?`,
        [input.equipmentId],
      )
      equipment = result.rows[0]
    } else {
      assertDatabaseAvailable()
      const demoRecord = demoEquipment.find((item) => item.id === input.equipmentId)
      if (demoRecord) equipment = { substationId: demoRecord.substationId, connectedSubstationId: demoRecord.connectedSubstationId }
    }
    if (!equipment) throw new NotFoundException('Equipment not found')
    if (!request.user.substationIds.includes('*')
      && !request.user.substationIds.includes(equipment.substationId)
      && (!equipment.connectedSubstationId || !request.user.substationIds.includes(equipment.connectedSubstationId))) {
      throw new NotFoundException('Equipment not found')
    }
    const id = randomUUID()
    if (this.database.isConnected()) {
      await this.database.query(
        `INSERT INTO alarms (id, equipment_id, severity, title, state)
         VALUES (?, ?, ?, ?, 'active')`,
        [id, input.equipmentId, input.severity, input.title],
      )
      const saved = await this.database.query(
        `SELECT id, equipment_id AS equipmentId, severity, title, state, occurred_at AS occurredAt
         FROM alarms WHERE id = ?`,
        [id],
      )
      return saved.rows[0]
    }
    assertDatabaseAvailable()
    const alarm = { id, ...input, state: 'active', acknowledged: false, occurredAt: new Date().toISOString() }
    this.memoryAlarms.unshift(alarm)
    return alarm
  }

  @Patch(':id/acknowledge')
  @Roles('operator', 'administrator')
  async acknowledge(@Param('id') id: string, @Req() request: { user: AuthPrincipal }) {
    return this.updateState(id, 'acknowledged', request.user)
  }

  @Patch(':id/resolve')
  @Roles('engineer', 'administrator')
  async resolve(@Param('id') id: string, @Req() request: { user: AuthPrincipal }) {
    return this.updateState(id, 'resolved', request.user)
  }

  private async updateState(id: string, state: 'acknowledged' | 'resolved', principal: AuthPrincipal) {
    if (this.database.isConnected()) {
      const allowedFilter = principal.substationIds.includes('*')
        ? ''
        : `AND EXISTS (SELECT 1 FROM equipment e WHERE e.id = alarms.equipment_id AND (e.substation_id IN (${principal.substationIds.map(() => '?').join(', ') || 'NULL'}) OR e.connected_substation_id IN (${principal.substationIds.map(() => '?').join(', ') || 'NULL'})))`
      const timestampColumn = state === 'resolved' ? ', resolved_at = CURRENT_TIMESTAMP(3)' : ''
      const result = await this.database.query(
        `UPDATE alarms SET state = ?, acknowledged = ?${timestampColumn}
         WHERE id = ? ${allowedFilter}`,
        [
          state,
          state === 'acknowledged' || state === 'resolved',
          id,
          ...(principal.substationIds.includes('*') ? [] : [...principal.substationIds, ...principal.substationIds]),
        ],
      )
      if (result.affectedRows > 0) {
        const saved = await this.database.query(
          `SELECT id, equipment_id AS equipmentId, severity, title, state, acknowledged,
            occurred_at AS occurredAt, resolved_at AS resolvedAt
           FROM alarms WHERE id = ?`,
          [id],
        )
        return saved.rows[0]
      }
      throw new NotFoundException('Alarm not found')
    }

    assertDatabaseAvailable()
    const alarm = this.memoryAlarms.find((item) => item.id === id)
    if (!alarm) throw new NotFoundException('Alarm not found')
    const equipment = demoEquipment.find((item) => item.id === alarm.equipmentId)
    if (!principal.substationIds.includes('*') && (!equipment
      || (!principal.substationIds.includes(equipment.substationId)
        && (!equipment.connectedSubstationId || !principal.substationIds.includes(equipment.connectedSubstationId))))) {
      throw new NotFoundException('Alarm not found')
    }
    Object.assign(alarm, { state, acknowledged: state === 'acknowledged' || state === 'resolved', ...(state === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}) })
    return alarm
  }
}