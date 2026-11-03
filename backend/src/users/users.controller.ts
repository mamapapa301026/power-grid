import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { Roles } from '../auth/auth.decorators'
import { CreateCustomerAccountDto, UpdateUserRoleDto } from '../auth/auth.dto'
import { AuthService } from '../auth/auth.service'
import { ListQueryDto } from '../common/list-query.dto'
import { getPagination, paginated } from '../common/pagination'

@Controller('users')
@Roles('administrator')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  async listUsers(@Query() query: ListQueryDto) {
    const pagination = getPagination(query)
    const filtered = await this.auth.listUsers(query.search)
    const offset = (pagination.page - 1) * pagination.pageSize
    return paginated(filtered.slice(offset, offset + pagination.pageSize), filtered.length, pagination)
  }

  @Patch(':id/role')
  updateRole(@Param('id') subject: string, @Body() input: UpdateUserRoleDto) {
    return this.auth.updateRole(subject, input.role)
  }

  @Post('customer-account')
  createCustomerAccount(@Body() input: CreateCustomerAccountDto) {
    return this.auth.createCustomerAccount(input.customerId, input.username, input.password)
  }
}