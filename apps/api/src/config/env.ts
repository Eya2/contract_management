import { z } from 'zod';

/**
 * Environment is parsed once at startup. A missing or malformed variable crashes
 * the process immediately with a readable message, instead of failing later on
 * the first request that happens to need it.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  /** Your organisation's legal name, printed as the first party on contract PDFs. */
  COMPANY_NAME: z.string().default('Contract Hub Inc.'),
  /** Public URL of the web app, used for links in emails. */
  APP_URL: z.string().default('http://localhost:4200'),
  DATABASE_URL: z.string().min(1),
  /** Separate database used by the integration tests. */
  TEST_DATABASE_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  /** Short-lived on purpose: access tokens are stateless and can't be revoked. */
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  /** Session length with "Keep me signed in" (persistent cookie). */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Session length without it: the cookie also ends when the browser closes. */
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  /** Largest accepted upload (contract documents, attachments). */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),

  /** How often the escalation scheduler looks for overdue approval steps. 0 disables it. */
  ESCALATION_SCAN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),
  /** How often the job worker polls for queued jobs (emails). 0 disables it. */
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().nonnegative().default(5_000),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  /** Credentials for a real mail provider (e.g. Gmail with an app password). Leave empty for Mailpit. */
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** true for implicit TLS (port 465); STARTTLS on 587 is negotiated automatically. */
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  MAIL_FROM: z.string().default('Contract Hub <no-reply@contracthub.local>'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
