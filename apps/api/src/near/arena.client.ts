import { Injectable } from '@nestjs/common';
import type { AccountId, BotLevel } from '@hairto-arena/shared';
import type { TxExecutionStatus } from 'near-kit';
import type {
  ActiveSlot,
  ArenaConfigView,
  AssetView,
  BotView,
  DamageConfigView,
  DirName,
  DuelView,
  Durations,
  PositionView,
  ScoreView,
  SeasonView,
  SideName,
  TickInput,
  TickView,
} from './arena.types.js';
import { NearService, type CallResult, type SignerRole } from './near.service.js';

/** Prepaid gas per method, in Tgas. Unused gas is refunded. */
const TGAS = {
  open_position: 20,
  close_position: 40,
  reveal_bot_seed: 50,
  settle_duel: 80,
  void_duel: 30,
  prune_duel: 30,
  close_season: 30,
  post_results: 30,
  rollover_unclaimed: 30,
} as const;

/** Typed calls into the arena contract, for every method the backend uses. */
@Injectable()
export class ArenaClient {
  constructor(private readonly near: NearService) {}

  get contractId(): AccountId {
    return this.near.contracts.arena;
  }

  private view<T>(method: string, args: object = {}): Promise<T | undefined> {
    return this.near.view<T>(this.contractId, method, args);
  }

  private async viewRequired<T>(method: string, args: object = {}): Promise<T> {
    const value = await this.view<T>(method, args);
    if (value === undefined) throw new Error(`arena.${method} returned nothing`);
    return value;
  }

  private call<T = void>(
    role: SignerRole,
    method: keyof typeof TGAS | 'push_ticks',
    args: object,
    options: { tgas?: number; waitUntil?: TxExecutionStatus } = {},
  ): Promise<CallResult<T>> {
    const tgas = options.tgas ?? (method === 'push_ticks' ? 30 : TGAS[method]);
    return this.near.call<T>(role, this.contractId, method, args, {
      tgas,
      waitUntil: options.waitUntil,
    });
  }

  // ---- configuration, assets and bots ----

  getConfig(): Promise<ArenaConfigView> {
    return this.viewRequired('get_config');
  }

  /** `ed25519:<base58>` public key that seed tickets must be signed with. */
  botServiceKey(): Promise<string> {
    return this.viewRequired('bot_service_key');
  }

  async getBot(level: BotLevel): Promise<BotView | null> {
    return (await this.view<BotView | null>('get_bot', { level })) ?? null;
  }

  async getBots(): Promise<BotView[]> {
    return (await this.view<BotView[]>('get_bots')) ?? [];
  }

  async getAssets(): Promise<AssetView[]> {
    return (await this.view<AssetView[]>('get_assets')) ?? [];
  }

  async isTradable(assetId: number): Promise<boolean> {
    return (await this.view<boolean>('is_tradable', { asset_id: assetId })) ?? false;
  }

  async getDamageConfig(id: number): Promise<DamageConfigView | null> {
    return (await this.view<DamageConfigView | null>('get_damage_config', { id })) ?? null;
  }

  // ---- ticks ----

  /** True when the newest tick of the asset is older than the arena's staleness limit (or there is none). */
  async isStale(assetId: number): Promise<boolean> {
    return (await this.view<boolean>('is_stale', { asset_id: assetId })) ?? true;
  }

  latestTick(assetId: number): Promise<TickView> {
    return this.viewRequired('latest_tick', { asset_id: assetId });
  }

  getTick(assetId: number, index: number): Promise<TickView> {
    return this.viewRequired('get_tick', { asset_id: assetId, index });
  }

  /** Pusher: writes one tick per asset. Gas grows with the number of assets. */
  pushTicks(ticks: TickInput[], tgas: number): Promise<CallResult<void>> {
    return this.call('pusher', 'push_ticks', { ticks }, { tgas });
  }

  // ---- duels ----

  async activeDuelOf(fighter: AccountId): Promise<ActiveSlot | null> {
    return (await this.view<ActiveSlot | null>('active_duel_of', { fighter })) ?? null;
  }

  async nonceOf(fighter: AccountId): Promise<number> {
    return (await this.view<number>('nonce_of', { fighter })) ?? 0;
  }

  async getDuel(duelId: number | bigint): Promise<DuelView | null> {
    return (await this.view<DuelView | null>('get_duel', { duel_id: Number(duelId) })) ?? null;
  }

