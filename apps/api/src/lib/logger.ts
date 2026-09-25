import { pino } from 'pino';
import { env, isProduction } from '../config/env.js';

/** Structured JSON logs in production, human-readable output in development. */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
  ...(isProduction ? {} : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
});
