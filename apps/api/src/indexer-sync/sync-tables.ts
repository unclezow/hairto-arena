import { Prisma } from '../generated/prisma/client.js';
import { Dir, DuelStatus, RewardKind, VaultAction, VaultKind } from '../generated/prisma/enums.js';

/** Thrown when a row needs a parent that is indexed but not copied yet. The table stops and retries next run. */
export class DependencyMissing extends Error {}

/** Lookups the table appliers need that are not part of the Prisma transaction. */
export interface SyncContext {
  /** True when the indexer has a row with this id, even if it is not copied yet. */
  indexerHas(table: 'season' | 'duel', id: string): Promise<boolean>;
  warn(message: string): void;
}

type Tx = Prisma.TransactionClient;

/** Position of a row's last write in the indexer, used as the cursor. */
export interface RowPosition {
  block_height: string;
  log_index: number;
}

export interface TableSync<R extends RowPosition = RowPosition> {
  /** Cursor name, also the table name in the indexer schema. */
  name: string;
  /** SELECT list; numeric columns are cast to text so they arrive as exact strings. */
  select: string;
  apply(tx: Tx, rows: R[], ctx: SyncContext): Promise<void>;
}

const BOT_STRATEGY: Record<number, string> = {
  1: 'rookie',
  2: 'trend',
  3: 'reversion',
  4: 'oracle',
};
const DUEL_STATUS: Record<string, DuelStatus> = {
  created: DuelStatus.CREATED,
  finished: DuelStatus.FINISHED,
  forfeited: DuelStatus.FORFEITED,
  voided: DuelStatus.VOIDED,
};
const DIR: Record<number, Dir> = { 1: Dir.LONG, 2: Dir.SHORT };

/** Every time in schema `chain` is Unix ms. */
const toDate = (ms: string | null) => (ms === null ? null : new Date(Number(ms)));
const unique = <T>(items: T[]) => [...new Set(items)];

const ensureFighters = (tx: Tx, addresses: string[]) =>
  tx.fighter.createMany({
    data: unique(addresses).map((address) => ({ address })),
    skipDuplicates: true,
  });

const ensureBackers = (tx: Tx, addresses: string[]) =>
  tx.backer.createMany({
    data: unique(addresses).map((address) => ({ address })),
    skipDuplicates: true,
  });

/** Returns false when the season will never exist (started before the indexer's start block). */
async function seasonReady(tx: Tx, ctx: SyncContext, id: number): Promise<boolean> {
  if (await tx.season.findUnique({ where: { id }, select: { id: true } })) return true;
  if (await ctx.indexerHas('season', String(id))) throw new DependencyMissing(`season ${id}`);
  ctx.warn(`season ${id} is not indexed, skipping its rows`);
  return false;
}

interface SeasonRow extends RowPosition {
  id: string;
  start_ms: string;
  end_ms: string;
  phase: string;
  prize_root: string | null;
  bonus_root: string | null;
  prize_total: string | null;
  bonus_total: string | null;
  results_posted_at: string | null;
}

const season: TableSync<SeasonRow> = {
  name: 'season',
  select:
    'id::text, start_ms::text, end_ms::text, phase, prize_root, bonus_root, prize_total::text, bonus_total::text, results_posted_at::text, block_height::text, log_index',
  async apply(tx, rows) {
    for (const r of rows) {
      const data = {
        startAt: toDate(r.start_ms)!,
        endAt: toDate(r.end_ms)!,
        phase: r.phase,
        prizeRoot: r.prize_root,
        bonusRoot: r.bonus_root,
        prizeTotal: r.prize_total === null ? null : new Prisma.Decimal(r.prize_total),
        bonusTotal: r.bonus_total === null ? null : new Prisma.Decimal(r.bonus_total),
        resultsPostedAt: toDate(r.results_posted_at),
      };
      // potAmount is computed by the keeper and is deliberately absent from the update.
      await tx.season.upsert({
        where: { id: Number(r.id) },
        create: { id: Number(r.id), ...data },
        update: data,
      });
    }
  },
};

