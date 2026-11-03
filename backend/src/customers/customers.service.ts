import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { RowDataPacket } from 'mysql2/promise'
import { AuthPrincipal } from '../auth/auth.types'
import { DatabaseService } from '../database/database.service'
import { CreateCustomerDto, CreateServiceRequestDto, CreateSupplyReviewDto, UpdateCustomerSupplyStatusDto, UpdateServiceRequestStatusDto } from './customers.dto'

export type CustomerRecord = {
  id: string
  name: string
  address: string
  building: string
  meterId: string
  monthlyKwh: number
  previousKwh: number
  unpaidBalance: number
  meterStatus: 'online' | 'stale' | 'offline'
  supplyStatus: 'unknown' | 'connected' | 'disconnected'
  hasAccount: boolean
}

export type ServiceRequestRecord = {
  id: string
  customerId: string
  kind: 'new_connection' | 'disconnection_review' | 'reconnection_review' | 'remote_switch_review' | 'repair'
  summary: string
  status: 'pending_review' | 'assigned' | 'completed'
  createdAt: string
}

export type RepairCrewRecord = {
  id: string
  name: string
  district: string
  skill: string
  status: string
  contact: string
}

const customerSelect = `
  SELECT c.id, c.name, c.address, c.building, c.meter_id AS meterId,
    COALESCE(current_reading.consumption_kwh, 0) AS monthlyKwh,
    COALESCE(previous_reading.consumption_kwh, 0) AS previousKwh,
    COALESCE(balance.unpaid_balance, 0) AS unpaidBalance, c.meter_status AS meterStatus,
    c.supply_status AS supplyStatus,
    (c.owner_subject IS NOT NULL) AS hasAccount
  FROM customers c
  LEFT JOIN meter_readings current_reading
    ON current_reading.customer_id = c.id
    AND current_reading.reading_month = CAST(DATE_FORMAT(UTC_DATE(), '%Y-%m-01') AS DATE)
  LEFT JOIN meter_readings previous_reading
    ON previous_reading.customer_id = c.id
    AND previous_reading.reading_month = DATE_SUB(CAST(DATE_FORMAT(UTC_DATE(), '%Y-%m-01') AS DATE), INTERVAL 1 MONTH)
  LEFT JOIN customer_balances balance ON balance.customer_id = c.id`

@Injectable()
export class CustomersService {
  constructor(private readonly database: DatabaseService) {}

  async listCustomers(principal: AuthPrincipal) {
    const ownerFilter = this.isCustomer(principal) ? 'WHERE c.owner_subject = ?' : ''
    const values = this.isCustomer(principal) ? [principal.subject] : []
    const [customers, tariff] = await Promise.all([
      this.database.query<CustomerRecord>(`${customerSelect} ${ownerFilter} ORDER BY c.id`, values),
      this.database.query<{ tariffPerKwh: number }>(
        'SELECT tariff_per_kwh AS tariffPerKwh FROM app_settings WHERE id = 1',
      ),
    ])
    return {
      customers: customers.rows.map((customer) => ({
        ...customer,
        hasAccount: Boolean(customer.hasAccount),
      })),
      tariffPerKwh: Number(tariff.rows[0]?.tariffPerKwh ?? 0),
    }
  }

  async createCustomer(input: CreateCustomerDto) {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const customer = {
      id: `CL-${suffix}`,
      name: input.name.trim(),
      address: input.address.trim(),
      building: input.building.trim(),
      meterId: `SM-${suffix}`,
      monthlyKwh: 0,
      previousKwh: 0,
      unpaidBalance: 0,
      meterStatus: 'offline' as const,
      supplyStatus: 'unknown' as const,
      hasAccount: false,
    }
    await this.database.query(
      `INSERT INTO customers (id, name, address, building, meter_id, meter_status, supply_status)
       VALUES (?, ?, ?, ?, ?, 'offline', 'unknown')`,
      [customer.id, customer.name, customer.address, customer.building, customer.meterId],
    )
    return customer
  }

  async listServiceRequests(principal: AuthPrincipal) {
    const ownerFilter = this.isCustomer(principal) ? 'WHERE r.owner_subject = ?' : ''
    const values = this.isCustomer(principal) ? [principal.subject] : []
    const result = await this.database.query<ServiceRequestRecord>(
      `SELECT r.id, r.customer_id AS customerId, r.kind, r.summary, r.status, r.created_at AS createdAt
       FROM service_requests r ${ownerFilter} ORDER BY r.created_at DESC`,
      values,
    )
    return result.rows
  }

  async listRepairCrews() {
    const result = await this.database.query<RepairCrewRecord>(
      'SELECT id, name, district, skill, status, contact FROM repair_crews ORDER BY id',
    )
    return result.rows
  }

