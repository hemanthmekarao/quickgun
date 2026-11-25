import { randomBytes } from 'node:crypto';
import { parseKey } from './common/crypto';

export interface AppConfig {
  env: string;
  isProd: boolean;
  port: number;
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  dataKey: Buffer;
  webOrigins: string[];
  /** Public base URL of the API (used in signed file links), without trailing slash. */
  publicApiUrl: string;
  /** Public base URL of the web app (used in invite links). */
  publicWebUrl: string;
  cookieSecure: boolean;
  storage: {
    driver: 'local' | 's3';
    localDir: string;
    s3Bucket?: string;
    s3Region?: string;
    s3Endpoint?: string;
    s3ForcePathStyle: boolean;
  };
  maxUploadBytes: number;
  openai: { apiKey?: string; model: string; baseUrl: string };
  redisUrl?: string;
  smtpUrl?: string;
  mailFrom: string;
  payments: { sandboxEnabled: boolean; sandboxWebhookSecret: string };
  inboundEmailSecret?: string;
  schedulerEnabled: boolean;
  /** When true, the daily job erases households/accounts whose deletion grace period has passed. */
  deletionJobEnabled: boolean;
}

let cached: AppConfig | null = null;

function required(name: string, isProd: boolean, devFallback: () => string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (isProd) throw new Error(`${name} must be set in production`);
  return devFallback();
}

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const env = process.env.NODE_ENV ?? 'development';
  const isProd = env === 'production';
  const port = Number(process.env.PORT ?? 4000);

  const jwtSecret = required('JWT_SECRET', isProd, () => {
    // Development only: sessions do not survive a restart.
    return randomBytes(48).toString('hex');
  });
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

  const dataKeyHex = required('DATA_ENCRYPTION_KEY', isProd, () => {
    // Development only: a fixed key so locally stored files stay readable across restarts.
    return '6465762d6f6e6c792d686f6d656f732d6b65792d646f2d6e6f742d7573652121';
  });

  const publicApiUrl = (process.env.PUBLIC_API_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  const publicWebUrl = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  cached = {
    env,
    isProd,
    port,
    jwtSecret,
    accessTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    dataKey: parseKey(dataKeyHex),
    webOrigins: (process.env.WEB_ORIGINS ?? publicWebUrl)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    publicApiUrl,
    publicWebUrl,
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
    storage: {
      driver: process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
      localDir: process.env.STORAGE_LOCAL_DIR ?? 'storage',
      s3Bucket: process.env.S3_BUCKET,
      s3Region: process.env.S3_REGION,
      s3Endpoint: process.env.S3_ENDPOINT,
      s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    },
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
    openai: {
      apiKey: process.env.OPENAI_API_KEY || undefined,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    },
    redisUrl: process.env.REDIS_URL || undefined,
    smtpUrl: process.env.SMTP_URL || undefined,
    mailFrom: process.env.MAIL_FROM ?? 'HomeOS <no-reply@localhost>',
    payments: {
      // The sandbox provider simulates a gateway for demos and tests. It can never be enabled in production.
      sandboxEnabled: !isProd && process.env.PAYMENTS_SANDBOX === 'true',
      sandboxWebhookSecret: process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET ?? 'sandbox-webhook-secret',
    },
    inboundEmailSecret: process.env.INBOUND_EMAIL_SECRET || undefined,
    schedulerEnabled: process.env.SCHEDULER_ENABLED ? process.env.SCHEDULER_ENABLED === 'true' : env !== 'test',
    deletionJobEnabled: process.env.DELETION_JOB_ENABLED === 'true',
  };
  return cached;
}

/** Test helper. */
export function resetConfig(): void {
  cached = null;
}
