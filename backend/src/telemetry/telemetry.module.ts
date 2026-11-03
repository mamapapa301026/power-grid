import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { TelemetryController } from './telemetry.controller'
import { TelemetryGateway } from './telemetry.gateway'
import { TelemetryService } from './telemetry.service'

@Module({
	imports: [AuthModule],
	controllers: [TelemetryController],
	providers: [TelemetryService, TelemetryGateway],
	exports: [TelemetryService],
})
export class TelemetryModule {}