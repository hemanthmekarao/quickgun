import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { loadConfig } from '../config';

type Handler = (payload: any) => Promise<void>;

/**
 * Background jobs. With REDIS_URL set, jobs go through a BullMQ queue (durable, retried,
 * shared across API instances). Without Redis they run in-process right after the current
 * request, which is fine for a single instance and for tests.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, Handler>();
  private queue: any = null;
  private worker: any = null;
  private started = false;

  register(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  get mode(): 'redis' | 'in-process' {
    return loadConfig().redisUrl ? 'redis' : 'in-process';
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    const url = loadConfig().redisUrl;
    if (!url) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Queue, Worker } = require('bullmq');
      const u = new URL(url);
      const connection = {
        host: u.hostname,
        port: Number(u.port || 6379),
        ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
        ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
        ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
      };
      this.queue = new Queue('homeos', { connection });
      this.worker = new Worker(
        'homeos',
        async (job: any) => {
          const handler = this.handlers.get(job.name);
          if (!handler) throw new Error(`No handler for job ${job.name}`);
          await handler(job.data);
        },
        { connection },
      );
      this.worker.on('failed', (job: any, err: Error) => this.logger.error(`Job ${job?.name} failed: ${err.message}`));
      this.logger.log('Background jobs use Redis (BullMQ)');
    } catch (err) {
      this.logger.error(`Could not start the Redis queue, falling back to in-process jobs: ${(err as Error).message}`);
      this.queue = null;
    }
  }

  async enqueue(name: string, payload: unknown = {}): Promise<void> {
    this.start();
    if (this.queue) {
      await this.queue.add(name, payload, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 });
      return;
    }
    const handler = this.handlers.get(name);
    if (!handler) {
      this.logger.error(`No handler for job ${name}`);
      return;
    }
    setImmediate(() => {
      handler(payload).catch((err) => this.logger.error(`Job ${name} failed: ${(err as Error).message}`));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
