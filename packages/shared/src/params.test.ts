import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BPS,
  DAMAGE,
  DAMAGE_SCALE,
  DUEL,
  MAX_BOT_LEVEL,
  ORACLE,
  POT_SPLIT,
  PRIZE_CURVE_BPS,
  SCORE,
  SEASON,
  SEASON_BOUNDS,
} from './params.js';

const rust = readFileSync(
  new URL('../../../contracts/arena/src/params.rs', import.meta.url),
  'utf8',
);

/** params.rs with all whitespace collapsed, so wrapped Rust expressions compare as one line. */
const rustFlat = rust.replace(/\s+/g, ' ');

/** Evaluates a `const NAME: T = <expr>;` integer from params.rs (numbers, `*` and other constants). */
function rustConst(name: string): number {
  const m = rustFlat.match(new RegExp(`(?:pub )?const ${name}: [^=]+= ([^;]+);`));
  if (!m) throw new Error(`${name} not found in params.rs`);
  return m[1]!.split('*').reduce((acc, part) => {
    const term = part.trim();
    return acc * (/^[\d_]+$/.test(term) ? Number(term.replace(/_/g, '')) : rustConst(term));
  }, 1);
}

describe('params mirror the arena contract', () => {
  it('duel timing and limits', () => {
    expect(DUEL.roundDurationMs).toBe(rustConst('ROUND_MS'));
    expect(DUEL.revealGraceMs).toBe(rustConst('REVEAL_GRACE_MS'));
    expect(DUEL.seedRevealTimeoutMs).toBe(rustConst('SEED_REVEAL_TIMEOUT_MS'));
    expect(DUEL.maxTradesPerDuel).toBe(rustConst('MAX_TRADES_PER_DUEL'));
    expect(DUEL.minHoldMs).toBe(rustConst('MIN_HOLD_MS'));
    expect(DUEL.startingHp).toBe(rustConst('STARTING_HP'));
    expect(DUEL.countdownMs).toBe(rustConst('DEFAULT_COUNTDOWN_MS'));
    expect(DUEL.koImmunityMs).toBe(rustConst('DEFAULT_KO_IMMUNITY_MS'));
    expect(DUEL.ticketMaxLifetimeMs).toBe(rustConst('TICKET_MAX_LIFETIME_MS'));
    expect(DUEL.pendingTimeoutMs).toBe(rustConst('PENDING_TIMEOUT_MS'));
  });

  it('damage and oracle', () => {
    expect(DAMAGE.unrevealedBasePenaltyPpm).toBe(rustConst('UNREVEALED_BASE_PENALTY_PPM'));
    expect(DAMAGE.paperCostPpm).toBe(rustConst('DEFAULT_PAPER_COST_PPM'));
    expect(DAMAGE_SCALE.defaultHpPerBps).toBe(rustConst('DEFAULT_HP_PER_BPS'));
    expect(DAMAGE_SCALE.maxHitHp).toBe(rustConst('DEFAULT_MAX_HIT_HP'));
    expect(rustFlat).toContain('[(1, 600), (2, 400), (3, 1_500)]');
    expect(ORACLE.maxStalenessMs).toBe(rustConst('DEFAULT_MAX_STALENESS_MS'));
    expect(ORACLE.voidAfterOutageMs).toBe(rustConst('VOID_AFTER_OUTAGE_MS'));
  });

  it('score table, levels and eligibility', () => {
    expect(MAX_BOT_LEVEL).toBe(rustConst('MAX_BOT_LEVEL'));
    expect(SCORE.minDuelsForLeaderboard).toBe(rustConst('MIN_DUELS_FOR_LEADERBOARD'));
    for (const [level, range] of Object.entries(SCORE.pointsByBotLevel)) {
      const row = `PointsRange { win_min: ${range.win[0]}, win_max: ${range.win[1]}, loss_min: ${range.loss[0]}, loss_max: ${range.loss[1]}, }`;
      expect(rustFlat, `level ${level}`).toContain(row);
    }
    expect(SCORE.pointsDraw).toBe(0);
    expect(SCORE.maxCountedDuelsPerDay).toBeNull();
  });

  it('season defaults and bounds', () => {
    expect(SEASON.durationMs).toBe(rustConst('DEFAULT_SEASON_DURATION_MS'));
    expect(SEASON.pickWindowMs).toBe(rustConst('DEFAULT_PICK_WINDOW_MS'));
    expect(SEASON.disputeWindowMs).toBe(rustConst('DEFAULT_DISPUTE_WINDOW_MS'));
    expect(SEASON.closeDelayMs).toBe(rustConst('DEFAULT_CLOSE_DELAY_MS'));
    expect(SEASON.claimPeriodMs).toBe(rustConst('DEFAULT_CLAIM_PERIOD_MS'));
    expect(SEASON_BOUNDS.minDurationMs).toBe(rustConst('MIN_SEASON_DURATION_MS'));
    expect(SEASON_BOUNDS.maxDurationMs).toBe(rustConst('MAX_SEASON_DURATION_MS'));
    expect(SEASON_BOUNDS.minDisputeWindowMs).toBe(rustConst('MIN_DISPUTE_WINDOW_MS'));
    expect(SEASON_BOUNDS.maxDisputeWindowMs).toBe(rustConst('MAX_DISPUTE_WINDOW_MS'));
    expect(SEASON_BOUNDS.minCloseDelayMs).toBe(rustConst('MIN_CLOSE_DELAY_MS'));
    expect(SEASON_BOUNDS.maxCloseDelayMs).toBe(rustConst('MAX_CLOSE_DELAY_MS'));
    expect(SEASON_BOUNDS.minClaimPeriodMs).toBe(rustConst('MIN_CLAIM_PERIOD_MS'));
    expect(SEASON_BOUNDS.maxClaimPeriodMs).toBe(rustConst('MAX_CLAIM_PERIOD_MS'));
  });
});

describe('economy', () => {
  it('prize curve sums to 100% across the top 20', () => {
    expect(PRIZE_CURVE_BPS).toHaveLength(20);
    expect(PRIZE_CURVE_BPS.reduce((a, b) => a + b, 0)).toBe(BPS);
  });

  it('pot split sums to 100%', () => {
    expect(POT_SPLIT.fighterBps + POT_SPLIT.backerBps).toBe(BPS);
  });

  it('every duel in a season can settle and reveal before close', () => {
    expect(SEASON.closeDelayMs).toBeGreaterThanOrEqual(
      DUEL.revealGraceMs + DUEL.seedRevealTimeoutMs,
    );
  });

  it('damage with ppmPerHp is consistent', () => {
    expect(DAMAGE.ppmPerHp).toBeGreaterThan(0);
  });
});
