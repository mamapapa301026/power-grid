import { Module } from '@nestjs/common'
import { TelemetryModule } from '../telemetry/telemetry.module'
import { HealthController } from './health.controller'

@Module({ imports: [TelemetryModule], controllers: [HealthController] })
export class HealthModule {}