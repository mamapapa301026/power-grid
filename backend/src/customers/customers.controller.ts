import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { CreateCustomerDto, CreateSupplyReviewDto, UpdateCustomerSupplyStatusDto } from './customers.dto'
import { CustomersService } from './customers.service'

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Req() request: { user: AuthPrincipal }) {
    return this.customers.listCustomers(request.user)
  }

  @Post()
  @Roles('operator', 'engineer', 'administrator')
  create(@Body() input: CreateCustomerDto) {
    return this.customers.createCustomer(input)
  }

  @Post(':id/supply-review')
  @Roles('operator', 'administrator')
  createSupplyReview(@Param('id') id: string, @Body() input: CreateSupplyReviewDto) {
    return this.customers.createSupplyReview(id, input)
  }

  @Patch(':id/supply-status')
  @Roles('operator', 'administrator')
  updateSupplyStatus(@Param('id') id: string, @Body() input: UpdateCustomerSupplyStatusDto) {
    return this.customers.updateSupplyStatus(id, input)
  }

  @Get('repair-crews')
  @Roles('operator', 'engineer', 'administrator')
  listRepairCrews() {
    return this.customers.listRepairCrews()
  }
}
