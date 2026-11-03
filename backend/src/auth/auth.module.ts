import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { ObjectAccessGuard } from './object-access.guard'
import { RolesGuard } from './roles.guard'

@Module({
	controllers: [AuthController],
	providers: [AuthService, AuthGuard, RolesGuard, ObjectAccessGuard],
	exports: [AuthService, AuthGuard, RolesGuard, ObjectAccessGuard],
})
export class AuthModule {}