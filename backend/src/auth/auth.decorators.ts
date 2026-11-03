import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC = 'isPublic'
export const REQUIRED_ROLES = 'requiredRoles'

export const Public = () => SetMetadata(IS_PUBLIC, true)
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles)