import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateSupportConversationDto {
  @IsString()
  @MaxLength(100)
  customerId!: string

  @IsString()
  @MaxLength(200)
  title = 'Консультация'
}

export class SendSupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string

  @IsIn(['customer', 'operator', 'assistant'])
  senderType!: 'customer' | 'operator' | 'assistant'
}