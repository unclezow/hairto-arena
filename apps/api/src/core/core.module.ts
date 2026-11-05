import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from '../auth/auth.module.js';
import { NearModule } from '../near/near.module.js';
import { ParamsModule } from '../config/params.module.js';
import { RuntimeFlagsModule } from '../flags/runtime-flags.service.js';
import { LOG_REDACT } from '../common/log-redact.js';
import { validateEnv, type Env } from '../config/env.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { RedisModule } from '../redis/redis.module.js';

/** Infrastructure shared by both entrypoints (API and worker). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          redact: { paths: LOG_REDACT, censor: '[redacted]' },
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id = typeof incoming === 'string' && incoming ? incoming : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    NearModule,
    ParamsModule,
    RuntimeFlagsModule,
    AuthModule,
    RateLimitModule,
  ],
})
export class CoreModule {}