  async createServiceRequest(input: CreateServiceRequestDto, principal: AuthPrincipal) {
    const isCustomer = this.isCustomer(principal)
    const customers = await this.database.query<{ id: string }>(
      `SELECT id FROM customers WHERE id = ?${isCustomer ? ' AND owner_subject = ?' : ''}`,
      isCustomer ? [input.customerId, principal.subject] : [input.customerId],
    )
    if (!customers.rows[0]) throw new NotFoundException('Customer account not found')

    const id = `SR-${randomUUID().slice(0, 8).toUpperCase()}`
    const status = isCustomer ? 'pending_review' : input.status ?? 'pending_review'
    await this.database.query(
      `INSERT INTO service_requests (id, customer_id, owner_subject, kind, summary, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.customerId, isCustomer ? principal.subject : null, input.kind, input.summary.trim(), status],
    )
    return this.getServiceRequest(id)
  }

  async createSupplyReview(customerId: string, input: CreateSupplyReviewDto) {
    const requestId = `SR-${randomUUID().slice(0, 8).toUpperCase()}`
    const kind = input.action === 'disconnect' ? 'disconnection_review' : 'reconnection_review'

    await this.database.transaction(async (connection) => {
      const [customerRows] = await connection.execute<(RowDataPacket & { ownerSubject: string | null })[]>(
        'SELECT owner_subject AS ownerSubject FROM customers WHERE id = ? FOR UPDATE',
        [customerId],
      )
      const customer = customerRows[0]
      if (!customer) throw new NotFoundException('Customer account not found')

      const [balanceRows] = await connection.execute<(RowDataPacket & { unpaidBalance: number })[]>(
        'SELECT COALESCE(unpaid_balance, 0) AS unpaidBalance FROM customer_balances WHERE customer_id = ?',
        [customerId],
      )
      const unpaidBalance = Number(balanceRows[0]?.unpaidBalance ?? 0)
      if (input.action === 'disconnect' && unpaidBalance <= 0) {
        throw new BadRequestException('A disconnection review requires an outstanding balance')
      }

      const [existingRequests] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM service_requests
         WHERE customer_id = ? AND kind = ? AND status IN ('pending_review', 'assigned')
         LIMIT 1`,
        [customerId, kind],
      )
      if (existingRequests.length) {
        throw new ConflictException('An active review request already exists for this customer')
      }

      const summary = input.action === 'disconnect'
        ? `Проверить задолженность ${Math.round(unpaidBalance).toLocaleString('ru-RU')} ₸ и соблюдение регламента; запрос не отключает электроснабжение`
        : 'Проверить основания и безопасность восстановления; запрос не переключает оборудование'

      await connection.execute(
        `INSERT INTO service_requests (id, customer_id, owner_subject, kind, summary, status)
         VALUES (?, ?, ?, ?, ?, 'pending_review')`,
        [requestId, customerId, customer.ownerSubject, kind, summary],
      )
    })

    return this.getServiceRequest(requestId)
  }

  async updateSupplyStatus(customerId: string, input: UpdateCustomerSupplyStatusDto) {
    const result = await this.database.query(
      'UPDATE customers SET supply_status = ? WHERE id = ?',
      [input.supplyStatus, customerId],
    )
    if (result.affectedRows === 0) {
      const customer = await this.database.query('SELECT id FROM customers WHERE id = ?', [customerId])
      if (!customer.rows.length) throw new NotFoundException('Customer account not found')
    }

    const updated = await this.database.query<CustomerRecord>(
      `${customerSelect} WHERE c.id = ?`,
      [customerId],
    )
    const customer = updated.rows[0]
    if (!customer) throw new NotFoundException('Customer account not found')
    return { ...customer, hasAccount: Boolean(customer.hasAccount) }
  }

  async updateServiceRequestStatus(id: string, input: UpdateServiceRequestStatusDto) {
    const result = await this.database.query(
      'UPDATE service_requests SET status = ? WHERE id = ?',
      [input.status, id],
    )
    if (result.affectedRows === 0) {
      const exists = await this.database.query('SELECT id FROM service_requests WHERE id = ?', [id])
      if (!exists.rows.length) throw new NotFoundException('Service request not found')
    }
    return this.getServiceRequest(id)
  }

  private async getServiceRequest(id: string) {
    const result = await this.database.query<ServiceRequestRecord>(
      `SELECT id, customer_id AS customerId, kind, summary, status, created_at AS createdAt
       FROM service_requests WHERE id = ?`,
      [id],
    )
    const request = result.rows[0]
    if (!request) throw new NotFoundException('Service request not found')
    return request
  }

  private isCustomer(principal: AuthPrincipal) {
    return principal.roles.includes('customer')
  }
}
