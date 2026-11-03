import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, concatMap } from 'rxjs'
import { AuthPrincipal } from '../auth/auth.types'
import { AuditService } from './audit.service'

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()
    const request = context.switchToHttp().getRequest<{
      method: string
      baseUrl?: string
      path: string
      params?: Record<string, string | undefined>
      body?: Record<string, unknown>
      ip?: string
      user?: AuthPrincipal
    }>()
    if (!request.user
      || request.path.includes('/telemetry')
      || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next.handle()

    const segments = (request.baseUrl ?? request.path).split('/').filter(Boolean)
    const resourceType = segments.at(-1) ?? 'api'
    return next.handle().pipe(concatMap(async (response) => {
      await this.audit.record({
        principal: request.user as AuthPrincipal,
        action: request.method,
        resourceType,
        resourceId: request.params?.id,
        details: { bodyFields: Object.keys(request.body ?? {}) },
        sourceIp: request.ip,
      })
      return response
    }))
  }
}