import { Inject, Injectable } from '@nestjs/common';
import { computeSeasonResults } from '../economics/results.js';
import { SeasonInputsLoader } from './inputs-loader.js';
import { KEEPER_CHAIN, type KeeperChain } from './keeper-chain.js';

export interface Verification {
  seasonId: number;
  match: boolean;
  computed: {
    prizeRoot: string;
    bonusRoot: string;
    inputsHash: string;
    payoutTotal: bigint;
    dust: bigint;
  };
  onChain: { prizeRoot: string; bonusRoot: string; phase: string } | null;
}

/**
 * Recomputes a season's roots from the read model and the on-chain pot, then compares them with what the chain
 * holds. Run it during the dispute window to check the keeper (`pnpm season:verify <seasonId>`).
 */
@Injectable()
export class SeasonVerifier {
  constructor(
    private readonly inputs: SeasonInputsLoader,
    @Inject(KEEPER_CHAIN) private readonly chain: KeeperChain,
  ) {}

  async verify(seasonId: number): Promise<Verification> {
    const onChain = await this.chain.getSeason(seasonId);
    if (!onChain) throw new Error(`Season ${seasonId} does not exist on the arena`);
    const pot = await this.chain.potOf(seasonId);
    const results = computeSeasonResults(await this.inputs.load(seasonId, onChain, pot));

    return {
      seasonId,
      match:
        results.prizeTree.root === onChain.prizeRoot &&
        results.bonusTree.root === onChain.bonusRoot,
      computed: {
        prizeRoot: results.prizeTree.root,
        bonusRoot: results.bonusTree.root,
        inputsHash: results.inputsHash,
        payoutTotal: results.payoutTotal,
        dust: results.dust,
      },
      onChain: { prizeRoot: onChain.prizeRoot, bonusRoot: onChain.bonusRoot, phase: onChain.phase },
    };
  }
}
