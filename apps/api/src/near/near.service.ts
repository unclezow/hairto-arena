import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getDeployment,
  withOverrides,
  type AccountId,
  type BotLevel,
  type NearDeployment,
} from '@hairto-arena/shared';
import {
  Near,
  parseKey,
  type FinalExecutionOutcome,
  type PrivateKey,
  type TxExecutionStatus,
} from 'near-kit';
import type { Env } from '../config/env.js';
import { LanePool, type LaneStats } from './lane-pool.js';
import { redactUrlSecrets } from '../common/redact-url.js';

/** Service accounts. Each holds only the keys its role needs; none of them is ever sent to a browser. */
export type SignerRole = 'pusher' | 'keeper' | `bot:${BotLevel}`;

export interface CallOptions {
  /** Prepaid gas in Tgas (default 30). Unused gas is refunded. */
  tgas?: number;
  /** Attached deposit in yoctoNEAR (default none). */
  deposit?: bigint;
  /** Default `EXECUTED_OPTIMISTIC`; use `FINAL` where a later step needs finality. */
  waitUntil?: TxExecutionStatus;
}

export interface CallResult<T> {
  txHash: string;
  /** Decoded JSON return value, undefined for methods that return nothing. */
  value: T | undefined;
  outcome: FinalExecutionOutcome;
}

/** Thrown when a transaction executed but a receipt failed, for example a contract panic. */
export class NearCallError extends Error {
  constructor(
    readonly method: string,
    readonly txHash: string | undefined,
    readonly failure: unknown,
  ) {
    super(`${method} failed${txHash ? ` (${txHash})` : ''}: ${describeFailure(failure)}`);
    this.name = 'NearCallError';
  }
}

interface Signer {
  accountId: AccountId;
  /** Key per receiver contract; `*` is the key for any receiver. */
  keys: Map<string, PrivateKey>;
  /** Set for gas keys: every send takes a nonce lane. */
  lanes?: LanePool;
}

const DEFAULT_TGAS = 30;
const BOT_LEVEL_IDS: readonly BotLevel[] = [1, 2, 3, 4];

/**
 * The NEAR client layer: one read client, plus one signer per service account from the environment (pusher and bot
 * gas keys, keeper function-call keys). It replaces the EVM chain client; every contract wrapper goes through it.
 */
@Injectable()
export class NearService {
  private readonly logger = new Logger(NearService.name);
  readonly deployment: NearDeployment;
  readonly near: Near;
  private readonly signers = new Map<SignerRole, Signer>();

  constructor(private readonly config: ConfigService<Env, true>) {
    const network = config.get('NEAR_NETWORK', { infer: true });
    this.deployment = withOverrides(getDeployment(network), {
      ARENA_ID: config.get('ARENA_ID', { infer: true }),
      VAULT_ID: config.get('VAULT_ID', { infer: true }),
      USDC_ID: config.get('USDC_ID', { infer: true }),
      CHARACTERS_ID: config.get('CHARACTERS_ID', { infer: true }),
      NEAR_RPC_URL: config.get('NEAR_RPC_URL', { infer: true }),
    });
    this.near = new Near({
      network: { networkId: network, rpcUrl: this.deployment.rpcUrl },
      defaultWaitUntil: 'EXECUTED_OPTIMISTIC',
    });
    this.loadSigners();
  }

  get contracts(): NearDeployment['contracts'] {
    return this.deployment.contracts;
  }

  /** Free read of a contract view. */
  view<T>(contractId: AccountId, method: string, args: object = {}): Promise<T | undefined> {
    return this.near.view<T>(contractId, method, args);
  }

  hasSigner(role: SignerRole): boolean {
    return this.signers.has(role);
  }

  accountOf(role: SignerRole): AccountId {
    const signer = this.signers.get(role);
    if (signer) return signer.accountId;
    if (role === 'pusher')
      return (
        this.config.get('PUSHER_ACCOUNT_ID', { infer: true }) ?? this.deployment.accounts.pusher
      );
    if (role === 'keeper')
      return (
        this.config.get('KEEPER_ACCOUNT_ID', { infer: true }) ?? this.deployment.accounts.keeper
      );
    return this.botAccount(Number(role.slice(4)) as BotLevel);
  }

  /** Account that plays `level`: `BOT_LV<n>_ACCOUNT_ID`, or the manifest's. */
  botAccount(level: BotLevel): AccountId {
    return (
      this.config.get(`BOT_LV${level}_ACCOUNT_ID` as 'BOT_LV1_ACCOUNT_ID', { infer: true }) ??
      this.deployment.accounts.bots[`${level}`]
    );
  }

  /** Levels whose bot has a gas key configured. */
  botLevels(): BotLevel[] {
    return BOT_LEVEL_IDS.filter((level) => this.signers.has(`bot:${level}`));
  }

  /** Secret key that signs seed tickets. Never an account key. */
  ticketKey(): PrivateKey | undefined {
    return this.config.get('BOT_SERVICE_TICKET_KEY', { infer: true });
  }

