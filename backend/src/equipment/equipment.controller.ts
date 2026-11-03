import { Controller, Get, Query, Req } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { ListQueryDto } from '../common/list-query.dto'
import { assertDatabaseAvailable, getPagination, paginated } from '../common/pagination'
import { DatabaseService } from '../database/database.service'
import { demoEquipment } from '../demo-data'

type AuthenticatedRequest = { user: AuthPrincipal }
type EquipmentRow = {
  id: string
  substationId: string
  connectedSubstationId: string | null
  name: string
  kind: string
  status: string
}

@Controller('equipment')
@Roles('operator', 'engineer', 'administrator')
export class EquipmentController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async listEquipment(@Query() query: ListQueryDto, @Req() request: AuthenticatedRequest) {
    const pagination = getPagination(query)
    if (this.database.isConnected()) {
      const filters: string[] = []
      const values: unknown[] = []
      const allowed = request.user.substationIds
      if (!allowed.includes('*')) {
        const placeholders = allowed.map(() => '?').join(', ') || 'NULL'
        filters.push(`(e.substation_id IN (${placeholders}) OR e.connected_substation_id IN (${placeholders}))`)
        values.push(...allowed, ...allowed)
      }
      if (query.type) {
        filters.push('e.kind = ?')
        values.push(query.type)
      }
      if (query.status) {
        filters.push('e.status = ?')
        values.push(query.status)
      }
      if (query.substationId) {
        if (!allowed.includes('*') && !allowed.includes(query.substationId)) return paginated([], 0, pagination)
        filters.push('(e.substation_id = ? OR e.connected_substation_id = ?)')
        values.push(query.substationId, query.substationId)
      }
      if (query.search) {
        filters.push('(e.name LIKE ? OR e.id LIKE ?)')
        values.push(`%${query.search}%`, `%${query.search}%`)
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const count = await this.database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM equipment e ${where}`, values)
      const rows = await this.database.query<EquipmentRow>(
        `SELECT e.id, e.substation_id AS substationId, e.connected_substation_id AS connectedSubstationId, e.name, e.kind, e.status
         FROM equipment e ${where} ORDER BY e.id LIMIT ? OFFSET ?`,
        [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      )
      return paginated(rows.rows, Number(count.rows[0]?.count ?? 0), pagination)
    }

    assertDatabaseAvailable()
    const allowed = request.user.substationIds
    const filtered = demoEquipment.filter((item) =>
      (allowed.includes('*') || allowed.includes(item.substationId) || (item.connectedSubstationId && allowed.includes(item.connectedSubstationId)))
      && (!query.type || item.kind === query.type)
      && (!query.status || item.status === query.status)
      && (!query.substationId || item.substationId === query.substationId || item.connectedSubstationId === query.substationId)
      && (!query.search || `${item.id} ${item.name}`.toLowerCase().includes(query.search.toLowerCase())),
    )
    const offset = (pagination.page - 1) * pagination.pageSize
    return paginated(filtered.slice(offset, offset + pagination.pageSize), filtered.length, pagination)
  }
}