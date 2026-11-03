import { Controller, Get } from '@nestjs/common'
import { Public } from '../auth/auth.decorators'
import { DatabaseService } from '../database/database.service'
import { TelemetryService } from '../telemetry/telemetry.service'

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService, private readonly telemetry: TelemetryService) {}

  @Get()
  @Public()
  async getHealth() {
    const telemetrySource = await this.telemetry.sourceStatus()
    return {
      status: 'ok',
      mode: process.env.DEMO_MODE === 'true' ? 'demo' : 'production',
      dependencies: {
        database: await this.database.checkConnection() ? 'available' : 'unavailable',
        telemetrySource,
      },
      timestamp: new Date().toISOString(),
    }
  }
}