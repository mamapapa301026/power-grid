import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../auth/auth.decorators'
import { ListQueryDto } from '../common/list-query.dto'
import { validateTimeRange } from '../common/pagination'
import { AuditService } from './audit.service'

@Controller('audit')
@Roles('administrator')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: ListQueryDto) {
    validateTimeRange(query)
    return this.audit.list(query)
  }
}