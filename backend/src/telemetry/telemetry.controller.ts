import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { ListQueryDto } from '../common/list-query.dto'
import { validateTimeRange } from '../common/pagination'
import { CreateTelemetryDto } from './telemetry.dto'
import { TelemetryService } from './telemetry.service'

@Controller('telemetry')
@Roles('operator', 'engineer', 'administrator')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Get('latest')
  latestSamples(@Query() query: ListQueryDto, @Req() request: { user: AuthPrincipal }) {
    validateTimeRange(query)
    return this.telemetry.latest(query, request.user)
  }

  @Get('history')
  measurementHistory(@Query() query: ListQueryDto, @Req() request: { user: AuthPrincipal }) {
    validateTimeRange(query)
    return this.telemetry.history(query, request.user)
  }

  @Get('quality')
  @Roles('engineer', 'administrator')
  qualityEvents(@Query() query: ListQueryDto, @Req() request: { user: AuthPrincipal }) {
    validateTimeRange(query)
    return this.telemetry.qualityEvents(query, request.user)
  }

  @Post()
  @Roles('operator', 'engineer', 'administrator')
  addSample(@Body() sample: CreateTelemetryDto, @Req() request: { user: AuthPrincipal }) {
    return this.telemetry.append(sample, request.user)
  }
}