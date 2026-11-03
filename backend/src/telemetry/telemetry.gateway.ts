import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Namespace, Socket } from 'socket.io'
import { AuthService } from '../auth/auth.service'
import { AuthPrincipal } from '../auth/auth.types'
import { getAllowedOrigins } from '../security/cors'
import type { TelemetrySample } from './telemetry.service'

@WebSocketGateway({
  namespace: '/telemetry',
  cors: { origin: getAllowedOrigins() },
})
export class TelemetryGateway implements OnGatewayInit, OnGatewayConnection {
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

  handleConnection(client: Socket) {
    client.emit('telemetry.ready', { connectedAt: new Date().toISOString() })
  }

  publish(sample: TelemetrySample, substationIds: string[]) {
    if (!this.server) return
    for (const client of this.server.sockets.values()) {
      const principal = client.data.user as AuthPrincipal | undefined
      if (principal && (principal.substationIds.includes('*')
        || substationIds.some((id) => principal.substationIds.includes(id)))) {
        client.emit('telemetry.measurement', sample)
      }
    }
  }
}