import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { AuthPrincipal } from '../auth/auth.types'
import { Roles } from '../auth/auth.decorators'
import { ListQueryDto } from '../common/list-query.dto'
import { CreateSupportConversationDto, SendSupportMessageDto } from './support.dto'
import { SupportService } from './support.service'

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('conversations')
  createConversation(@Body() input: CreateSupportConversationDto, @Req() request: { user: AuthPrincipal }) {
    return this.support.createConversation(input.customerId, input.title, request.user)
  }

  @Get('conversations')
  @Roles('operator', 'engineer', 'administrator')
  listConversations(@Query() query: ListQueryDto, @Req() request: { user: AuthPrincipal }) {
    return this.support.listConversations(query, request.user)
  }

  @Get('conversations/:id/messages')
  listMessages(@Param('id') id: string, @Req() request: { user: AuthPrincipal }) {
    return this.support.listMessages(id, request.user)
  }

  @Post('conversations/:id/messages')
  sendMessage(@Param('id') id: string, @Body() input: SendSupportMessageDto, @Req() request: { user: AuthPrincipal }) {
    return this.support.sendMessage(id, input.body, input.senderType, request.user)
  }

  @Patch('conversations/:id/assign')
  @Roles('operator', 'administrator')
  assignConversation(@Param('id') id: string, @Req() request: { user: AuthPrincipal }) {
    return this.support.assignConversation(id, request.user)
  }
}