interface DuelRow extends RowPosition {
  id: string;
  fighter: string;
  bot: string;
  bot_level: number;
  asset_id: string;
  season: string | null;
  start_ms: string | null;
  status: string;
  winner: string | null;
  ko: boolean | null;
  created_at: string;
  finished_at: string | null;
  bot_seed: string | null;
  points_awarded: string | null;
  counted: boolean | null;
}

const duel: TableSync<DuelRow> = {
  name: 'duel',
  select:
    'id::text, fighter, bot, bot_level, asset_id::text, season::text, start_ms::text, status, winner, ko, created_at::text, finished_at::text, bot_seed, points_awarded::text, counted, block_height::text, log_index',
  async apply(tx, rows) {
    await ensureFighters(
      tx,
      rows.map((r) => r.fighter),
    );

    for (const r of rows) {
      // Bots are managed off-chain (admin, seed script). An unknown bot gets a placeholder that they overwrite.
      const bot = await tx.bot.upsert({
        where: { address: r.bot },
        create: {
          address: r.bot,
          name: `Bot Lv${r.bot_level}`,
          level: r.bot_level,
          strategy: BOT_STRATEGY[r.bot_level] ?? 'unknown',
          config: {},
        },
        update: {},
      });

      const createdAt = toDate(r.created_at)!;
      // duel_created carries the season; a row without it falls back to the season running at creation.
      const owningSeason =
        r.season !== null
          ? await tx.season.findUnique({ where: { id: Number(r.season) }, select: { id: true } })
          : await tx.season.findFirst({
              where: { startAt: { lte: createdAt } },
              orderBy: { startAt: 'desc' },
              select: { id: true },
            });
      if (!owningSeason) throw new DependencyMissing(`season for duel ${r.id}`);

      const onchain = {
        status: DUEL_STATUS[r.status] ?? DuelStatus.CREATED,
        endAt: toDate(r.finished_at),
        winner: r.winner,
        ko: r.ko ?? false,
        pointsAwarded: Number(r.points_awarded ?? 0),
        // Null until the arena records the result (at bot seed reveal); the API's own guess stays until then.
        ...(r.counted === null ? {} : { counted: r.counted }),
        ...(r.start_ms === null ? {} : { startAt: toDate(r.start_ms) }),
      };
      // bot_config (the snapshot taken at creation) is off-chain data and is never in the update.
      await tx.duel.upsert({
        where: { id: BigInt(r.id) },
        create: {
          id: BigInt(r.id),
          seasonId: owningSeason.id,
          fighterAddress: r.fighter,
          botId: bot.id,
          assetId: Number(r.asset_id),
          botConfig: {},
          createdAt,
          ...onchain,
        },
        update: onchain,
      });

      if (r.bot_seed) {
        await tx.botSeed.updateMany({
          where: { duelId: BigInt(r.id), revealedAt: null },
          data: { seed: r.bot_seed, revealedAt: toDate(r.finished_at) ?? new Date() },
        });
      }
    }
  },
};

interface PositionRow extends RowPosition {
  id: string;
  duel_id: string;
  player: string;
  dir: number | null;
  pnl_ppm: number | null;
  self_delta: number | null;
  opponent_delta: number | null;
  penalized: boolean | null;
  open_tick: string | null;
  close_tick: string | null;
  opened_at: string | null;
  closed_at: string | null;
}

const position: TableSync<PositionRow> = {
  name: 'position',
  select:
    'id, duel_id::text, player, dir, pnl_ppm, self_delta, opponent_delta, penalized, open_tick::text, close_tick::text, opened_at::text, closed_at::text, block_height::text, log_index',
  async apply(tx, rows, ctx) {
    for (const r of rows) {
      const owner = await tx.duel.findUnique({
        where: { id: BigInt(r.duel_id) },
        select: { bot: { select: { address: true } } },
      });
      if (!owner) {
        if (await ctx.indexerHas('duel', r.duel_id))
          throw new DependencyMissing(`duel ${r.duel_id}`);
        ctx.warn(`duel ${r.duel_id} is not indexed, skipping position ${r.id}`);
        continue;
      }
      const data = {
        duelId: BigInt(r.duel_id),
        player: r.player,
        isBot: owner.bot.address === r.player,
        dir: r.dir === null ? null : (DIR[r.dir] ?? null),
        openTick: r.open_tick === null ? null : Number(r.open_tick),
        closeTick: r.close_tick === null ? null : Number(r.close_tick),
        pnlPpm: r.pnl_ppm,
        selfDelta: r.self_delta,
        opponentDelta: r.opponent_delta,
        penalized: r.penalized ?? false,
        openedAt: toDate(r.opened_at),
        closedAt: toDate(r.closed_at),
      };
      await tx.position.upsert({
        where: { externalId: r.id },
        create: { externalId: r.id, ...data },
        update: data,
      });
    }
  },
};

