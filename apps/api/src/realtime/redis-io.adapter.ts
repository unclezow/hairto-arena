import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';

/** Socket.IO adapter backed by Redis so several API instances share rooms, with the CORS and size limits applied. */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  connectToRedis() {
    const redis = this.app.get(RedisService);
    this.adapterConstructor = createAdapter(redis.createSubscriber(), redis.createSubscriber());
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const config = this.app.get<ConfigService<Env, true>>(ConfigService);
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: config.get('WEB_ORIGIN', { infer: true }) },
      maxHttpBufferSize: config.get('WS_MAX_MESSAGE_BYTES', { infer: true }),
    } as ServerOptions);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
