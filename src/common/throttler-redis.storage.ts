import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
}
import { RedisService } from './redis.service';

/**
 * Redis-backed throttler storage for production.
 * Falls back to in-memory if Redis is unavailable.
 * Ensures rate limits persist across app restarts and are shared
 * if we ever scale to multiple instances.
 */
@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ThrottlerRedisStorage.name);
  private inMemory = new Map<string, { totalHits: number; expiresAt: number }>();

  constructor(private redis: RedisService) {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const redis = this.redis?.client;

    if (!redis || redis.status !== 'ready') {
      return this.incrementInMemory(key, ttl);
    }

    try {
      const totalHits = await redis.incr(key);
      if (totalHits === 1) {
        await redis.pexpire(key, ttl);
      }
      const pttl = await redis.pttl(key);

      return {
        totalHits,
        timeToExpire: Math.max(pttl, 0),
      };
    } catch (err) {
      this.logger.warn(`Redis throttle error, falling back to in-memory: ${err.message}`);
      return this.incrementInMemory(key, ttl);
    }
  }

  private incrementInMemory(key: string, ttl: number): ThrottlerStorageRecord {
    const now = Date.now();
    const existing = this.inMemory.get(key);

    if (existing && existing.expiresAt > now) {
      existing.totalHits++;
      return {
        totalHits: existing.totalHits,
        timeToExpire: existing.expiresAt - now,
      };
    }

    const entry = { totalHits: 1, expiresAt: now + ttl };
    this.inMemory.set(key, entry);

    // Cleanup old entries periodically
    if (this.inMemory.size > 10000) {
      for (const [k, v] of this.inMemory) {
        if (v.expiresAt < now) this.inMemory.delete(k);
      }
    }

    return { totalHits: 1, timeToExpire: ttl };
  }
}