interface DuelTxRow extends RowPosition {
  id: string;
  duel_id: string;
  kind: string;
  player: string | null;
  tx_hash: string;
  dir: number | null;
  pnl_ppm: number | null;
  self_delta: number | null;
  opponent_delta: number | null;
  timestamp: string;
}

const duelTx: TableSync<DuelTxRow> = {
  name: 'duel_tx',
  select:
    'id, duel_id::text, kind, player, tx_hash, dir, pnl_ppm, self_delta, opponent_delta, timestamp::text, block_height::text, log_index',
  async apply(tx, rows) {
    for (const r of rows) {
      const data = {
        duelId: BigInt(r.duel_id),
        kind: r.kind,
        player: r.player,
        txHash: r.tx_hash,
        dir: r.dir,
        pnlPpm: r.pnl_ppm,
        selfDelta: r.self_delta,
        opponentDelta: r.opponent_delta,
        blockNumber: BigInt(r.block_height),
        logIndex: r.log_index,
        timestamp: toDate(r.timestamp)!,
      };
      await tx.duelTx.upsert({
        where: { externalId: r.id },
        create: { externalId: r.id, ...data },
        update: data,
      });
    }
  },
};

interface ScoreRow extends RowPosition {
  season: string;
  fighter: string;
  points: string;
  duels: number;
  wins: number;
  reached_at: string;
}

const fighterScore: TableSync<ScoreRow> = {
  name: 'fighter_score',
  select:
    'season::text, fighter, points::text, duels, wins, reached_at::text, block_height::text, log_index',
  async apply(tx, rows, ctx) {
    await ensureFighters(
      tx,
      rows.map((r) => r.fighter),
    );
    for (const r of rows) {
      const seasonId = Number(r.season);
      if (!(await seasonReady(tx, ctx, seasonId))) continue;
      const data = {
        points: Number(r.points),
        duels: r.duels,
        wins: r.wins,
        reachedAt: toDate(r.reached_at),
      };
      await tx.fighterSeasonScore.upsert({
        where: { seasonId_fighterAddress: { seasonId, fighterAddress: r.fighter } },
        create: { seasonId, fighterAddress: r.fighter, ...data },
        update: data,
      });
    }
  },
};

interface VaultEventRow extends RowPosition {
  pool: string;
  account: string;
  kind: string;
  amount: string;
  timestamp: string;
  tx_hash: string;
}

const POOL: Record<string, VaultKind> = { fighter: VaultKind.FIGHTER, backer: VaultKind.BACKER };

const VAULT_ACTION: Record<string, VaultAction> = {
  deposit: VaultAction.DEPOSIT,
  withdraw: VaultAction.WITHDRAW,
  claim_yield: VaultAction.CLAIM_YIELD,
};

const vaultEvent: TableSync<VaultEventRow> = {
  name: 'vault_event',
  select:
    'pool, account, kind, amount::text, timestamp::text, tx_hash, block_height::text, log_index',
  async apply(tx, rows, ctx) {
    const known = rows.filter((r) => POOL[r.pool]);
    for (const r of rows) {
      if (!POOL[r.pool]) ctx.warn(`vault event of unknown pool ${r.pool}, skipping`);
    }
    await ensureFighters(
      tx,
      known.filter((r) => POOL[r.pool] === VaultKind.FIGHTER).map((r) => r.account),
    );
    await ensureBackers(
      tx,
      known.filter((r) => POOL[r.pool] === VaultKind.BACKER).map((r) => r.account),
    );

    for (const r of known) {
      const key = { txHash: r.tx_hash, logIndex: r.log_index };
      await tx.deposit.upsert({
        where: { txHash_logIndex: key },
        create: {
          ...key,
          address: r.account,
          vault: POOL[r.pool]!,
          action: VAULT_ACTION[r.kind] ?? VaultAction.DEPOSIT,
          amount: new Prisma.Decimal(r.amount),
          blockNumber: BigInt(r.block_height),
          timestamp: toDate(r.timestamp)!,
        },
        // Vault events are immutable: nothing to update.
        update: {},
      });
    }
  },
};

