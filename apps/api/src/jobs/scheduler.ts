import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { escalationService } from '../modules/workflow/escalation.service.js';

/**
 * In-process periodic work. Runs are never overlapped, and every job is
 * idempotent, so running several API instances (each with its own scheduler)
 * is safe, just redundant.
 */
export function startScheduler(): () => void {
  if (env.ESCALATION_SCAN_INTERVAL_MS === 0) return () => {};

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { escalated } = await escalationService.runOnce();
      if (escalated > 0) logger.info({ escalated }, 'Escalated overdue approval steps');
    } catch (err) {
      logger.error({ err }, 'Escalation scan failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, env.ESCALATION_SCAN_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
