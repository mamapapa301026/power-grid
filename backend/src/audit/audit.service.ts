import { Injectable } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { getPagination, paginated } from '../common/pagination'
import { ListQueryDto } from '../common/list-query.dto'
import { DatabaseService } from '../database/database.service'

export type AuditEntry = {
  principal: AuthPrincipal
  action: string
  resourceType: string
  resourceId?: string
  details: Record<string, unknown>
  sourceIp?: string
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(entry: AuditEntry) {
    await this.database.query(
      `INSERT INTO audit_logs (subject_id, action, resource_type, resource_id, details, source_ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.principal.subject, entry.action, entry.resourceType, entry.resourceId ?? null, JSON.stringify(entry.details), entry.sourceIp ?? null],
    )
  }

  async list(query: ListQueryDto) {
    const pagination = getPagination(query)
    const filters: string[] = []
    const values: unknown[] = []
    if (query.search) {
      filters.push('(subject_id LIKE ? OR action LIKE ? OR resource_id LIKE ?)')
      const search = `%${query.search}%`
      values.push(search, search, search)
    }
    if (query.from) {
      filters.push('created_at >= ?')
      values.push(query.from)
    }
    if (query.to) {
      filters.push('created_at <= ?')
      values.push(query.to)
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const count = await this.database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM audit_logs ${where}`, values)
    const result = await this.database.query(
      `SELECT id, subject_id AS subjectId, action, resource_type AS resourceType,
        resource_id AS resourceId, details, source_ip AS sourceIp, created_at AS createdAt
       FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
    )
    return paginated(result.rows, Number(count.rows[0]?.count ?? 0), pagination)
  }
}