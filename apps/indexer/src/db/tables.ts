import type { TableName } from '../handlers/store.js';

/**
 * Column types of schema `chain`:
 * - `bigint` is a Postgres `bigint` read back as a JS bigint (ids, heights, ms timestamps, points);
 * - `numeric` holds USDC amounts (`U128`), also read back as bigint;
 * - `int`, `text`, `bool` map to number, string and boolean.
 */
export type ColumnType = 'bigint' | 'numeric' | 'int' | 'text' | 'bool' | 'jsonb';

export interface Column {
  type: ColumnType;
  nullable?: boolean;
}

export interface TableSpec {
  /** Table name in schema `chain`. */
  sql: string;
  primaryKey: string[];
  /** camelCase field names as the handlers write them; columns are their snake_case form. */
  columns: Record<string, Column>;
}

const c = (type: ColumnType, nullable = false): Column => ({ type, nullable });
/** Every handler table ends with the position of the last event that wrote the row: the sync cursor. */
const position = { blockHeight: c('bigint'), logIndex: c('int') };

export const TABLES: Record<TableName, TableSpec> = {
  duel: {
    sql: 'duel',
    primaryKey: ['id'],
    columns: {
      id: c('bigint'),
      fighter: c('text'),
      bot: c('text'),
      botLevel: c('int'),
      assetId: c('bigint'),
      season: c('bigint', true),
      nonce: c('bigint', true),
      startMs: c('bigint', true),
      status: c('text'),
      winner: c('text', true),
      ko: c('bool', true),
      hpFighter: c('int', true),
      hpBot: c('int', true),
      createdAt: c('bigint'),
      finishedAt: c('bigint', true),
      botSeed: c('text', true),
      outcome: c('text', true),
      pointsAwarded: c('bigint', true),
      counted: c('bool', true),
      ...position,
    },
  },
  position: {
    sql: 'position',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      duelId: c('bigint'),
      player: c('text'),
      dir: c('int', true),
      pnlPpm: c('int', true),
      selfDelta: c('int', true),
      opponentDelta: c('int', true),
      penalized: c('bool', true),
      openTick: c('bigint', true),
      closeTick: c('bigint', true),
      openedAt: c('bigint', true),
      closedAt: c('bigint', true),
      ...position,
    },
  },
  duelTx: {
    sql: 'duel_tx',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      duelId: c('bigint'),
      kind: c('text'),
      player: c('text', true),
      txHash: c('text'),
      dir: c('int', true),
      pnlPpm: c('int', true),
      selfDelta: c('int', true),
      opponentDelta: c('int', true),
      timestamp: c('bigint'),
      ...position,
    },
  },
  openPosition: {
    sql: 'open_position',
    primaryKey: ['id'],
    columns: { id: c('text'), positionId: c('text'), ...position },
  },
  fighterScore: {
    sql: 'fighter_score',
    primaryKey: ['season', 'fighter'],
    columns: {
      season: c('bigint'),
      fighter: c('text'),
      points: c('bigint'),
      duels: c('int'),
      wins: c('int'),
      reachedAt: c('bigint'),
      ...position,
    },
  },
  vaultEvent: {
    sql: 'vault_event',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      pool: c('text'),
      account: c('text'),
      kind: c('text'),
      amount: c('numeric'),
      timestamp: c('bigint'),
      txHash: c('text'),
      ...position,
    },
  },
  harvest: {
    sql: 'harvest',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      pool: c('text'),
      season: c('bigint', true),
      grossYield: c('numeric'),
      fee: c('numeric'),
      toPot: c('numeric'),
      toOwners: c('numeric'),
      timestamp: c('bigint'),
      txHash: c('text'),
      ...position,
    },
  },
  pick: {
    sql: 'pick',
    primaryKey: ['season', 'backer'],
    columns: {
      season: c('bigint'),
      backer: c('text'),
      fighter: c('text'),
      timestamp: c('bigint'),
      ...position,
    },
  },
  season: {
    sql: 'season',
    primaryKey: ['id'],
    columns: {
      id: c('bigint'),
      startMs: c('bigint'),
      pickEndMs: c('bigint', true),
      endMs: c('bigint'),
      phase: c('text'),
      prizeRoot: c('text', true),
      bonusRoot: c('text', true),
      prizeTotal: c('numeric', true),
      bonusTotal: c('numeric', true),
      resultsPostedAt: c('bigint', true),
      claimOpensMs: c('bigint', true),
      rolledOverAmount: c('numeric', true),
      pot: c('numeric', true),
      ...position,
    },
  },
  claim: {
    sql: 'claim',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      season: c('bigint'),
      account: c('text'),
      kind: c('text'),
      amount: c('numeric'),
      timestamp: c('bigint'),
      txHash: c('text'),
      ...position,
    },
  },
  globalStat: {
    sql: 'global_stat',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      totalDuels: c('int'),
      finishedDuels: c('int'),
      forfeitedDuels: c('int'),
      voidedDuels: c('int'),
      ...position,
    },
  },
  character: {
    sql: 'character',
    primaryKey: ['id'],
    columns: {
      id: c('bigint'),
      price: c('numeric'),
      maxSupply: c('int'),
      minted: c('int'),
      active: c('bool'),
      ...position,
    },
  },
  characterBalance: {
    sql: 'character_balance',
    primaryKey: ['account', 'characterId'],
    columns: {
      account: c('text'),
      characterId: c('bigint'),
      amount: c('numeric'),
      ...position,
    },
  },
  characterEquipped: {
    sql: 'character_equipped',
    primaryKey: ['account'],
    columns: { account: c('text'), characterId: c('bigint'), ...position },
  },
  characterEquipEvent: {
    sql: 'character_equip_event',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      account: c('text'),
      characterId: c('bigint'),
      timestamp: c('bigint'),
      ...position,
    },
  },
  characterPurchase: {
    sql: 'character_purchase',
    primaryKey: ['id'],
    columns: {
      id: c('text'),
      account: c('text'),
      characterId: c('bigint'),
      kind: c('text'),
      price: c('numeric'),
      timestamp: c('bigint'),
      txHash: c('text'),
      ...position,
    },
  },
};

