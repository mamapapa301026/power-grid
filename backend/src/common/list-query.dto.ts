import { Type } from 'class-transformer'
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string

  @IsOptional()
  @IsIn(['normal', 'warning', 'critical', 'active', 'acknowledged', 'resolved'])
  status?: string

  @IsOptional()
  @IsIn(['line', 'transformer', 'switch', 'substation'])
  type?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  substationId?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  equipmentId?: string

  @IsOptional()
  @IsIn(['info', 'warning', 'critical'])
  severity?: string

  @IsOptional()
  @IsIn(['stale', 'future', 'duplicate', 'out_of_range'])
  qualityCode?: string

  @IsOptional()
  @IsISO8601()
  from?: string

  @IsOptional()
  @IsISO8601()
  to?: string
}