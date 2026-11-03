import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC } from './auth.decorators'
import { AuthService } from './auth.service'
import { AuthPrincipal } from './auth.types'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      user?: AuthPrincipal
    }>()
    const authorization = request.headers.authorization
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    request.user = await this.auth.authenticate(token)
    return true
  }
}