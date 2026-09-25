import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { ZodError, z } from 'zod';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { AppError, NotFoundError } from '../errors/app-error.js';

/** Consistent error envelope: { error: { code, message, details? } } */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: z.flattenError(err) },
    });
    return;
  }
  if (err instanceof MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'FILE_TOO_LARGE' : 'BAD_UPLOAD',
        message: tooLarge ? `File exceeds the ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit` : err.message,
      },
    });
    return;
  }
  // Races that slipped past the service checks (e.g. two edits creating the same
  // version number) surface as unique violations: a conflict, not a crash.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'The record was changed concurrently, please retry' } });
    return;
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
};
