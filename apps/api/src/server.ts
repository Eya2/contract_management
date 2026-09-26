import { createApp } from './app.js';
import { env } from './config/env.js';
import { startScheduler } from './jobs/scheduler.js';
import { startLiveListener } from './lib/live.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeLiveStreams } from './modules/live/live.routes.js';

const server = createApp().listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});
const stopScheduler = startScheduler();
const stopLive = startLiveListener();

/** Graceful shutdown: stop accepting connections, then release the DB pool. */
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopScheduler();
  closeLiveStreams();
  server.close(async () => {
    await stopLive();
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
