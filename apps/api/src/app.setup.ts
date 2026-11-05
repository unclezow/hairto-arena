import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { SerializeInterceptor } from './common/serialize.interceptor.js';

export const API_PREFIX = 'api/v1';

/** Conventions shared by the real server and the e2e tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix(API_PREFIX);
  // Nest only handles unknown paths inside the prefix; anything outside it would get Express' HTML 404.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const inApi = req.path === `/${API_PREFIX}` || req.path.startsWith(`/${API_PREFIX}/`);
    if (inApi || req.path.startsWith('/socket.io')) return next();
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.path}` } });
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new SerializeInterceptor());
}
