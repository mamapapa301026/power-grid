import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuthPrincipal } from '../auth/auth.types'
import { ListQueryDto } from '../common/list-query.dto'
import { getPagination, paginated } from '../common/pagination'
import { DatabaseService } from '../database/database.service'
import { SupportGateway } from './support.gateway'

export type SupportConversation = {
  id: string
  ownerSubject: string
  customerId: string
  title: string
  status: 'open' | 'closed'
  assignedTo: string | null
  createdAt: string
  updatedAt: string
}

export type SupportMessage = {
  id: string
  conversationId: string
  senderSubject: string
  senderType: 'customer' | 'operator' | 'assistant'
  body: string
  createdAt: string
}

@Injectable()
export class SupportService {
  constructor(private readonly database: DatabaseService, private readonly gateway: SupportGateway) {}

  async createConversation(customerId: string, title: string, principal: AuthPrincipal) {
    const existing = await this.database.query<SupportConversation>(
      `SELECT id, owner_subject AS ownerSubject, customer_id AS customerId, title, status,
        assigned_to AS assignedTo, created_at AS createdAt, updated_at AS updatedAt
       FROM support_conversations WHERE owner_subject = ? AND customer_id = ? AND status = 'open'
       ORDER BY updated_at DESC LIMIT 1`,
      [principal.subject, customerId],
    )
    if (existing.rows[0]) return existing.rows[0]

    const id = randomUUID()
    await this.database.query(
      'INSERT INTO support_conversations (id, owner_subject, customer_id, title) VALUES (?, ?, ?, ?)',
      [id, principal.subject, customerId, title],
    )
    const created = await this.getConversation(id)
    this.gateway.publishConversation(created)
    return created
  }

  async listConversations(query: ListQueryDto, _principal: AuthPrincipal) {
    const pagination = getPagination(query)
    const count = await this.database.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM support_conversations WHERE status = 'open'",
    )
    const rows = await this.database.query<SupportConversation>(
      `SELECT id, owner_subject AS ownerSubject, customer_id AS customerId, title, status,
        assigned_to AS assignedTo, created_at AS createdAt, updated_at AS updatedAt
       FROM support_conversations WHERE status = 'open' ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
    )
    return paginated(rows.rows, Number(count.rows[0]?.count ?? 0), pagination)
  }

  async listMessages(conversationId: string, principal: AuthPrincipal) {
    const conversation = await this.getConversation(conversationId)
    this.assertConversationAccess(conversation, principal)
    const result = await this.database.query<SupportMessage>(
      `SELECT id, conversation_id AS conversationId, sender_subject AS senderSubject,
        sender_type AS senderType, body, created_at AS createdAt
       FROM support_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      [conversationId],
    )
    return result.rows
  }

  async sendMessage(
    conversationId: string,
    body: string,
    senderType: SupportMessage['senderType'],
    principal: AuthPrincipal,
  ) {
    const conversation = await this.getConversation(conversationId)
    this.assertConversationAccess(conversation, principal)
    const canSupport = this.isSupport(principal)
    if (senderType === 'operator' && !canSupport) throw new ForbiddenException('Operator role is required')
    if (senderType === 'assistant' && process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Assistant messages are only available in demo mode')
    }

    const id = randomUUID()
    const messageBody = body.trim()
    await this.database.query(
      `INSERT INTO support_messages (id, conversation_id, sender_subject, sender_type, body)
       VALUES (?, ?, ?, ?, ?)`,
      [id, conversationId, principal.subject, senderType, messageBody],
    )
    await this.database.query(
      'UPDATE support_conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [conversationId],
    )
    const saved = await this.database.query<SupportMessage>(
      `SELECT id, conversation_id AS conversationId, sender_subject AS senderSubject,
        sender_type AS senderType, body, created_at AS createdAt
       FROM support_messages WHERE id = ?`,
      [id],
    )
    const message = saved.rows[0]
    this.gateway.publishMessage(message, conversation.ownerSubject)
    return message
  }

  async assignConversation(conversationId: string, principal: AuthPrincipal) {
    if (!this.isSupport(principal)) throw new ForbiddenException('Operator role is required')
    await this.getConversation(conversationId)
    await this.database.query(
      `UPDATE support_conversations SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [principal.subject, conversationId],
    )
    return this.getConversation(conversationId)
  }

  private async getConversation(conversationId: string) {
    const result = await this.database.query<SupportConversation>(
      `SELECT id, owner_subject AS ownerSubject, customer_id AS customerId, title, status,
        assigned_to AS assignedTo, created_at AS createdAt, updated_at AS updatedAt
       FROM support_conversations WHERE id = ?`,
      [conversationId],
    )
    const conversation = result.rows[0]
    if (!conversation) throw new NotFoundException('Support conversation not found')
    return conversation
  }

  private assertConversationAccess(conversation: SupportConversation, principal: AuthPrincipal) {
    if (conversation.ownerSubject !== principal.subject && !this.isSupport(principal)) {
      throw new ForbiddenException('Access to this support conversation is denied')
    }
  }

  private isSupport(principal: AuthPrincipal) {
    return principal.roles.some((role) => ['operator', 'engineer', 'administrator'].includes(role))
  }
}
