import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      connectionString: this.config.get<string>('DATABASE_URL'),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    });

    this.pool.on('error', (err) => {
      this.logger.error('Unexpected pool error', err.stack);
    });

    // Verificar conexión
    try {
      const client = await this.pool.connect();
      const res = await client.query('SELECT NOW()');
      this.logger.log(`PostgreSQL connected: ${res.rows[0].now}`);
      client.release();
    } catch (err) {
      this.logger.error('Failed to connect to PostgreSQL', err.stack);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
    this.logger.log('PostgreSQL pool closed');
  }

  /** Ejecutar query simple con parámetros */
  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        this.logger.warn(`Slow query (${duration}ms): ${text.substring(0, 80)}`);
      }
      return result;
    } catch (err) {
      this.logger.error(`Query error: ${text.substring(0, 80)}`, err.stack);
      throw err;
    }
  }

  /** Obtener un solo registro o null */
  async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] || null;
  }

  /** Obtener múltiples registros */
  async queryMany<T = any>(text: string, params?: any[]): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  /** Transacción con rollback automático en error */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Health check */
  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
