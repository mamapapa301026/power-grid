import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { createPool, Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

export type DatabaseResult<Row> = {
  rows: Row[]
  insertId: number
  affectedRows: number
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null
  private connected = false
  private connecting: Promise<void> | null = null

  async onModuleInit() {
    await this.ensureConnected()
  }

  async onModuleDestroy() {
    await this.pool?.end()
  }

  isConnected() {
    return this.connected
  }

  async checkConnection() {
    try {
      await this.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  async query<Row = RowDataPacket>(
    sql: string,
    values: unknown[] = [],
  ): Promise<DatabaseResult<Row>> {
    await this.ensureConnected()
    if (!this.pool) throw new ServiceUnavailableException('MariaDB/MySQL is not connected')
    const [result] = await this.pool.execute(sql, values as never[])
    if (Array.isArray(result)) return { rows: result as Row[], insertId: 0, affectedRows: 0 }
    const header = result as ResultSetHeader
    return { rows: [], insertId: header.insertId, affectedRows: header.affectedRows }
  }

  async transaction<T>(operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
    await this.ensureConnected()
    if (!this.pool) throw new ServiceUnavailableException('MariaDB/MySQL is not connected')
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await operation(connection)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  private async ensureConnected() {
    if (this.connected) return
    if (!this.pool) {
      this.pool = createPool({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER ?? 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME ?? 'powergrid_monitor',
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
        timezone: 'Z',
        charset: 'utf8mb4',
        decimalNumbers: true,
      })
    }

    if (!this.connecting) {
      this.connecting = this.pool.query('SELECT 1')
        .then(() => { this.connected = true })
        .catch(async (error: unknown) => {
          await this.pool?.end()
          this.pool = null
          const detail = error instanceof Error ? error.message : 'Unknown database error'
          throw new Error(`Unable to connect to MariaDB/MySQL. Start MySQL in XAMPP and import database/powergrid_monitor.sql. ${detail}`)
        })
        .finally(() => { this.connecting = null })
    }
    await this.connecting
  }
}
