import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateCustomerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  address!: string

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  building!: string
}

export class CreateServiceRequestDto {
  @IsString()
  @MaxLength(64)
  customerId!: string

  @IsIn(['new_connection', 'disconnection_review', 'remote_switch_review', 'repair'])
  kind!: 'new_connection' | 'disconnection_review' | 'remote_switch_review' | 'repair'

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  summary!: string

  @IsOptional()
  @IsIn(['pending_review', 'assigned', 'completed'])
  status?: 'pending_review' | 'assigned' | 'completed'
}

export class CreateSupplyReviewDto {
  @IsIn(['disconnect', 'reconnect'])
  action!: 'disconnect' | 'reconnect'
}

export class UpdateCustomerSupplyStatusDto {
  @IsIn(['unknown', 'connected', 'disconnected'])
  supplyStatus!: 'unknown' | 'connected' | 'disconnected'
}

export class UpdateServiceRequestStatusDto {
  @IsIn(['pending_review', 'assigned', 'completed'])
  status!: 'pending_review' | 'assigned' | 'completed'
}
