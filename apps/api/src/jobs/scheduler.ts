import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { renewalService } from '../modules/renewals/renewal.service.js';
import { signingService } from '../modules/signing/signing.service.js';
import { escalationService } from '../modules/workflow/escalation.service.js';
import { jobQueue } from './job-queue.js';

/**
 * In-process periodic work. A task never overlaps with itself, and every task
 * is idempotent, so running several API instances (each with its own
 * scheduler) is safe, just redundant.
 */
export function startScheduler(): () => void {
  const timers = [
    every(env.JOB_POLL_INTERVAL_MS, 'Job worker', async () => {
      const { completed, failed } = await jobQueue.runOnce();
      if (completed || failed) logger.info({ completed, failed }, 'Processed queued jobs');
    }),
    every(env.ESCALATION_SCAN_INTERVAL_MS, 'Escalation scan', async () => {
      const { escalated } = await escalationService.runOnce();
      if (escalated > 0) logger.info({ escalated }, 'Escalated overdue approval steps');
    }),
    every(env.ESCALATION_SCAN_INTERVAL_MS, 'Contract activation', async () => {
      const { activated } = await signingService.activateDueContracts();
      if (activated > 0) logger.info({ activated }, 'Activated signed contracts on their start date');
    }),
    every(env.ESCALATION_SCAN_INTERVAL_MS, 'Renewals', async () => {
      const r = await renewalService.runOnce();
      if (r.reminded || r.expired || r.renewed || r.autoRenewed) logger.info(r, 'Processed contract terms');
    }),
  ];
  return () => timers.forEach((t) => t && clearInterval(t));
}

function every(intervalMs: number, name: string, task: () => Promise<void>) {
  if (intervalMs === 0) return null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      logger.error({ err }, `${name} failed`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