export const snake = (name: string) => name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);

const SQL_TYPE: Record<ColumnType, string> = {
  bigint: 'bigint',
  numeric: 'numeric(78, 0)',
  int: 'integer',
  text: 'text',
  bool: 'boolean',
  jsonb: 'jsonb',
};

/** Idempotent DDL of schema `chain`; `sql/schema.sql` is this output, checked by a test. */
export function renderSchema(schema = 'chain'): string {
  const out = [
    '-- Schema `chain`, written by apps/indexer and read by the API sync (`INDEXER_SCHEMA`).',
    '-- Generated from apps/indexer/src/db/tables.ts; the indexer runs it at start.',
    `CREATE SCHEMA IF NOT EXISTS ${schema};`,
    '',
    `CREATE TABLE IF NOT EXISTS ${schema}.indexer_cursor (`,
    '  name text PRIMARY KEY,',
    '  block_height bigint NOT NULL,',
    '  updated_at timestamptz NOT NULL DEFAULT now()',
    ');',
    '',
    '-- Every accepted event, also those without a handler, for audit and replay.',
    `CREATE TABLE IF NOT EXISTS ${schema}.raw_event (`,
    '  block_height bigint NOT NULL,',
    '  log_index integer NOT NULL,',
    '  block_timestamp_ms bigint NOT NULL,',
    '  receipt_id text NOT NULL,',
    '  tx_hash text,',
    '  executor text NOT NULL,',
    '  standard text NOT NULL,',
    '  version text NOT NULL,',
    '  event text NOT NULL,',
    '  data jsonb NOT NULL,',
    '  PRIMARY KEY (block_height, log_index)',
    ');',
    `CREATE INDEX IF NOT EXISTS raw_event_event_idx ON ${schema}.raw_event (event);`,
  ];
  for (const spec of Object.values(TABLES)) {
    out.push('', `CREATE TABLE IF NOT EXISTS ${schema}."${spec.sql}" (`);
    for (const [name, col] of Object.entries(spec.columns)) {
      out.push(`  "${snake(name)}" ${SQL_TYPE[col.type]}${col.nullable ? '' : ' NOT NULL'},`);
    }
    const key = spec.primaryKey.map((k) => `"${snake(k)}"`).join(', ');
    out.push(`  PRIMARY KEY (${key})`, ');');
    out.push(
      `CREATE INDEX IF NOT EXISTS "${spec.sql}_position_idx" ON ${schema}."${spec.sql}" (block_height, log_index);`,
    );
  }
  return out.join('\n') + '\n';
}
