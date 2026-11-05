'use client';
import { POT_SPLIT, STABLE_DECIMALS } from '@hairto-arena/shared';
import { formatUnits } from '@/lib/amount';
import { featureReady } from '@/lib/features';
import { useEconomyData } from '@/hooks/use-economy-data';
const BPS = 10_000n;
const YEAR = 365n * 24n * 3600n;
const WEEK = 7n * 24n * 3600n;

const usd = (v: bigint) =>
  `${Number(formatUnits(v, STABLE_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;


interface VaultShare {
  gross: bigint;
  fee: bigint;
  toOwners: bigint;
  toPot: bigint;
}

/** One season of yield on `tvl`, split like `YieldVault.harvest` does. */
function seasonYield(
  tvl: bigint,
  apyBps: bigint,
  seconds: bigint,
  feeBps: bigint,
  ownerBps: bigint,
) {
  const gross = (tvl * apyBps * seconds) / (BPS * YEAR);
  const fee = (gross * feeBps) / BPS;
  const toOwners = ((gross - fee) * ownerBps) / BPS;
  return { gross, fee, toOwners, toPot: gross - fee - toOwners } satisfies VaultShare;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <tr className="border-t border-white/10">
      <td className="py-1 pr-4 text-white/70">
        {label}
        {hint && <span className="block text-xs text-white/40">{hint}</span>}
      </td>
      <td className="py-1 text-right font-mono">{value}</td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}


export function EconomyPanel() {
  const inputs = useEconomyData();
  if (!featureReady('economy')) return <p className="text-sm text-white/60">Economy details are not available yet.</p>;
  if (!inputs.data) return <p className="text-sm text-white/60">Loading…</p>;
  const data = inputs.data;
  const { tvlA, tvlB, cfgA, cfgB, funding, potNow } = data;
  const rate = (index: number) => data.rates[index] ?? 0n;
  const waiting = (index: number) => data.waiting[index] ?? 0n;
  const seconds = data.seconds ?? WEEK;
  const a = seasonYield(tvlA, rate(0), seconds, BigInt(cfgA.feeBps), BigInt(cfgA.ownerShareBps));
  const b = seasonYield(tvlB, rate(1), seconds, BigInt(cfgB.feeBps), BigInt(cfgB.ownerShareBps));
  const pot = a.toPot + b.toPot;
  const fighterPool = pot * BigInt(POT_SPLIT.fighterBps) / BPS;
  const backerPool = pot - fighterPool;
  const fighters = data.fighterCount;
  const backers = data.backerCount;
  const each = (total: bigint, count: number | undefined) => count ? usd(total / BigInt(count)) : '-';
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
  return (
    <div className="space-y-6">
      <Section title="Vaults">
        <Row
          label="Vault A (Fighters), deposited"
          value={usd(tvlA)}
          hint={`min ${usd(cfgA.minDeposit)}`}
        />
        <Row
          label="Vault B (Backers), deposited"
          value={usd(tvlB)}
          hint={`min ${usd(cfgB.minDeposit)}`}
        />
        <Row label="Total deposited" value={usd(tvlA + tvlB)} />
        <Row
          label="Fighters"
          value={fighters === undefined ? '-' : String(fighters)}
          hint="wallets in Vault A"
        />
        <Row
          label="Backers"
          value={backers === undefined ? '-' : String(backers)}
          hint="wallets in Vault B"
        />
      </Section>

      <Section title="Yield now">
        <Row label="Earned in Vault A, not harvested yet" value={usd(waiting(0))} />
        <Row label="Earned in Vault B, not harvested yet" value={usd(waiting(1))} />
        <Row
          label={`Prize pot, season ${funding}`}
          value={potNow === undefined ? '-' : usd(potNow)}
          hint="already harvested into the pot"
        />
        <Row
          label="Yield rate (APY)"
          value={`${Number(rate(0)) / 100}% / ${Number(rate(1)) / 100}%`}
          hint="Vault A / Vault B, with the demo time multiplier"
        />
      </Section>

      <Section title={`Estimate for one season (${Number(seconds) / 3600} h) at today's deposits`}>
        <Row label="Gross yield" value={usd(a.gross + b.gross)} />
        <Row
          label={`Fee to treasury (A ${pct(cfgA.feeBps)}, B ${pct(cfgB.feeBps)})`}
          value={usd(a.fee + b.fee)}
        />
        <Row
          label="Paid back to Backers as yield"
          value={usd(b.toOwners)}
          hint={`${pct(cfgB.ownerShareBps)} of Vault B yield after fee`}
        />
        <Row label="Prize pot" value={usd(pot)} />
        <Row
          label={`Fighter pool (${pct(POT_SPLIT.fighterBps)})`}
          value={usd(fighterPool)}
          hint="paid by rank, top fighters get the most"
        />
        <Row
          label={`Backer bonus pool (${pct(POT_SPLIT.backerBps)})`}
          value={usd(backerPool)}
          hint="by prize of the picked fighter and the backer's time-weighted deposit"
        />
      </Section>

      <Section title="Average per person">
        <Row
          label="Per Fighter, from the pool"
          value={each(fighterPool, fighters)}
          hint="average only; the real prize depends on rank"
        />
        <Row
          label="Per Backer, yield + bonus"
          value={each(b.toOwners + backerPool, backers)}
          hint="average only; the bonus depends on the pick and the deposit time"
        />
      </Section>
    </div>
  );
}
