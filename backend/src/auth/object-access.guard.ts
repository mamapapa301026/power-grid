import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { AuthPrincipal } from './auth.types'

@Injectable()
export class ObjectAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>
      user?: AuthPrincipal
    }>()
    const objectId = request.params.id
    if (!objectId || !request.user) return true
    if (request.user.substationIds.includes('*') || request.user.substationIds.includes(objectId)) return true
    throw new ForbiddenException('Access to this network object is denied')
  }
}