import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy > 0) app.set('trust proxy', trustProxy);
  const origin = config.get('WEB_ORIGIN', { infer: true });
  app.enableCors({ origin });

  const ioAdapter = new RedisIoAdapter(app);
  ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
