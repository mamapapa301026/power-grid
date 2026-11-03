import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'

export type Pagination = { page: number; pageSize: number }

export function getPagination(query: { page?: number; pageSize?: number }): Pagination {
  return {
    page: Math.max(1, query.page ?? 1),
    pageSize: Math.min(100, Math.max(1, query.pageSize ?? 25)),
  }
}

export function paginated<T>(data: T[], total: number, pagination: Pagination) {
  return {
    data,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      pageCount: Math.ceil(total / pagination.pageSize),
    },
  }
}

export function assertDatabaseAvailable(): void {
  throw new ServiceUnavailableException('MariaDB/MySQL is unavailable; data will not be stored in memory')
}

export function validateTimeRange(query: { from?: string; to?: string }) {
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    throw new BadRequestException('The from filter must be earlier than or equal to to')
  }
}