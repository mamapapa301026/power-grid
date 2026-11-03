import { IsIn, IsString, MaxLength } from 'class-validator'

export class CreateAlarmDto {
  @IsString()
  @MaxLength(100)
  equipmentId!: string

  @IsIn(['info', 'warning', 'critical'])
  severity!: string

  @IsString()
  @MaxLength(300)
  title!: string
}