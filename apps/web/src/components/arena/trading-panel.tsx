'use client';

import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { DAMAGE_SCALE, hpPerBpsOf } from '@hairto-arena/shared';
import { ATTACKS, attackKindFor, damageForBps } from './arena-combat';
import './trading-panel.css';
import { useChartTransition } from './use-chart-transition';

const BASE_PRICE = 2384.72;
const NOTIONAL = 250;
const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
type Side = 'long' | 'short';
type Position = { side: Side; entry: number };
type Candle = { open: number; close: number; high: number; low: number };

/**
 * A live duel's inputs (NEAR frontend port). Same slots as the demo, PRD meanings: PnL in bps, HP lead, trades
 * left and seconds left. Without it the panel runs its demo feed.
 */
export interface LivePanel {
  price: number | null;
  /** Display quotes, oldest first. */
  series: number[];
  symbol: string;
  feed: string;
  timeLabel: string;
  side: Side | null;
  entry?: number;
  pnlBps: number | null;
  /** Market id, for its damage scale (HP per bp). */
  assetId: number;
  tradesLeft: number;
  secondsLeft: number;
  holdLeft: number;
  canOpen: boolean;
  canClose: boolean;
  onSide: (side: Side) => void;
  message: string;
  /** Shown in place of the hint when set: phase, a pending transaction or why the last one failed. */
  status: string | null;
}

/** Keep fewer quote steps visible so each real-price candle remains easy to read. */
function seriesCandles(series: number[]): Candle[] {
  const points = series.filter((value) => Number.isFinite(value) && value > 0).slice(-17);
  return points.slice(1).map((close, index) => {
    const open = points[index]!;
    return { open, close, high: Math.max(open, close), low: Math.min(open, close) };
  });
}

