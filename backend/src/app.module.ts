import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AlarmsModule } from './alarms/alarms.module'
import { AuthModule } from './auth/auth.module'
import { EquipmentModule } from './equipment/equipment.module'
import { HealthModule } from './health/health.module'
import { ReportsModule } from './reports/reports.module'
import { SubstationsModule } from './substations/substations.module'
import { TelemetryModule } from './telemetry/telemetry.module'
import { UsersModule } from './users/users.module'
import { DatabaseModule } from './database/database.module'
import { AuthGuard } from './auth/auth.guard'
import { RolesGuard } from './auth/roles.guard'
import { AuditModule } from './audit/audit.module'
import { AuditInterceptor } from './audit/audit.interceptor'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { SupportModule } from './support/support.module'
import { CustomersModule } from './customers/customers.module'

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    HealthModule,
    AuthModule,
    UsersModule,
    SubstationsModule,
    EquipmentModule,
    TelemetryModule,
    AlarmsModule,
    ReportsModule,
    SupportModule,
    CustomersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}