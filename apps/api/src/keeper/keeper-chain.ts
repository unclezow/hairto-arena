import { Injectable } from '@nestjs/common';
import { ArenaClient } from '../near/arena.client.js';
import type { PhaseName } from '../near/arena.types.js';
import { NearService } from '../near/near.service.js';
import { VaultClient, type VaultTotalsView } from '../near/vault.client.js';
import { rootToBase64 } from '../economics/merkle.js';

export interface ChainSeason {
  phase: PhaseName;
  startMs: number;
  endMs: number;
  /** `close_season` is accepted from `endMs + closeDelayMs`. */
  closeDelayMs: number;
  claimPeriodMs: number;
  /** Zero until results are posted. */
  resultsPostedMs: number;
  /** End of the dispute window after posting; zero until results are posted. */
  claimOpensMs: number;
  rolledOver: boolean;
  /** 64 hex characters; all zeros until results are posted. */
  prizeRoot: string;
  bonusRoot: string;
}

/** Arguments of `arena.post_results`, roots as 64 hex. A root must be zero exactly when its total is zero. */
export interface PostedResults {
  season: number;
  prizeRoot: string;
  bonusRoot: string;
  prizeTotal: bigint;
  bonusTotal: bigint;
}

/** Everything the keeper reads and sends on-chain. An interface, so tests can run without a node. */
export interface KeeperChain {
  getSeason(season: number): Promise<ChainSeason | null>;
  /** The pot of a season as the arena holds it, in USDC base units. */
  potOf(season: number): Promise<bigint>;
  /** Backer TWAB over `[fromMs, toMs)`, as the vault computes it. */
  twabOf(account: string, fromMs: number, toMs: number): Promise<bigint>;
  /** Time of the latest block in ms. The keeper never trusts its own clock for season timing. */
  now(): Promise<number>;
  vaultTotals(): Promise<VaultTotalsView>;
  /** Each returns the transaction hash. */
  harvest(): Promise<string>;
  flushPayouts(): Promise<string>;
  closeSeason(): Promise<string>;
  postResults(results: PostedResults): Promise<string>;
  rolloverUnclaimed(season: number): Promise<string>;
}

export const KEEPER_CHAIN = Symbol('KEEPER_CHAIN');

const hexOf = (base64: string) => Buffer.from(base64, 'base64').toString('hex');

/** The arena and vault on the keeper's function-call keys, every send awaited to finality. */
@Injectable()
export class NearKeeper implements KeeperChain {
  constructor(
    private readonly near: NearService,
    private readonly arena: ArenaClient,
    private readonly vault: VaultClient,
  ) {}

  async getSeason(season: number): Promise<ChainSeason | null> {
    const s = await this.arena.getSeason(season);
    if (!s) return null;
    return {
      phase: s.phase,
      startMs: s.start_ms,
      endMs: s.end_ms,
      closeDelayMs: s.close_delay_ms,
      claimPeriodMs: s.claim_period_ms,
      resultsPostedMs: s.results?.results_posted_ms ?? 0,
      claimOpensMs: s.results?.claim_opens_ms ?? 0,
      rolledOver: s.results?.rolled_over ?? false,
      prizeRoot: s.results ? hexOf(s.results.prize_root) : '00'.repeat(32),
      bonusRoot: s.results ? hexOf(s.results.bonus_root) : '00'.repeat(32),
    };
  }

  potOf(season: number) {
    return this.arena.potOf(season);
  }

  twabOf(account: string, fromMs: number, toMs: number) {
    return this.vault.twabOf(account, fromMs, toMs);
  }

  async now() {
    const status = await this.near.near.getStatus();
    const at = Date.parse(status.sync_info.latest_block_time);
    if (!Number.isFinite(at)) throw new Error('No block time from the RPC');
    return at;
  }

  vaultTotals() {
    return this.vault.getTotals();
  }

  async harvest() {
    return (await this.vault.harvest()).txHash;
  }

  async flushPayouts() {
    return (await this.vault.flushPayouts()).txHash;
  }

  async closeSeason() {
    return (await this.arena.closeSeason()).txHash;
  }

  async postResults(r: PostedResults) {
    const { txHash } = await this.arena.postResults({
      season: r.season,
      prizeRoot: rootToBase64(r.prizeRoot),
      bonusRoot: rootToBase64(r.bonusRoot),
      prizeTotal: r.prizeTotal,
      bonusTotal: r.bonusTotal,
    });
    return txHash;
  }

  async rolloverUnclaimed(season: number) {
    return (await this.arena.rolloverUnclaimed(season)).txHash;
  }
}
