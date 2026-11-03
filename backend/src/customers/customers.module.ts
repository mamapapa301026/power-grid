import { Module } from '@nestjs/common'
import { CustomersController } from './customers.controller'
import { ServiceRequestsController } from './service-requests.controller'
import { CustomersService } from './customers.service'

@Module({
  controllers: [CustomersController, ServiceRequestsController],
  providers: [CustomersService],
})
export class CustomersModule {}
