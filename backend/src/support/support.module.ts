import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SupportController } from './support.controller'
import { SupportGateway } from './support.gateway'
import { SupportService } from './support.service'

@Module({
  imports: [AuthModule],
  controllers: [SupportController],
  providers: [SupportService, SupportGateway],
})
export class SupportModule {}