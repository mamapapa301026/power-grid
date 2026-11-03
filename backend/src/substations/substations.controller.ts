import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common'
import { ObjectAccessGuard } from '../auth/object-access.guard'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { ListQueryDto } from '../common/list-query.dto'
import { getPagination, paginated, assertDatabaseAvailable } from '../common/pagination'
import { DatabaseService } from '../database/database.service'
import { demoSubstations } from '../demo-data'

type AuthenticatedRequest = { user: AuthPrincipal }
type SubstationRow = {
  id: string
  name: string
  district: string
  voltageKv: number
  loadPercent: number
  status: string
}

@Controller('substations')
@Roles('operator', 'engineer', 'administrator')
export class SubstationsController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async listSubstations(@Query() query: ListQueryDto, @Req() request: AuthenticatedRequest) {
    const pagination = getPagination(query)
    if (this.database.isConnected()) {
      const filters: string[] = []
      const values: unknown[] = []
      const allowed = request.user.substationIds
      if (!allowed.includes('*')) {
        filters.push(`id IN (${allowed.map(() => '?').join(', ') || 'NULL'})`)
        values.push(...allowed)
      }
      if (query.status) {
        filters.push('status = ?')
        values.push(query.status)
      }
      if (query.search) {
        filters.push('(name LIKE ? OR district LIKE ?)')
        values.push(`%${query.search}%`, `%${query.search}%`)
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const count = await this.database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM substations ${where}`, values)
      const rows = await this.database.query<SubstationRow>(
        `SELECT id, name, district, nominal_voltage_kv AS voltageKv, load_percent AS loadPercent, status
         FROM substations ${where} ORDER BY name LIMIT ? OFFSET ?`,
        [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      )
      return paginated(rows.rows, Number(count.rows[0]?.count ?? 0), pagination)
    }

    assertDatabaseAvailable()
    const filtered = demoSubstations.filter((station) =>
      (request.user.substationIds.includes('*') || request.user.substationIds.includes(station.id))
      && (!query.status || station.status === query.status)
      && (!query.search || `${station.name} ${station.district}`.toLowerCase().includes(query.search.toLowerCase())),
    )
    const offset = (pagination.page - 1) * pagination.pageSize
    return paginated(filtered.slice(offset, offset + pagination.pageSize), filtered.length, pagination)
  }

  @Get(':id')
  @UseGuards(ObjectAccessGuard)
  async getSubstation(@Param('id') id: string) {
    if (this.database.isConnected()) {
      const result = await this.database.query<SubstationRow>(
        `SELECT id, name, district, nominal_voltage_kv AS voltageKv, load_percent AS loadPercent, status
         FROM substations WHERE id = ?`,
        [id],
      )
      if (result.rows[0]) return result.rows[0]
      throw new NotFoundException('Substation not found')
    }
    assertDatabaseAvailable()
    const substation = demoSubstations.find((item) => item.id === id)
    if (!substation) throw new NotFoundException('Substation not found')
    return substation
  }
}