  /** Public key (`ed25519:<base58>`) of the gas key or function-call key a role signs with for `receiverId`. */
  publicKeyOf(role: SignerRole, receiverId?: AccountId): string | undefined {
    const signer = this.signers.get(role);
    const key = signer && keyFor(signer, receiverId ?? '*');
    return key ? parseKey(key).publicKey.toString() : undefined;
  }

  /** Lanes of every gas key, for `/health`. */
  laneStats(): Partial<Record<SignerRole, LaneStats>> {
    const stats: Partial<Record<SignerRole, LaneStats>> = {};
    for (const [role, signer] of this.signers) if (signer.lanes) stats[role] = signer.lanes.stats();
    return stats;
  }

  /**
   * Sends one function call as `role`. Gas-key holders send on a free nonce lane, so concurrent calls never share
   * a nonce. Throws `NearCallError` when the transaction executed with a failure.
   */
  async call<T = unknown>(
    role: SignerRole,
    contractId: AccountId,
    method: string,
    args: object = {},
    options: CallOptions = {},
  ): Promise<CallResult<T>> {
    const signer = this.signers.get(role);
    if (!signer) throw new Error(`no key configured for ${role}`);
    const key = keyFor(signer, contractId);
    if (!key) throw new Error(`${role} has no key for ${contractId}`);

    const send = async (lane?: number): Promise<CallResult<T>> => {
      let tx = this.near.transaction(signer.accountId).signWith(key);
      if (lane !== undefined) tx = tx.useGasKey(lane);
      const outcome = await tx
        .functionCall(contractId, method, args, {
          gas: `${options.tgas ?? DEFAULT_TGAS} Tgas`,
          ...(options.deposit !== undefined && { attachedDeposit: `${options.deposit} yocto` }),
        })
        .send({ waitUntil: options.waitUntil ?? 'EXECUTED_OPTIMISTIC' });
      return decodeOutcome<T>(method, outcome as FinalExecutionOutcome);
    };
    return signer.lanes ? signer.lanes.run(send) : send();
  }

  private loadSigners(): void {
    const pusherKey = this.config.get('PUSHER_GAS_KEY', { infer: true });
    if (pusherKey) {
      this.signers.set('pusher', {
        accountId: this.accountOf('pusher'),
        keys: new Map([['*', pusherKey]]),
        lanes: new LanePool('pusher', this.config.get('PUSHER_GAS_KEY_LANES', { infer: true })),
      });
    }

    const keeperKey = this.config.get('KEEPER_KEY', { infer: true });
    if (keeperKey) {
      const vaultKey = this.config.get('KEEPER_VAULT_KEY', { infer: true }) ?? keeperKey;
      this.signers.set('keeper', {
        accountId: this.accountOf('keeper'),
        keys: new Map([
          ['*', keeperKey],
          [this.contracts.vault, vaultKey],
        ]),
      });
    }

    const botLanes = this.config.get('BOT_GAS_KEY_LANES', { infer: true });
    for (const level of BOT_LEVEL_IDS) {
      const key = this.config.get(`BOT_LV${level}_GAS_KEY` as 'BOT_LV1_GAS_KEY', { infer: true });
      if (!key) continue;
      this.signers.set(`bot:${level}`, {
        accountId: this.botAccount(level),
        keys: new Map([['*', key]]),
        lanes: new LanePool(`bot:${level}`, botLanes),
      });
    }

    const roles = [...this.signers.keys()];
    this.logger.log(
      `NEAR ${this.deployment.network} via ${redactUrlSecrets(this.deployment.rpcUrl)}; arena ${this.contracts.arena}; ` +
        `signers: ${roles.length ? roles.join(', ') : 'none'}`,
    );
  }
}

function keyFor(signer: Signer, receiverId: string): PrivateKey | undefined {
  return signer.keys.get(receiverId) ?? signer.keys.get('*');
}

/** Turns an execution outcome into the decoded return value, or throws on any failed receipt. */
export function decodeOutcome<T>(method: string, outcome: FinalExecutionOutcome): CallResult<T> {
  const txHash = outcome.transaction?.hash ?? '';
  const status = outcome.status as unknown;
  if (status && typeof status === 'object' && 'Failure' in status) {
    throw new NearCallError(method, txHash, (status as { Failure: unknown }).Failure);
  }
  for (const receipt of outcome.receipts_outcome ?? []) {
    const receiptStatus = receipt.outcome.status as unknown;
    if (receiptStatus && typeof receiptStatus === 'object' && 'Failure' in receiptStatus) {
      throw new NearCallError(method, txHash, (receiptStatus as { Failure: unknown }).Failure);
    }
  }
  let value: T | undefined;
  if (status && typeof status === 'object' && 'SuccessValue' in status) {
    const raw = (status as { SuccessValue: string }).SuccessValue;
    if (raw) {
      const text = Buffer.from(raw, 'base64').toString('utf8');
      value = JSON.parse(text) as T;
    }
  }
  return { txHash, value, outcome };
}

function describeFailure(failure: unknown): string {
  const panic = findKey(failure, 'ExecutionError') ?? findKey(failure, 'FunctionCallError');
  if (typeof panic === 'string') return panic;
  try {
    return JSON.stringify(failure);
  } catch {
    return String(failure);
  }
}

function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (key in value) return (value as Record<string, unknown>)[key];
  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}
