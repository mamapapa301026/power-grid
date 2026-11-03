import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common'
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import jwt from 'jsonwebtoken'
import { RowDataPacket } from 'mysql2/promise'
import { DatabaseService } from '../database/database.service'
import { AuthPrincipal } from './auth.types'

const deriveKey = promisify(scrypt)
const localRoles = ['customer', 'operator', 'engineer', 'administrator'] as const
export type LocalRole = typeof localRoles[number]

type LocalUser = {
  subject: string
  username: string
  displayName: string
  passwordSalt: string
  passwordHash: string
  role: LocalRole
  createdAt: string | Date
}

type UserRow = RowDataPacket & LocalUser
export type PublicUser = Pick<LocalUser, 'subject' | 'username' | 'displayName' | 'role' | 'createdAt'>
export type AuthSession = { accessToken: string; user: PublicUser }

function isLocalRole(value: unknown): value is LocalRole {
  return typeof value === 'string' && localRoles.includes(value as LocalRole)
}

@Injectable()
export class AuthService implements OnModuleInit {
  private signingKey = ''
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.transaction(async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT session_signing_key AS signingKey FROM app_settings WHERE id = 1 FOR UPDATE',
      )
      const signingKey = rows[0]?.signingKey
      if (typeof signingKey === 'string' && signingKey.length > 0) {
        this.signingKey = signingKey
        return
      }

