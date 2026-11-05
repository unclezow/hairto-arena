import { Inject, Injectable } from '@nestjs/common';
import { STABLE_DECIMALS } from '@hairto-arena/shared';
import { ParamsService } from '../config/params.service.js';
import { ArenaClient } from '../near/arena.client.js';
import { VaultClient } from '../near/vault.client.js';

export interface VaultConfig {
  minDeposit: bigint;
  feeBps: number;
  ownerShareBps: number;
}

export interface ArenaParams {
  countdownMs: number;
  koImmunityMs: number;
  maxStalenessMs: number;
}

/** Contract values the backend keeps a copy of. An interface, so tests can run without a node. */
export interface OnChainParams {
  vaultConfig(vault: 'fighter' | 'backer'): Promise<VaultConfig>;
  arenaParams(): Promise<ArenaParams>;
}

export const ON_CHAIN_PARAMS = Symbol('ON_CHAIN_PARAMS');

@Injectable()
export class NearParams implements OnChainParams {
  constructor(
    private readonly vault: VaultClient,
    private readonly arena: ArenaClient,
  ) {}

  async vaultConfig(vault: 'fighter' | 'backer'): Promise<VaultConfig> {
    const c = (await this.vault.getConfig())[vault];
    return {
      minDeposit: BigInt(c.min_deposit),
      feeBps: c.fee_bps,
      ownerShareBps: c.owner_share_bps,
    };
  }

  async arenaParams(): Promise<ArenaParams> {
    const c = await this.arena.getConfig();
    return {
      countdownMs: c.countdown_ms,
      koImmunityMs: c.ko_immunity_ms,
      maxStalenessMs: c.max_staleness_ms,
    };
  }
}

export interface DriftEntry {
  parameter: string;
  shared: string;
  onChain: string | null;
  status: 'match' | 'drifted' | 'unavailable';
  error?: string;
}

/**
 * `packages/shared` and the deployed contracts must say the same (the vault pools and the owner-adjustable arena
 * parameters); this shows where they do not.
 */
@Injectable()
export class ParamDriftService {
  constructor(
    private readonly params: ParamsService,
    @Inject(ON_CHAIN_PARAMS) private readonly chain: OnChainParams,
  ) {}

  async view() {
    const entries: DriftEntry[] = [];
    for (const vault of ['fighter', 'backer'] as const) {
      const shared = this.params.vaults[vault];
      const expected = {
        minDeposit: BigInt(shared.minDepositUsd) * 10n ** BigInt(STABLE_DECIMALS),
        feeBps: BigInt(shared.feeBps),
        ownerShareBps: BigInt(shared.ownerShareBps),
      };
      let onChain: VaultConfig | null = null;
      let error: string | undefined;
      try {
        onChain = await this.chain.vaultConfig(vault);
      } catch (err) {
        error = (err as Error).message.split('\n')[0];
      }
      for (const field of ['minDeposit', 'feeBps', 'ownerShareBps'] as const) {
        const chainValue = onChain === null ? null : BigInt(onChain[field]);
        entries.push({
          parameter: `vaults.${vault}.${field}`,
          shared: expected[field].toString(),
          onChain: chainValue === null ? null : chainValue.toString(),
          status:
            chainValue === null
              ? 'unavailable'
              : chainValue === expected[field]
                ? 'match'
                : 'drifted',
          ...(error ? { error } : {}),
        });
      }
    }
    const expectedArena = {
      countdownMs: this.params.duel.countdownMs,
      koImmunityMs: this.params.duel.koImmunityMs,
      maxStalenessMs: this.params.oracle.maxStalenessMs,
    };
    let arena: ArenaParams | null = null;
    let arenaError: string | undefined;
    try {
      arena = await this.chain.arenaParams();
    } catch (err) {
      arenaError = (err as Error).message.split('\n')[0];
    }
    for (const field of ['countdownMs', 'koImmunityMs', 'maxStalenessMs'] as const) {
      const chainValue = arena === null ? null : arena[field];
      entries.push({
        parameter: `arena.${field}`,
        shared: String(expectedArena[field]),
        onChain: chainValue === null ? null : String(chainValue),
        status:
          chainValue === null
            ? 'unavailable'
            : chainValue === expectedArena[field]
              ? 'match'
              : 'drifted',
        ...(arenaError ? { error: arenaError } : {}),
      });
    }
    return {
      paramsHash: this.params.hash,
      drifted: entries.filter((e) => e.status === 'drifted').length,
      unavailable: entries.filter((e) => e.status === 'unavailable').length,
      entries,
    };
  }
}
