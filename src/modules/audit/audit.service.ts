import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private db: DatabaseService) {}

  /**
   * Log an access event (who viewed/exported/downloaded what)
   */
  async logAccess(
    userId: string | null,
    userType: 'doctor' | 'secretary' | 'patient' | 'system',
    action: string,
    resourceType?: string,
    resourceId?: string,
    ip?: string,
    userAgent?: string,
    metadata?: Record<string, any>,
  ) {
    try {
      await this.db.query(
        `INSERT INTO access_logs (user_id, user_type, action, resource_type, resource_id, ip_address, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, userType, action, resourceType, resourceId, ip, userAgent, metadata ? JSON.stringify(metadata) : null],
      );
    } catch (err) {
      // Access logging should never break the main flow
      this.logger.error(`Failed to log access: ${err.message}`);
    }
  }

  /**
   * Manually log a data change (for tables without DB triggers)
   */
  async logChange(
    tableName: string,
    recordId: string,
    action: 'INSERT' | 'UPDATE' | 'DELETE',
    oldData: any,
    newData: any,
    changedBy?: string,
    ip?: string,
    userAgent?: string,
  ) {
    try {
      await this.db.query(
        `INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tableName, recordId, action,
          oldData ? JSON.stringify(oldData) : null,
          newData ? JSON.stringify(newData) : null,
          changedBy, ip, userAgent,
        ],
      );
    } catch (err) {
      this.logger.error(`Failed to log change: ${err.message}`);
    }
  }

  /**
   * Get full audit trail for a specific record
   */
  async getAuditTrail(tableName: string, recordId: string) {
    return this.db.queryMany(
      `SELECT al.*,
              d.first_name || ' ' || d.last_name AS changed_by_name
       FROM audit_log al
       LEFT JOIN doctors d ON d.id = al.changed_by
       WHERE al.table_name = $1 AND al.record_id = $2
       ORDER BY al.changed_at DESC`,
      [tableName, recordId],
    );
  }

  /**
   * Get access logs with optional filters and pagination
   */
  async getAccessLogs(filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.userId) {
      conditions.push(`al.user_id = $${idx++}`);
      values.push(filters.userId);
    }
    if (filters.action) {
      conditions.push(`al.action = $${idx++}`);
      values.push(filters.action);
    }
    if (filters.resourceType) {
      conditions.push(`al.resource_type = $${idx++}`);
      values.push(filters.resourceType);
    }
    if (filters.from) {
      conditions.push(`al.created_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`al.created_at <= $${idx++}`);
      values.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    values.push(limit, offset);

    return this.db.queryMany(
      `SELECT al.*,
              d.first_name || ' ' || d.last_name AS user_name
       FROM access_logs al
       LEFT JOIN doctors d ON d.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      values,
    );
  }
}