function TradingChart({
  price,
  entry,
  side,
  pnlBps,
  series,
  symbol = 'XAU',
  feed = 'DEMO FEED',
  timeLabel = '12:00:24',
}: {
  price: number;
  entry?: number;
  side?: Side;
  pnlBps?: number | null;
  series?: number[];
  symbol?: string;
  feed?: string;
  timeLabel?: string;
}) {
  const id = useId().replaceAll(':', '');
  const [hover, setHover] = useState<number | null>(null);
  const [heldRange, setHeldRange] = useState<{ key: string; low: number; high: number } | null>(
    null,
  );
  const isLive = series !== undefined;
  const candles = useMemo(
    () =>
      isLive
        ? seriesCandles(series)
        : Array.from({ length: 16 }, (_, index) => {
            const open = BASE_PRICE - 5 + index * 0.31 + Math.sin(index * 0.83) * 0.8;
            const close = index === 15 ? price : open + Math.sin(index * 2.14 + 0.8) * 0.7 + 0.18;
            return {
              open,
              close,
              high: Math.max(open, close) + 0.28,
              low: Math.min(open, close) - 0.25,
            };
          }),
    [isLive, series, price],
  );
  const hasPrice = Number.isFinite(price) && price > 0;
  const active = entry !== undefined && entry > 0 && !!side && hasPrice;
  const values = candles.flatMap((candle) => [candle.high, candle.low]);
  if (hasPrice) values.push(price);
  if (active) values.push(entry);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(max - min, (hasPrice ? price : 1) * 0.00015);
  const rangeLow = min - span * 0.25;
  const rangeHigh = max + span * 0.25;
  const positionKey = active ? `${symbol}:${side}:${entry}` : null;
  const nextHeld = ((previous: typeof heldRange): typeof heldRange => {
    if (!positionKey) return previous === null ? previous : null;
    if (!previous || previous.key !== positionKey)
      return { key: positionKey, low: rangeLow, high: rangeHigh };
    // Preserve entry framing; only grow when real prices approach the edge.
    const margin = (previous.high - previous.low) * 0.06;
    if (price >= previous.low + margin && price <= previous.high - margin) return previous;
    const extra = (previous.high - previous.low) * 0.2;
    return {
      key: positionKey,
      low: Math.min(previous.low, price - extra),
      high: Math.max(previous.high, price + extra),
    };
  })(heldRange);
  if (nextHeld !== heldRange) setHeldRange(nextHeld);
  const locked = positionKey && heldRange?.key === positionKey ? heldRange : null;
  const frame = useChartTransition(
    { price, low: locked?.low ?? rangeLow, high: locked?.high ?? rangeHigh },
    symbol,
  );
  const { low, high } = frame;
  const displayPrice = hasPrice && frame.price > 0 ? frame.price : price;
  const renderedCandles = candles.map((candle, index) =>
    index === candles.length - 1
      ? {
          ...candle,
          close: displayPrice,
          high: Math.max(candle.open, displayPrice),
          low: Math.min(candle.open, displayPrice),
        }
      : candle,
  );
  const y = (value: number) =>
    Math.max(48, Math.min(222, 222 - ((value - low) / (high - low)) * 174));
  const x = (index: number) => 30 + index * 34;
  const last = candles.length - 1;
  const currentY = y(displayPrice);
  const entryY = active ? y(entry) : currentY;
  const bps = active
    ? pnlBps != null
      ? pnlBps + ((displayPrice - price) / entry) * (side === 'long' ? 1 : -1) * 10_000
      : ((displayPrice - entry) / entry) * (side === 'long' ? 1 : -1) * 10_000
    : 0;
  const tone = active ? (bps > 0 ? 'profit' : bps < 0 ? 'loss' : 'neutral') : 'neutral';
  const priceLabel = (value: number) =>
    value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : value < 100 ? 4 : 2 });
  const currentLabelY = Math.max(56, Math.min(214, currentY));
  const pnlLabelY = Math.max(50, Math.min(194, currentY - 30));
  return (
    <div className="arena-market-chart" data-pnl={tone}>
      <div className="arena-chart-price-pill">
        <span className="arena-chart-coin" aria-hidden="true">
          ◇
        </span>
        <strong>{hasPrice ? `$${priceLabel(displayPrice)}` : 'Waiting for price…'}</strong>
        <span>{symbol}</span>
      </div>
      <span className="arena-chart-session">
        <i /> {feed} <b>LIVE</b>
      </span>
      <svg
        viewBox="0 0 760 260"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${symbol} candlestick chart${hasPrice ? `, price ${priceLabel(displayPrice)} dollars` : ', waiting for prices'}${active ? `, ${side} entry ${priceLabel(entry)}, ${bps >= 0 ? 'profit' : 'loss'} ${Math.abs(bps).toFixed(2)} basis points` : ''}`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHover(
            Math.max(
              0,
              Math.min(
                last,
                Math.round((((event.clientX - bounds.left) / bounds.width) * 760 - 30) / 34),
              ),
            ),
          );
        }}
      >
        <defs>
          <clipPath id={`${id}-plot`}>
            <rect x="8" y="45" width="656" height="182" />
          </clipPath>
          <linearGradient id={`${id}-pnl`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={tone === 'loss' ? '#ff826f' : '#8be6a0'} stopOpacity=".2" />
            <stop
              offset="1"
              stopColor={tone === 'loss' ? '#ff826f' : '#8be6a0'}
              stopOpacity=".04"
            />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((index) => {
          const value = low + ((high - low) * index) / 3;
          return (
            <g key={index}>
              <path d={`M8 ${y(value)}H664`} className="arena-chart-grid" />
              <text x="674" y={y(value) + 3} className="arena-chart-axis">
                {priceLabel(value)}
              </text>
            </g>
          );
        })}
        <path d="M664 44V229H8" className="arena-chart-boundary" />
        <g clipPath={`url(#${id}-plot)`}>
          {active && Math.abs(currentY - entryY) > 0.5 && (
            <rect
              x="8"
              y={Math.min(currentY, entryY)}
              width="656"
              height={Math.abs(currentY - entryY)}
              fill={`url(#${id}-pnl)`}
            />
          )}
          {renderedCandles.map((candle, index) => (
            <g
              key={index}
              className={candle.close >= candle.open ? 'arena-candle-up' : 'arena-candle-down'}
            >
              <path d={`M${x(index)} ${y(candle.high)}V${y(candle.low)}`} strokeWidth="1.5" />
              <rect
                x={x(index) - 10}
                y={Math.min(y(candle.open), y(candle.close))}
                width="20"
                height={Math.max(2.2, Math.abs(y(candle.open) - y(candle.close)))}
                rx="1"
                stroke="none"
              />
            </g>
          ))}
          {active && <path d={`M8 ${entryY}H664`} className="arena-chart-entry" />}
          {hasPrice && <path d={`M8 ${currentY}H664`} className="arena-chart-live-line" />}
        </g>
        {active && (
          <g
            className="arena-entry-badge"
            transform={`translate(14 ${Math.max(45, Math.min(203, entryY - 10))})`}
          >
            <rect width="192" height="21" rx="3" />
            <text x="9" y="14">
              {side.toUpperCase()} · ENTRY {priceLabel(entry)}
            </text>
          </g>
        )}
        {hasPrice && (
          <>
            {last >= 0 && (
              <circle cx={x(last)} cy={currentY} r="4" className="arena-chart-live-dot" />
            )}
            <g className="arena-current-badge" transform={`translate(667 ${currentLabelY - 10})`}>
              <rect width="91" height="21" rx="3" />
              <text x="45.5" y="14" textAnchor="middle">
                {priceLabel(displayPrice)}
              </text>
            </g>
          </>
        )}
        {active && (
          <g className="arena-chart-pnl-badge" transform={`translate(516 ${pnlLabelY})`}>
            <rect width="140" height="24" rx="4" />
            <text x="70" y="16" textAnchor="middle">
              {bps >= 0 ? '+' : '−'}
              {Math.abs(bps).toFixed(2)} bps
            </text>
          </g>
        )}
        <text x="12" y="249" className="arena-chart-axis">
          {active ? `${side.toUpperCase()} POSITION · ENTRY LOCKED` : '16 CANDLES · LIVE PRICE'}
        </text>
        <text x="657" y="249" textAnchor="end" className="arena-chart-axis">
          {timeLabel}
        </text>
        {hover !== null && candles[hover] && (
          <g clipPath={`url(#${id}-plot)`}>
            <path d={`M${x(hover)} 46V228`} className="arena-chart-crosshair" />
            <circle
              cx={x(hover)}
              cy={y(renderedCandles[hover]!.close)}
              r="4"
              fill="#f1e5bc"
              stroke="#183c2a"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

export function TradingPanel({
  enabled = true,
  live,
  preview,
}: {
  enabled?: boolean;
  live?: LivePanel;
  /** Shown before a duel exists, so the placeholder chart does not show another market's name and price. */
  preview?: { symbol?: string; price?: number; series: number[] };
}) {
  const gaugeId = useId().replaceAll(':', '');
  const [tick, setTick] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);
  const [score, setScore] = useState({ wins: 0, losses: 0 });
  const [message, setMessage] = useState('');
  const demoPrice = BASE_PRICE + Math.sin(tick * 0.71) * 0.62 + Math.sin(tick * 0.23) * 0.35;
  const price = live ? (live.price ?? 0) : (preview?.price ?? demoPrice);
  const change = position
    ? ((price - position.entry) / position.entry) * (position.side === 'long' ? 1 : -1)
    : 0;
  const multiplier = position ? Math.max(0, 1 + change * 100) : 0;
  const pnl = change * NOTIONAL * 20;
  useEffect(() => {
    if (!enabled || live) return;
    const timer = setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, 1500);
    return () => clearInterval(timer);
  }, [enabled, live]);
  const chooseDemoSide = useCallback(
    (side: Side) => {
      if (!enabled) return;
      if (position) {
        if (position.side !== side) return;
        const won = pnl >= 0;
        setScore((s) => ({ ...s, [won ? 'wins' : 'losses']: s[won ? 'wins' : 'losses'] + 1 }));
        setPosition(null);
        setMessage(
          `Demo ${side} closed. ${won ? 'Gain' : 'Loss'} $${money.format(Math.abs(pnl))}.`,
        );
      } else {
        setPosition({ side, entry: price });
        setMessage(`Demo ${side} opened at $${money.format(price)} with $250 paper size.`);
      }
    },
    [enabled, position, pnl, price],
  );
  const onLiveSide = live?.onSide;
  const chooseSide = useCallback(
    (side: Side) => {
      if (!enabled) return;
      if (onLiveSide) onLiveSide(side);
      else chooseDemoSide(side);
    },
    [enabled, onLiveSide, chooseDemoSide],
  );
  const liveDamage = live?.pnlBps == null ? 0 : damageForBps(live.pnlBps, live.assetId);
  const liveScale = live ? hpPerBpsOf(live.assetId) : 0;
  // What the console shows: the demo, or the live duel in the same slots.
  const shown = live
    ? {
        position: live.side ? { side: live.side, entry: live.entry ?? price } : null,
        profit: (live.pnlBps ?? 0) >= 0,
        value:
          live.pnlBps === null
            ? '— — —'
            : `${live.pnlBps >= 0 ? '+' : '−'}${Math.abs(live.pnlBps).toFixed(2)} bps`,
        hasValue: live.pnlBps !== null,
        // The attack this position would land if closed now: bigger PnL, bigger hit (ultimate at 100 HP).
        big: String(liveDamage),
        bigUnit: 'DMG',
        // Each half starts at zero in the center; magnitude fills one half up to the per-hit cap.
        gauge: Math.min(
          100,
          ((Math.abs(live.pnlBps ?? 0) * liveScale) / DAMAGE_SCALE.maxHitHp) * 100,
        ),
        meter: {
          now: (live.pnlBps ?? 0) < 0 ? -liveDamage : liveDamage,
          text: `${liveDamage} damage, ${ATTACKS[attackKindFor(liveDamage)].label}, hits ${(live.pnlBps ?? 0) >= 0 ? 'the bot' : 'you'}`,
        },
        hint: live.status
          ? live.status
          : live.side
            ? live.canClose
              ? `${(live.pnlBps ?? 0) >= 0 ? 'HITS BOT' : 'HITS YOU'} · ${ATTACKS[attackKindFor(liveDamage)].label.toUpperCase()}`
              : `HOLD ${Math.ceil(live.holdLeft)}s`
            : `×${liveScale} HP PER BP · CHOOSE`,
        left: { value: live.tradesLeft, unit: 'TRADES', label: `${live.tradesLeft} trades left` },
        right: { value: live.secondsLeft, unit: 'SEC', label: `${live.secondsLeft} seconds left` },
        message: live.message,
      }
    : {
        position,
        profit: pnl >= 0,
        value: position ? `${pnl >= 0 ? '+' : '−'}$${money.format(Math.abs(pnl))}` : '— — —',
        hasValue: !!position,
        // While a duel is being created from the lobby the panel already speaks the duel's units.
        big: preview?.symbol ? '0' : multiplier.toFixed(1),
        bigUnit: preview?.symbol ? 'DMG' : 'x',
        gauge: position ? Math.min(100, Math.abs(change) * 5000) : 0,
        meter: {
          now: Math.max(-2, Math.min(2, change * 100)),
          text: `${change < 0 ? 'Loss' : 'Profit'} ${money.format(Math.abs(pnl))} dollars`,
        },
        hint: position ? 'TAP AGAIN TO CLOSE' : 'CHOOSE YOUR DIRECTION',
        left: { value: score.losses, unit: '↘ L', label: `${score.losses} demo losses` },
        right: { value: score.wins, unit: '↗ W', label: `${score.wins} demo wins` },
        message,
      };
  const view = shown.position;
  const gaugeActive = !!view && shown.hasValue && shown.gauge > 0;
  const gaugeTier = !gaugeActive
    ? 'neutral'
    : shown.gauge >= 62.5
      ? 'high'
      : shown.gauge >= 25
        ? 'medium'
        : 'low';
  const gaugeTone = gaugeActive ? (shown.profit ? 'profit' : 'loss') : 'neutral';
  // With a position open both buttons only close it; Long / Short return once it is closed.
  const pressSide = useCallback(
    (side: Side) => chooseSide(view ? view.side : side),
    [chooseSide, view],
  );
  const sideDisabled = () => !enabled || (!!live && (view ? !live.canClose : !live.canOpen));
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('dialog[open]')
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'l' || key === 's') {
        event.preventDefault();
        pressSide(key === 'l' ? 'long' : 'short');
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [pressSide]);
  return (
    <section
      className="arena-trading-panel"
      aria-label={live ? 'Trading arena' : 'Trading arena demo'}
      data-disabled={!enabled}
    >
      <i className="arena-panel-rivet rivet-tl" aria-hidden="true" />
      <i className="arena-panel-rivet rivet-tr" aria-hidden="true" />
      <i className="arena-panel-rivet rivet-bl" aria-hidden="true" />
      <i className="arena-panel-rivet rivet-br" aria-hidden="true" />
      <div className="arena-trading-inner">
        <div className="arena-market-pane">
          <TradingChart
            price={price}
            entry={view?.entry}
            side={view?.side}
            pnlBps={live?.pnlBps}
            series={live?.series ?? (preview && preview.series.length > 1 ? preview.series : undefined)}
            symbol={live?.symbol ?? preview?.symbol}
            feed={live?.feed}
            timeLabel={live?.timeLabel}
          />
        </div>
        <div className={`arena-trade-console ${view ? `has-position is-${view.side}` : ''}`}>
          <div className="arena-trade-scoreboard">
            <div className="arena-round-score arena-loss-score" aria-label={shown.left.label}>
              <strong>{shown.left.value}</strong>
              <span>{shown.left.unit}</span>
            </div>
            <span className="arena-round-label">
              {view ? (
                <>
                  <i />
                  {view.side.toUpperCase()} OPEN
                </>
              ) : (
                'PAPER DUEL'
              )}
            </span>
            {live ? (
              // The countdown lives between the two health bars in a live duel.
              <span aria-hidden="true" />
            ) : (
              <div className="arena-round-score arena-win-score" aria-label={shown.right.label}>
                <strong>{shown.right.value}</strong>
                <span>{shown.right.unit}</span>
              </div>
            )}
          </div>
          <div
            className="arena-multiplier"
            data-power={gaugeTier}
            data-tone={gaugeTone}
            style={{ '--gauge-power': gaugeActive ? shown.gauge / 100 : 0 } as CSSProperties}
            role="meter"
            aria-label={
              live ? 'Projected trade profit or loss damage' : 'Demo trade profit or loss'
            }
            aria-valuemin={live ? -DAMAGE_SCALE.maxHitHp : -2}
            aria-valuemax={live ? DAMAGE_SCALE.maxHitHp : 2}
            aria-valuenow={shown.meter.now}
            aria-valuetext={shown.meter.text}
          >
            {gaugeTier === 'high' && (
              <span key={gaugeTone} className="arena-gauge-surge" aria-hidden="true" />
            )}
            <svg viewBox="0 0 300 168" aria-hidden="true">
              <defs>
                <mask
                  id={`${gaugeId}-energy-mask`}
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width="300"
                  height="168"
                >
                  <path
                    d={
                      shown.profit
                        ? 'M150 18A128 128 0 0 0 22 146'
                        : 'M150 18A128 128 0 0 1 278 146'
                    }
                    fill="none"
                    stroke="white"
                    strokeWidth="15"
                    strokeLinecap="round"
                    pathLength="100"
                    strokeDasharray={`${gaugeActive ? shown.gauge : 0} 100`}
                  />
                </mask>
              </defs>
              <path d="M22 146A128 128 0 0 1 278 146" className="arena-gauge-track" />
              <path
                d="M150 18A128 128 0 0 0 22 146"
                pathLength="100"
                className="arena-gauge-fill is-positive"
                strokeDasharray={`${shown.profit ? shown.gauge : 0} 100`}
                data-visible={!!view && shown.hasValue && shown.profit && shown.gauge > 0}
              />
              <path
                d="M150 18A128 128 0 0 1 278 146"
                pathLength="100"
                className="arena-gauge-fill is-negative"
                strokeDasharray={`${!shown.profit ? shown.gauge : 0} 100`}
                data-visible={!!view && shown.hasValue && !shown.profit && shown.gauge > 0}
              />
              {gaugeActive && gaugeTier === 'high' && (
                <g mask={`url(#${gaugeId}-energy-mask)`}>
                  <path
                    d={
                      shown.profit
                        ? 'M150 18A128 128 0 0 0 22 146'
                        : 'M150 18A128 128 0 0 1 278 146'
                    }
                    pathLength="100"
                    className="arena-gauge-energy"
                    strokeDasharray="9 40"
                  />
                </g>
              )}
              <path d="M150 13v8M19 155h8m246 0h8" className="arena-gauge-ticks" />
            </svg>
            <div className="arena-multiplier-value">
              <span className={shown.hasValue ? (shown.profit ? 'is-profit' : 'is-loss') : ''}>
                {shown.value}
              </span>
              <strong>
                {shown.big}
                <span>{shown.bigUnit}</span>
              </strong>
              <small>{shown.hint}</small>
            </div>
          </div>
          <div className="arena-direction-buttons" data-open={!!view}>
            {view ? (
              <button
                type="button"
                className="arena-close-button"
                aria-label={`Close${live ? '' : ' demo'} ${view.side}`}
                disabled={sideDisabled()}
                onClick={() => pressSide(view.side)}
              >
                <strong>Close {view.side === 'long' ? 'Long' : 'Short'}</strong>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="arena-long-button"
                  aria-label={`Open${live ? '' : ' demo'} Long`}
                  disabled={sideDisabled()}
                  onClick={() => pressSide('long')}
                >
                  <span aria-hidden="true">▲</span>
                  <strong>Long</strong>
                  <kbd>L</kbd>
                </button>
                <button
                  type="button"
                  className="arena-short-button"
                  aria-label={`Open${live ? '' : ' demo'} Short`}
                  disabled={sideDisabled()}
                  onClick={() => pressSide('short')}
                >
                  <span aria-hidden="true">▼</span>
                  <strong>Short</strong>
                  <kbd>S</kbd>
                </button>
              </>
            )}
          </div>
          <span className="sr-only" role="status">
            {shown.message}
          </span>
        </div>
      </div>
    </section>
  );
}
