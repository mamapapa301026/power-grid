import { IsISO8601, IsNumber, IsString, MaxLength, Min } from 'class-validator'

export class CreateTelemetryDto {
  @IsString()
  @MaxLength(100)
  equipmentId!: string

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  voltage!: number

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  current!: number

  @IsNumber({ allowNaN: false, allowInfinity: false })
  activePower!: number

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  frequency!: number

  @IsISO8601()
  measuredAt!: string
}