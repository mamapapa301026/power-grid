import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { CreateServiceRequestDto, UpdateServiceRequestStatusDto } from './customers.dto'
import { CustomersService } from './customers.service'

@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Req() request: { user: AuthPrincipal }) {
    return this.customers.listServiceRequests(request.user)
  }

  @Post()
  create(@Body() input: CreateServiceRequestDto, @Req() request: { user: AuthPrincipal }) {
    return this.customers.createServiceRequest(input, request.user)
  }

  @Patch(':id/status')
  @Roles('operator', 'engineer', 'administrator')
  updateStatus(@Param('id') id: string, @Body() input: UpdateServiceRequestStatusDto) {
    return this.customers.updateServiceRequestStatus(id, input)
  }
}