interface HarvestRow extends RowPosition {
  pool: string;
  season: string | null;
  gross_yield: string;
  fee: string;
  to_pot: string;
  to_owners: string;
  timestamp: string;
  tx_hash: string;
}

const harvest: TableSync<HarvestRow> = {
  name: 'harvest',
  select:
    'pool, season::text, gross_yield::text, fee::text, to_pot::text, to_owners::text, timestamp::text, tx_hash, block_height::text, log_index',
  async apply(tx, rows, ctx) {
    for (const r of rows) {
      const vault = POOL[r.pool];
      if (!vault) {
        ctx.warn(`harvest of unknown pool ${r.pool}, skipping`);
        continue;
      }
      // A transaction harvests once and gives a row per pool. The row moves when `pot_funded` later attaches
      // the season, so its key is the transaction and the pool (0 fighter, 1 backer), never the log position.
      const key = { txHash: r.tx_hash, logIndex: vault === VaultKind.BACKER ? 1 : 0 };
      const data = { seasonId: r.season === null ? null : Number(r.season) };
      await tx.harvest.upsert({
        where: { txHash_logIndex: key },
        create: {
          ...key,
          vault,
          ...data,
          grossYield: new Prisma.Decimal(r.gross_yield),
          fee: new Prisma.Decimal(r.fee),
          toPot: new Prisma.Decimal(r.to_pot),
          toOwners: new Prisma.Decimal(r.to_owners),
          blockNumber: BigInt(r.block_height),
          timestamp: toDate(r.timestamp)!,
        },
        // The funded season can arrive later in the same transaction (pot_funded); the rest never changes.
        update: data,
      });
    }
  },
};

interface PickRow extends RowPosition {
  season: string;
  backer: string;
  fighter: string;
}

const pick: TableSync<PickRow> = {
  name: 'pick',
  select: 'season::text, backer, fighter, block_height::text, log_index',
  async apply(tx, rows, ctx) {
    await ensureBackers(
      tx,
      rows.map((r) => r.backer),
    );
    await ensureFighters(
      tx,
      rows.map((r) => r.fighter),
    );
    for (const r of rows) {
      const seasonId = Number(r.season);
      if (!(await seasonReady(tx, ctx, seasonId))) continue;
      await tx.pick.upsert({
        where: { seasonId_backerAddress: { seasonId, backerAddress: r.backer } },
        create: { seasonId, backerAddress: r.backer, fighterAddress: r.fighter },
        update: { fighterAddress: r.fighter },
      });
    }
  },
};

interface ClaimRow extends RowPosition {
  season: string;
  account: string;
  kind: string;
  amount: string;
  timestamp: string;
  tx_hash: string;
}

const claim: TableSync<ClaimRow> = {
  name: 'claim',
  select:
    'season::text, account, kind, amount::text, timestamp::text, tx_hash, block_height::text, log_index',
  async apply(tx, rows, ctx) {
    for (const r of rows) {
      const seasonId = Number(r.season);
      if (!(await seasonReady(tx, ctx, seasonId))) continue;
      await tx.claim.upsert({
        where: { txHash: r.tx_hash },
        create: {
          seasonId,
          address: r.account,
          kind: r.kind === 'bonus' ? RewardKind.BONUS : RewardKind.PRIZE,
          amount: new Prisma.Decimal(r.amount),
          txHash: r.tx_hash,
          claimedAt: toDate(r.timestamp)!,
        },
        update: {},
      });
    }
  },
};