  async getPosition(duelId: number | bigint, side: SideName): Promise<PositionView | null> {
    return (
      (await this.view<PositionView | null>('get_position', { duel_id: Number(duelId), side })) ??
      null
    );
  }

  /** Bot: opens its position with a base64 commit. */
  openPosition(
    level: BotLevel,
    duelId: number | bigint,
    commit: string,
  ): Promise<CallResult<void>> {
    return this.call(`bot:${level}`, 'open_position', { duel_id: Number(duelId), commit });
  }

  /** Bot: reveals direction and base64 salt, closing its position. */
  closePosition(
    level: BotLevel,
    duelId: number | bigint,
    dir: DirName,
    salt: string,
  ): Promise<CallResult<void>> {
    return this.call(`bot:${level}`, 'close_position', { duel_id: Number(duelId), dir, salt });
  }

  /**
   * Reveals the bot seed of a terminal duel. Permissionless: the keeper sends it by default, a bot key works too.
   * Waits for finality, since the duel is deleted afterwards.
   */
  revealBotSeed(
    duelId: number | bigint,
    seed: string,
    role: SignerRole = 'keeper',
  ): Promise<CallResult<void>> {
    return this.call(
      role,
      'reveal_bot_seed',
      { duel_id: Number(duelId), seed, decisions_hash: null },
      { waitUntil: 'FINAL' },
    );
  }

  settleDuel(duelId: number | bigint): Promise<CallResult<void>> {
    return this.call('keeper', 'settle_duel', { duel_id: Number(duelId) }, { waitUntil: 'FINAL' });
  }

  voidDuel(duelId: number | bigint): Promise<CallResult<void>> {
    return this.call('keeper', 'void_duel', { duel_id: Number(duelId) }, { waitUntil: 'FINAL' });
  }

  pruneDuel(duelId: number | bigint): Promise<CallResult<void>> {
    return this.call('keeper', 'prune_duel', { duel_id: Number(duelId) });
  }

  // ---- seasons, scores and results ----

  async currentSeason(): Promise<number> {
    return (await this.view<number>('current_season')) ?? 0;
  }

  async getSeason(season: number): Promise<SeasonView | null> {
    return (await this.view<SeasonView | null>('get_season', { season })) ?? null;
  }

  getDurations(): Promise<Durations> {
    return this.viewRequired('get_durations');
  }

  async fundingSeason(): Promise<number> {
    return (await this.view<number>('funding_season')) ?? 0;
  }

  async potOf(season: number): Promise<bigint> {
    return BigInt((await this.view<string>('pot_of', { season })) ?? '0');
  }

  scoreOf(season: number, fighter: AccountId): Promise<ScoreView> {
    return this.viewRequired('score_of', { season, fighter });
  }

  async pickOf(season: number, backer: AccountId): Promise<AccountId | null> {
    return (await this.view<AccountId | null>('pick_of', { season, backer })) ?? null;
  }

  async isClaimed(season: number, kind: 'Prize' | 'Bonus', accountId: AccountId): Promise<boolean> {
    return (
      (await this.view<boolean>('is_claimed', { season, kind, account_id: accountId })) ?? false
    );
  }

  /** Base64 merkle leaf the contract computes for `(account_id, amount)`. */
  leafOf(accountId: AccountId, amount: bigint): Promise<string> {
    return this.viewRequired('leaf_of', { account_id: accountId, amount: amount.toString() });
  }

  closeSeason(): Promise<CallResult<void>> {
    return this.call('keeper', 'close_season', {}, { waitUntil: 'FINAL' });
  }

  /** Keeper: posts base64 roots and totals (base units). */
  postResults(input: {
    season: number;
    prizeRoot: string;
    bonusRoot: string;
    prizeTotal: bigint;
    bonusTotal: bigint;
  }): Promise<CallResult<void>> {
    return this.call(
      'keeper',
      'post_results',
      {
        season: input.season,
        prize_root: input.prizeRoot,
        bonus_root: input.bonusRoot,
        prize_total: input.prizeTotal.toString(),
        bonus_total: input.bonusTotal.toString(),
      },
      { waitUntil: 'FINAL' },
    );
  }

  rolloverUnclaimed(season: number): Promise<CallResult<void>> {
    return this.call('keeper', 'rollover_unclaimed', { season }, { waitUntil: 'FINAL' });
  }
}
