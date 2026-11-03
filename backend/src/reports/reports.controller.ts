import { Controller, Get, Header, Query, Req, ServiceUnavailableException } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { ListQueryDto } from '../common/list-query.dto'
import { getPagination, paginated, validateTimeRange } from '../common/pagination'
import { DatabaseService } from '../database/database.service'

@Controller('reports')
@Roles('operator', 'engineer', 'administrator')
export class ReportsController {
  constructor(private readonly database: DatabaseService) {}

  @Get('load')
  @Roles('operator', 'engineer', 'administrator')
  async loadReport(@Query() query: ListQueryDto, @Req() request: { user: AuthPrincipal }) {
    validateTimeRange(query)
    const pagination = getPagination(query)
    if (this.database.isConnected()) {
      const filters: string[] = []
      const values: unknown[] = []
      if (!request.user.substationIds.includes('*')) {
        const allowed = request.user.substationIds
        filters.push(`s.id IN (${allowed.map(() => '?').join(', ') || 'NULL'})`)
        values.push(...allowed)
      }
      if (query.substationId) {
        if (!request.user.substationIds.includes('*') && !request.user.substationIds.includes(query.substationId)) {
          throw new ServiceUnavailableException('MariaDB/MySQL is unavailable')
        }
        filters.push('s.id = ?')
        values.push(query.substationId)
      }
      if (query.from) {
        filters.push('t.measured_at >= ?')
        values.push(query.from)
      }
      if (query.to) {
        filters.push('t.measured_at <= ?')
        values.push(query.to)
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const grouped = `SELECT DATE_FORMAT(t.measured_at, '%Y-%m-%d %H:00:00') AS period, s.id AS substationId, s.name,
        AVG(t.active_power) AS averagePowerMw, MAX(t.active_power) AS peakPowerMw, COUNT(*) AS sampleCount
        FROM telemetry t JOIN equipment e ON e.id = t.equipment_id
        JOIN substations s ON s.id = e.substation_id ${where}
        GROUP BY period, s.id, s.name`
      const count = await this.database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM (${grouped}) load_rows`, values)
      const result = await this.database.query(
        `${grouped} ORDER BY period DESC, name LIMIT ? OFFSET ?`,
        [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
      )
      return paginated(result.rows, Number(count.rows[0]?.count ?? 0), pagination)
    }

    return paginated([], 0, pagination)
  }

  @Get('substations.csv')
  @Roles('administrator')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async substationsCsv() {
    const result = await this.database.query<{
      id: string
      name: string
      district: string
      voltageKv: number
      loadPercent: number
      status: string
    }>(
      `SELECT id, name, district, nominal_voltage_kv AS voltageKv,
        load_percent AS loadPercent, status FROM substations ORDER BY name`,
    )
    const rows = [
      ['id', 'name', 'district', 'voltage_kv', 'load_percent', 'status'],
      ...result.rows.map((item) => [item.id, item.name, item.district, String(item.voltageKv), String(item.loadPercent), item.status]),
    ]
    return `\uFEFF${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\r\n')}`
  }
}