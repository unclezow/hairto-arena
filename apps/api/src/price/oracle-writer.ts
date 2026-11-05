import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FinalExecutionOutcome } from 'near-kit';
import type { Env } from '../config/env.js';
import { ArenaClient } from '../near/arena.client.js';
import { eventsOf } from '../near/events.js';

export interface TickUpdate {
  assetId: number;
  /** 64 hex characters. */
  feedId: string;
  price: bigint;
  expo: number;
  /** Unix ms the source published this price. */
  publishMs: number;
}

export interface RecordedTick {
  assetId: number;
  tickIndex: number;
  price: bigint;
  expo: number;
  publishMs: number;
}

export interface PushResult {
  ticks: RecordedTick[];
  failed: { assetId: number; error: string }[];
}

export interface OracleWriter {
  /** Records all updates as ticks in one transaction; on failure every update in it is reported failed. */
  push(updates: TickUpdate[], options?: { gasMultiplier?: number }): Promise<PushResult>;
}

interface PushedTick {
  asset_id: number;
  index: number;
  price: number;
  expo: number;
  publish_ms: number;
}

/** Reads the `ticks_pushed` events of a `push_ticks` transaction (the arena assigns the tick index). */
export function parseRecordedTicks(outcome: FinalExecutionOutcome): RecordedTick[] {
  return eventsOf(outcome)
    .filter((e) => e.event === 'ticks_pushed')
    .flatMap((e) => (e.data as { ticks: PushedTick[] }).ticks)
    .map((t) => ({
      assetId: t.asset_id,
      tickIndex: t.index,
      price: BigInt(t.price),
      expo: t.expo,
      publishMs: t.publish_ms,
    }));
}

/**
 * One `arena.push_ticks` transaction for every update, sent on a free lane of the pusher's gas key. The arena
 * skips entries whose publish time does not advance, so an asset without a new tick is not a failure, just
 * nothing new.
 */
@Injectable()
export class NearTickWriter implements OracleWriter {
  private readonly logger = new Logger(NearTickWriter.name);

  constructor(
    private readonly arena: ArenaClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async push(updates: TickUpdate[], options: { gasMultiplier?: number } = {}): Promise<PushResult> {
    if (updates.length === 0) return { ticks: [], failed: [] };
    const tgas = Math.min(
      300,
      Math.ceil(
        (this.config.get('PRICE_TX_TGAS_BASE', { infer: true }) +
          this.config.get('PRICE_TX_TGAS_PER_ASSET', { infer: true }) * updates.length) *
          (options.gasMultiplier ?? 1),
      ),
    );
    try {
      const { outcome } = await this.arena.pushTicks(
        updates.map((u) => ({
          asset_id: u.assetId,
          price: Number(u.price),
          expo: u.expo,
          publish_ms: u.publishMs,
        })),
        tgas,
      );
      return { ticks: parseRecordedTicks(outcome), failed: [] };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`push_ticks failed: ${error}`);
      return { ticks: [], failed: updates.map((u) => ({ assetId: u.assetId, error })) };
    }
  }
}
