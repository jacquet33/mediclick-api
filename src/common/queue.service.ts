import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss = require('pg-boss');

/**
 * Colas de trabajo persistentes sobre la misma base Postgres (pg-boss, esquema "pgboss").
 * Sirve para que el pedido del usuario o del webhook responda al instante y el trabajo lento
 * (WhatsApp, mails, push a las apps, consultas al Ministerio) se haga aparte, con reintentos.
 * Sobrevive a reinicios: lo pendiente queda en la base.
 *
 * Si la cola no arranca, `enviar` devuelve false y quien llama hace el trabajo en el momento.
 */
export type Cola = 'wa-respuesta' | 'email' | 'push';

const CONFIG: Record<Cola, PgBoss.Queue & { lote: number }> = {
  // Respuestas automáticas a mensajes de pacientes (confirmar / cancelar / "te respondemos")
  'wa-respuesta': { name: 'wa-respuesta', retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 120, lote: 5 },
  // Mails transaccionales
  email: { name: 'email', retryLimit: 6, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, lote: 5 },
  // Notificaciones push a las apps de los médicos (APNs / FCM)
  push: { name: 'push', retryLimit: 4, retryDelay: 15, retryBackoff: true, expireInSeconds: 60, lote: 10 },
};

type Handler = (data: any) => Promise<void>;

@Injectable()
export class QueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private boss: PgBoss | null = null;
  private listo = false;
  private readonly handlers = new Map<Cola, Handler>();

  constructor(private config: ConfigService) {}

  get activa() { return this.listo; }

  async onModuleInit() {
    const url = this.config.get<string>('DATABASE_URL');
    if (!url || this.config.get('QUEUE_DISABLED') === 'true') {
      this.logger.warn('Colas desactivadas: el trabajo se hace en el momento');
      return;
    }
    try {
      this.boss = new PgBoss({ connectionString: url, schema: 'pgboss', max: 4, application_name: 'tusrecetasmed-colas' });
      this.boss.on('error', (e) => this.logger.warn(`Colas: ${e.message}`));
      await this.boss.start();
      for (const c of Object.values(CONFIG)) {
        const { lote, ...opts } = c;
        await this.boss.createQueue(c.name, opts).catch(async () => this.boss!.updateQueue(c.name, opts).catch(() => {}));
      }
      this.listo = true;
      for (const [cola, h] of this.handlers) await this.trabajar(cola, h);
      this.logger.log('Colas listas (pg-boss)');
    } catch (e: any) {
      this.logger.error(`No arrancaron las colas, sigo sin ellas: ${e.message}`);
      this.boss = null;
    }
  }

  async onApplicationShutdown() {
    // Termina lo que está procesando antes de cerrar (deploy sin perder trabajos)
    if (this.boss) await this.boss.stop({ graceful: true, timeout: 20_000 }).catch(() => {});
  }

  /** Registra quién procesa una cola. Se puede llamar antes o después de que arranquen. */
  async procesar(cola: Cola, handler: Handler) {
    this.handlers.set(cola, handler);
    if (this.listo) await this.trabajar(cola, handler);
  }

  private async trabajar(cola: Cola, handler: Handler) {
    // De a un trabajo por worker: si falla, pg-boss reintenta solo ese (con espera creciente).
    // `lote` workers en paralelo por cola.
    for (let i = 0; i < CONFIG[cola].lote; i++) {
      await this.boss!.work(cola, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
        await handler(job.data);
      });
    }
  }

  /** Encola un trabajo. Devuelve false si no hay cola: entonces hay que hacerlo en el momento. */
  async enviar(cola: Cola, data: object, opts: PgBoss.SendOptions = {}): Promise<boolean> {
    if (!this.listo || !this.boss) return false;
    try {
      return !!(await this.boss.send(cola, data, opts));
    } catch (e: any) {
      this.logger.warn(`No se pudo encolar en ${cola}: ${e.message}`);
      return false;
    }
  }

  /** Para el diagnóstico: trabajos pendientes y fallidos por cola (solo cantidades). */
  async estado() {
    if (!this.boss) return { activa: false };
    const out: Record<string, any> = { activa: true };
    for (const c of Object.keys(CONFIG)) out[c] = await this.boss.getQueueSize(c).catch(() => null);
    return out;
  }
}
