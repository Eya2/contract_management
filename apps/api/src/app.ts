import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { requestContextMiddleware } from './common/context/request-context.js';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler.js';
import { logger } from './lib/logger.js';
import { jobsRouter } from './modules/admin/jobs.routes.js';
import { auditRouter, contractAuditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { contractsRouter } from './modules/contracts/contracts.routes.js';
import { counterpartiesRouter } from './modules/counterparties/counterparties.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { departmentsRouter } from './modules/departments/departments.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { contractRenewalRouter } from './modules/renewals/renewals.routes.js';
import { contractSigningRouter, publicSigningRouter, signersRouter } from './modules/signing/signing.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import {
  approvalsRouter,
  contractWorkflowRouter,
  workflowTemplatesRouter,
} from './modules/workflow/workflow.routes.js';

/**
 * Builds the Express app without starting it, so tests can mount it in-process
 * (e.g. with supertest) and server.ts owns only the network/lifecycle concerns.
 */
export function createApp() {
  const app = express();

  // Behind a proxy (nginx, Render, …) this makes req.ip the real client IP,
  // which the audit log and e-signature records depend on.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => res.getHeader('x-request-id') as string,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/departments', departmentsRouter);
  app.use('/api/counterparties', counterpartiesRouter);
  app.use('/api/contracts', contractsRouter, contractWorkflowRouter, contractSigningRouter, contractAuditRouter, contractRenewalRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/workflow-templates', workflowTemplatesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/admin/emails', jobsRouter);
  app.use('/api/signers', signersRouter);
  app.use('/api/signing', publicSigningRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
