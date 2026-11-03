import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import type { LocalRole } from './auth.service'

export class LoginDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{3,32}$/)
  username!: string

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string
}

export class RegisterDto extends LoginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string
}

export class UpdateUserRoleDto {
  @IsIn(['customer', 'operator', 'engineer', 'administrator'])
  role!: LocalRole
}

export class CreateCustomerAccountDto extends LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  customerId!: string
}
