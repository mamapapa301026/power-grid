import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Namespace, Socket } from 'socket.io'
import { AuthService } from '../auth/auth.service'
import { AuthPrincipal } from '../auth/auth.types'
import { getAllowedOrigins } from '../security/cors'
import type { SupportConversation, SupportMessage } from './support.service'

@WebSocketGateway({
  namespace: '/support',
  cors: { origin: getAllowedOrigins() },
})
export class SupportGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Namespace

  constructor(private readonly auth: AuthService) {}

  afterInit(server: Namespace) {
    server.use((socket, next) => {
      const token = socket.handshake.auth?.token
      this.auth.authenticate(typeof token === 'string' ? token : undefined)
        .then((principal) => {
          socket.data.user = principal
          next()
        })
        .catch(() => next(new Error('Unauthorized')))
    })
  }

  async handleConnection(client: Socket): Promise<void> {
    const principal = client.data.user as AuthPrincipal | undefined
    if (!principal) {
      client.disconnect(true)
      return
    }
    client.join(`support:user:${principal.subject}`)
    if (principal.roles.some((role) => ['operator', 'engineer', 'administrator'].includes(role))) {
      client.join('support:operators')
    }
    client.emit('support.ready', { connectedAt: new Date().toISOString() })
    await this.publishPresence()
  }

  async handleDisconnect(): Promise<void> {
    await this.publishPresence()
  }

  publishConversation(conversation: SupportConversation) {
    if (!this.server) return
    this.server.to('support:operators').emit('support.conversation', conversation)
  }

  publishMessage(message: SupportMessage, ownerSubject: string) {
    if (!this.server) return
    this.server.to(`support:user:${ownerSubject}`).to('support:operators').emit('support.message', message)
  }

  private async publishPresence() {
    if (!this.server) return
    const operators = await this.server.in('support:operators').fetchSockets()
    const subjects = new Set(operators.flatMap((socket) => {
      const principal = socket.data.user as AuthPrincipal | undefined
      return principal ? [principal.subject] : []
    }))
    this.server.emit('support.presence', { operatorsOnline: subjects.size })
  }
}