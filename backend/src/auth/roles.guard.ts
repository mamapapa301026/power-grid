import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { REQUIRED_ROLES } from './auth.decorators'
import { AuthPrincipal } from './auth.types'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()])
    if (!requiredRoles?.length) return true

    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>()
    if (!request.user || !requiredRoles.some((role) => request.user?.roles.includes(role))) {
      throw new ForbiddenException('Insufficient role')
    }
    return true
  }
}