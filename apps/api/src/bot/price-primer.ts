import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { ORACLE_KEYS } from '../price/oracle-keys.js';
import { RedisService } from '../redis/redis.service.js';
import { BOT_GATEWAY, BotChainError, type BotGateway } from './bot-gateway.js';

const POLL_MS = 250;

/**
 * Prices are only pushed on-chain for assets in play. Before a seed ticket is signed its asset is marked as
 * demanded, and signing waits until the arena has a fresh tick for it, so `start_duel` does not fail on staleness.
 */
@Injectable()
export class PricePrimer {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    @Inject(BOT_GATEWAY) private readonly gateway: BotGateway,
  ) {}

  async prime(assetId: number): Promise<void> {
    await this.redis.client.set(
      ORACLE_KEYS.demand(assetId),
      '1',
      'EX',
      this.config.get('PRICE_DEMAND_TTL_SEC', { infer: true }),
    );
    const deadline = Date.now() + this.config.get('PRICE_PRIME_TIMEOUT_MS', { infer: true });
    for (;;) {
      if (await this.gateway.isPriceFresh(assetId)) return;
      if (Date.now() >= deadline) {
        throw new BotChainError(
          'ORACLE_UNAVAILABLE',
          `No fresh on-chain price for asset ${assetId}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}
