import { Body, Controller, Get, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthPrincipal } from './auth.types'
import { Public } from './auth.decorators'
import { AuthService } from './auth.service'
import { LoginDto, RegisterDto } from './auth.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('status')
  @Public()
  getStatus() {
    return this.auth.getStatus()
  }

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  register(@Body() input: RegisterDto) {
    return this.auth.register(input.username, input.displayName, input.password)
  }

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() input: LoginDto) {
    return this.auth.login(input.username, input.password)
  }

  @Get('me')
  getCurrentUser(@Req() request: { user: AuthPrincipal }) {
    return {
      subject: request.user.subject,
      username: request.user.username,
      displayName: request.user.displayName,
      role: request.user.roles[0],
    }
  }
}