      this.signingKey = randomBytes(32).toString('base64url')
      await connection.execute(
        'UPDATE app_settings SET session_signing_key = ? WHERE id = 1',
        [this.signingKey],
      )
    })
  }

  async getStatus() {
    const result = await this.database.query<RowDataPacket & { totalUsers: number }>(
      'SELECT COUNT(*) AS totalUsers FROM users',
    )
    const totalUsers = Number(result.rows[0]?.totalUsers ?? 0)
    return {
      provider: 'local',
      registrationEnabled: true,
      setupRequired: totalUsers === 0,
      totalUsers,
    }
  }

  async register(username: string, displayName: string, password: string): Promise<AuthSession> {
    const normalizedUsername = username.trim().toLowerCase()
    const passwordSalt = randomBytes(16).toString('base64url')
    const passwordHash = (await this.hashPassword(password, passwordSalt)).toString('base64url')

    return this.withMutation(() => this.database.transaction(async (connection) => {
      await connection.execute('SELECT id FROM app_settings WHERE id = 1 FOR UPDATE')
      const [existing] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE username = ?',
        [normalizedUsername],
      )
      if (existing.length) throw new ConflictException('This username is already registered')

      const [countRows] = await connection.execute<RowDataPacket[]>(
        'SELECT COUNT(*) AS totalUsers FROM users',
      )
      const role: LocalRole = Number(countRows[0]?.totalUsers ?? 0) === 0 ? 'administrator' : 'customer'
      const user: LocalUser = {
        subject: randomUUID(),
        username: normalizedUsername,
        displayName: displayName.trim(),
        passwordSalt,
        passwordHash,
        role,
        createdAt: new Date(),
      }
      await connection.execute(
        `INSERT INTO users (subject_id, username, display_name, password_salt, password_hash, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.subject, user.username, user.displayName, passwordSalt, passwordHash, role],
      )
      if (role === 'customer') {
        const customerSuffix = randomUUID().slice(0, 8).toUpperCase()
        await connection.execute(
          `INSERT INTO customers (id, owner_subject, name, address, building, meter_id, meter_status)
           VALUES (?, ?, ?, '', '', ?, 'offline')`,
          [`CL-${customerSuffix}`, user.subject, user.displayName, `SM-${customerSuffix}`],
        )
      }
      return this.createSession(user)
    }))
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const normalizedUsername = username.trim().toLowerCase()
    const result = await this.database.query<UserRow>(
      `SELECT subject_id AS subject, username, display_name AS displayName,
        password_salt AS passwordSalt, password_hash AS passwordHash, role, created_at AS createdAt
       FROM users WHERE username = ?`,
      [normalizedUsername],
    )
    const user = result.rows[0]
    if (!user) throw new UnauthorizedException('Incorrect username or password')

    const suppliedHash = await this.hashPassword(password, user.passwordSalt)
    const savedHash = Buffer.from(user.passwordHash, 'base64url')
    if (suppliedHash.length !== savedHash.length || !timingSafeEqual(suppliedHash, savedHash)) {
      throw new UnauthorizedException('Incorrect username or password')
    }
    return this.createSession(user)
  }

  async authenticate(token?: string): Promise<AuthPrincipal> {
    if (!token) throw new UnauthorizedException('A local access token is required')
    const simulatorToken = process.env.SIMULATOR_TOKEN
    if (simulatorToken) {
      const expected = Buffer.from(simulatorToken)
      const supplied = Buffer.from(token)
      if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) {
        return {
          subject: 'local-telemetry-simulator',
          username: 'telemetry-simulator',
          displayName: 'Локальный симулятор телеметрии',
          roles: ['operator', 'engineer'],
          substationIds: ['*'],
        }
      }
    }

    try {
      const claims = jwt.verify(token, this.getSigningKey(), {
        algorithms: ['HS256'],
        issuer: 'powergrid-local',
      })
      if (typeof claims === 'string' || typeof claims.sub !== 'string') {
        throw new UnauthorizedException('Invalid local access token')
      }
      const result = await this.database.query<UserRow>(
        `SELECT subject_id AS subject, username, display_name AS displayName,
          password_salt AS passwordSalt, password_hash AS passwordHash, role, created_at AS createdAt
         FROM users WHERE subject_id = ?`,
        [claims.sub],
      )
      const user = result.rows[0]
      if (!user || !isLocalRole(user.role)) throw new UnauthorizedException('Local account no longer exists')
      return this.toPrincipal(user)
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error
      if (error instanceof Error && error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Local access token has expired or is invalid')
      }
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Local access token has expired or is invalid')
      }
      throw error
    }
  }

  async listUsers(search = ''): Promise<PublicUser[]> {
    const normalizedSearch = search.trim()
    const result = await this.database.query<UserRow>(
      `SELECT subject_id AS subject, username, display_name AS displayName,
        password_salt AS passwordSalt, password_hash AS passwordHash, role, created_at AS createdAt
       FROM users
       WHERE ? = '' OR username LIKE ? OR display_name LIKE ?
       ORDER BY created_at ASC`,
      [normalizedSearch, `%${normalizedSearch}%`, `%${normalizedSearch}%`],
    )
    return result.rows.map((user) => this.toPublicUser(user))
  }

  async updateRole(subject: string, role: LocalRole): Promise<PublicUser> {
    return this.withMutation(() => this.database.transaction(async (connection) => {
      await connection.execute('SELECT id FROM app_settings WHERE id = 1 FOR UPDATE')
      const [rows] = await connection.execute<UserRow[]>(
        `SELECT subject_id AS subject, username, display_name AS displayName,
          password_salt AS passwordSalt, password_hash AS passwordHash, role, created_at AS createdAt
         FROM users WHERE subject_id = ? FOR UPDATE`,
        [subject],
      )
      const user = rows[0]
      if (!user) throw new NotFoundException('Local user not found')
      if (user.role === 'administrator' && role !== 'administrator') {
        const [admins] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS total FROM users WHERE role = 'administrator' AND subject_id <> ?",
          [subject],
        )
        if (Number(admins[0]?.total ?? 0) === 0) {
          throw new ConflictException('At least one administrator account must remain')
        }
      }
      await connection.execute('UPDATE users SET role = ? WHERE subject_id = ?', [role, subject])
      return this.toPublicUser({ ...user, role })
    }))
  }

  async createCustomerAccount(customerId: string, username: string, password: string): Promise<PublicUser> {
    const normalizedUsername = username.trim().toLowerCase()
    const passwordSalt = randomBytes(16).toString('base64url')
    const passwordHash = (await this.hashPassword(password, passwordSalt)).toString('base64url')

    return this.withMutation(() => this.database.transaction(async (connection) => {
      await connection.execute('SELECT id FROM app_settings WHERE id = 1 FOR UPDATE')
      const [customers] = await connection.execute<RowDataPacket[]>(
        'SELECT id, name, owner_subject AS ownerSubject FROM customers WHERE id = ? FOR UPDATE',
        [customerId.trim()],
      )
      const customer = customers[0]
      if (!customer) throw new NotFoundException('Customer account record not found')
      if (customer.ownerSubject) throw new ConflictException('This customer already has a login account')

      const [existing] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE username = ?',
        [normalizedUsername],
      )
      if (existing.length) throw new ConflictException('This username is already registered')

      const user: LocalUser = {
        subject: randomUUID(),
        username: normalizedUsername,
        displayName: String(customer.name),
        passwordSalt,
        passwordHash,
        role: 'customer',
        createdAt: new Date(),
      }
      await connection.execute(
        `INSERT INTO users (subject_id, username, display_name, password_salt, password_hash, role)
         VALUES (?, ?, ?, ?, ?, 'customer')`,
        [user.subject, user.username, user.displayName, passwordSalt, passwordHash],
      )
      await connection.execute(
        'UPDATE customers SET owner_subject = ? WHERE id = ?',
        [user.subject, customer.id],
      )
      await connection.execute(
        'UPDATE service_requests SET owner_subject = ? WHERE customer_id = ? AND owner_subject IS NULL',
        [user.subject, customer.id],
      )
      await connection.execute(
        'UPDATE support_conversations SET owner_subject = ? WHERE customer_id = ? AND owner_subject IS NULL',
        [user.subject, customer.id],
      )
      return this.toPublicUser(user)
    }))
  }

  private withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private getSigningKey() {
    if (!this.signingKey) throw new Error('Local session signing key was not initialized')
    return this.signingKey
  }

  private async hashPassword(password: string, salt: string): Promise<Buffer> {
    return deriveKey(password, salt, 64) as Promise<Buffer>
  }

  private createSession(user: LocalUser): AuthSession {
    return {
      accessToken: jwt.sign({}, this.getSigningKey(), {
        algorithm: 'HS256',
        subject: user.subject,
        issuer: 'powergrid-local',
        expiresIn: '12h',
      }),
      user: this.toPublicUser(user),
    }
  }

  private toPrincipal(user: LocalUser): AuthPrincipal {
    if (!isLocalRole(user.role)) throw new UnauthorizedException('Local account has an invalid role')
    return {
      subject: user.subject,
      username: user.username,
      displayName: user.displayName,
      roles: [user.role],
      substationIds: ['*'],
    }
  }

  private toPublicUser(user: LocalUser): PublicUser {
    const createdAt = user.createdAt instanceof Date ? user.createdAt.toISOString() : new Date(user.createdAt).toISOString()
    return {
      subject: user.subject,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt,
    }
  }
}