interface CharacterRow extends RowPosition {
  id: string;
  price: string;
  max_supply: number;
  minted: number;
  active: boolean;
}

const character: TableSync<CharacterRow> = {
  name: 'character',
  select: 'id::text, price::text, max_supply, minted, active, block_height::text, log_index',
  async apply(tx, rows) {
    for (const r of rows) {
      const data = {
        price: new Prisma.Decimal(r.price),
        maxSupply: r.max_supply,
        minted: r.minted,
        active: r.active,
      };
      await tx.character.upsert({
        where: { id: Number(r.id) },
        create: { id: Number(r.id), ...data },
        update: data,
      });
    }
  },
};

interface CharacterBalanceRow extends RowPosition {
  account: string;
  character_id: string;
  amount: string;
}

const characterBalance: TableSync<CharacterBalanceRow> = {
  name: 'character_balance',
  select: 'account, character_id::text, amount::text, block_height::text, log_index',
  async apply(tx, rows) {
    for (const r of rows) {
      const key = { address: r.account, characterId: Number(r.character_id) };
      await tx.characterBalance.upsert({
        where: { address_characterId: key },
        create: { ...key, amount: Number(r.amount) },
        update: { amount: Number(r.amount) },
      });
    }
  },
};

interface CharacterEquippedRow extends RowPosition {
  account: string;
  character_id: string;
}

const characterEquipped: TableSync<CharacterEquippedRow> = {
  name: 'character_equipped',
  select: 'account, character_id::text, block_height::text, log_index',
  async apply(tx, rows) {
    for (const r of rows) {
      await tx.characterEquip.upsert({
        where: { address: r.account },
        create: { address: r.account, characterId: Number(r.character_id) },
        update: { characterId: Number(r.character_id) },
      });
    }
  },
};

interface CharacterEquipEventRow extends RowPosition {
  id: string;
  account: string;
  character_id: string;
  timestamp: string;
}

const characterEquipEvent: TableSync<CharacterEquipEventRow> = {
  name: 'character_equip_event',
  select: 'id, account, character_id::text, timestamp::text, block_height::text, log_index',
  async apply(tx, rows) {
    for (const r of rows) {
      await tx.characterEquipEvent.upsert({
        where: { externalId: r.id },
        create: {
          externalId: r.id,
          address: r.account,
          characterId: Number(r.character_id),
          equippedAt: toDate(r.timestamp)!,
          blockNumber: BigInt(r.block_height),
          logIndex: r.log_index,
        },
        // An equip event is immutable.
        update: {},
      });
    }
  },
};

interface CharacterPurchaseRow extends RowPosition {
  id: string;
  account: string;
  character_id: string;
  kind: string;
  price: string;
  timestamp: string;
  tx_hash: string;
}

const characterPurchase: TableSync<CharacterPurchaseRow> = {
  name: 'character_purchase',
  select:
    'id, account, character_id::text, kind, price::text, timestamp::text, tx_hash, block_height::text, log_index',
  async apply(tx, rows) {
    for (const r of rows) {
      await tx.characterPurchase.upsert({
        where: { externalId: r.id },
        create: {
          externalId: r.id,
          address: r.account,
          characterId: Number(r.character_id),
          kind: r.kind,
          price: new Prisma.Decimal(r.price),
          txHash: r.tx_hash,
          purchasedAt: toDate(r.timestamp)!,
        },
        update: {},
      });
    }
  },
};

/** Erases the row type so tables with different rows can share one list. Rows come from this table's own SELECT. */
const erase = <R extends RowPosition>(t: TableSync<R>): TableSync => ({
  ...t,
  apply: (tx, rows, ctx) => t.apply(tx, rows as R[], ctx),
});

/** Order matters: parents (season, duel) are copied before the rows that reference them. */
export const SYNC_TABLES: TableSync[] = [
  erase(season),
  erase(duel),
  erase(position),
  erase(duelTx),
  erase(fighterScore),
  erase(vaultEvent),
  erase(harvest),
  erase(pick),
  erase(claim),
  erase(character),
  erase(characterBalance),
  erase(characterEquipped),
  erase(characterEquipEvent),
  erase(characterPurchase),
];
