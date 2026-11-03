import type { Substation, TelemetrySample } from '../types/grid'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api/v1'

export type PaginatedResponse<T> = {
  data: T[]
  meta: { page: number; pageSize: number; total: number; pageCount: number }
}

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

export type ServiceRequest = {
  id: string
  customerId: string
  kind: 'new_connection' | 'disconnection_review' | 'reconnection_review' | 'remote_switch_review' | 'repair'
  summary: string
  status: 'pending_review' | 'assigned' | 'completed'
  createdAt: string
}

export type AlarmRecord = {
  id: string
  equipmentId: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  state: 'active' | 'acknowledged' | 'resolved'
  acknowledged: boolean
  occurredAt: string
  resolvedAt?: string | null
}

export type EquipmentRecord = {
  id: string
  substationId: string
  connectedSubstationId: string | null
  name: string
  kind: string
  status: string
}

export type RepairCrewRecord = {
  id: string
  name: string
  district: string
  skill: string
  status: string
  contact: string
}

export type UserRole = 'customer' | 'operator' | 'engineer' | 'administrator'

export type LocalUser = {
  subject: string
  username: string
  displayName: string
  role: UserRole
  createdAt?: string
}

export type AuthSession = {
  accessToken: string
  user: LocalUser
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed: ${status}`)
  }
}

const accessTokenKey = 'powergrid.accessToken'

export const authToken = {
  get: () => typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(accessTokenKey),
  set: (token: string) => sessionStorage.setItem(accessTokenKey, token),
  clear: () => sessionStorage.removeItem(accessTokenKey),
}

async function request<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<T> {
  const token = authToken.get()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (!response.ok) throw new ApiError(response.status)
  return response.json() as Promise<T>
}

export const api = {
  getAuthStatus: () => request<{
    provider: 'local'
    registrationEnabled: boolean
    setupRequired: boolean
    totalUsers: number
  }>('/auth/status'),
  register: (input: { username: string; displayName: string; password: string }) =>
    request<AuthSession>('/auth/register', { method: 'POST', body: input }),
  login: (input: { username: string; password: string }) =>
    request<AuthSession>('/auth/login', { method: 'POST', body: input }),
  getCurrentUser: () => request<LocalUser>('/auth/me'),
  getUsers: (query = '') => request<PaginatedResponse<LocalUser>>(`/users${query}`),
  updateUserRole: (subject: string, role: UserRole) =>
    request<LocalUser>(`/users/${encodeURIComponent(subject)}/role`, { method: 'PATCH', body: { role } }),
  createCustomerAccount: (input: { customerId: string; username: string; password: string }) =>
    request<LocalUser>('/users/customer-account', { method: 'POST', body: input }),
  getHealth: () => request<{
    status: string
    mode: string
    timestamp: string
    dependencies?: { database: string; telemetrySource?: { status: string; lastSeenAt: string | null } }
  }>('/health'),
  getSubstations: (query = '') => request<PaginatedResponse<Substation>>(`/substations${query}`),
  getEquipment: (query = '') => request<PaginatedResponse<EquipmentRecord>>(`/equipment${query}`),
  getRepairCrews: () => request<RepairCrewRecord[]>('/customers/repair-crews'),
  getLatestTelemetry: (query = '') => request<PaginatedResponse<TelemetrySample>>(`/telemetry/latest${query}`),
  getTelemetryHistory: (query = '') => request<PaginatedResponse<TelemetrySample>>(`/telemetry/history${query}`),
  getTelemetryQuality: (query = '') => request<PaginatedResponse<unknown>>(`/telemetry/quality${query}`),
  getAlarms: (query = '') => request<PaginatedResponse<AlarmRecord>>(`/alarms${query}`),
  acknowledgeAlarm: (id: string) =>
    request<AlarmRecord>(`/alarms/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH' }),
  getLoadReport: (query = '') => request<PaginatedResponse<unknown>>(`/reports/load${query}`),
  getCustomers: () => request<{ customers: CustomerRecord[]; tariffPerKwh: number }>('/customers'),
  updateCustomerSupplyStatus: (customerId: string, supplyStatus: CustomerRecord['supplyStatus']) =>
    request<CustomerRecord>(`/customers/${encodeURIComponent(customerId)}/supply-status`, {
      method: 'PATCH',
      body: { supplyStatus },
    }),
  createCustomerSupplyReview: (customerId: string, action: 'disconnect' | 'reconnect') =>
    request<ServiceRequest>(`/customers/${encodeURIComponent(customerId)}/supply-review`, {
      method: 'POST',
      body: { action },
    }),
  createCustomer: (input: { name: string; address: string; building: string }) =>
    request<CustomerRecord>('/customers', { method: 'POST', body: input }),
  getServiceRequests: () => request<ServiceRequest[]>('/service-requests'),
  createServiceRequest: (input: {
    customerId: string
    kind: ServiceRequest['kind']
    summary: string
    status?: ServiceRequest['status']
  }) => request<ServiceRequest>('/service-requests', { method: 'POST', body: input }),
  updateServiceRequestStatus: (id: string, status: ServiceRequest['status']) =>
    request<ServiceRequest>(`/service-requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
  createSupportConversation: (input: { customerId: string; title: string }) =>
    request<SupportConversation>('/support/conversations', { method: 'POST', body: input }),
  getSupportConversations: (query = '') =>
    request<PaginatedResponse<SupportConversation>>(`/support/conversations${query}`),
  getSupportMessages: (conversationId: string) =>
    request<SupportMessage[]>(`/support/conversations/${encodeURIComponent(conversationId)}/messages`),
  sendSupportMessage: (conversationId: string, input: { body: string; senderType: SupportMessage['senderType'] }) =>
    request<SupportMessage>(`/support/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: input,
    }),
  assignSupportConversation: (conversationId: string) =>
    request<SupportConversation>(`/support/conversations/${encodeURIComponent(conversationId)}/assign`, {
      method: 'PATCH',
    }),
}