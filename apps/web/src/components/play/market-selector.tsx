'use client';

import type { MarketView } from '@hairto-arena/shared';
import './bot-selector.css';

const CLOSED_REASON = {
  session: 'Outside trading hours.',
  disabled: 'This market is disabled.',
  stale: 'Waiting for a fresh price.',
};

export function MarketSelector({
  items,
  value,
  onChange,
  disabled,
  loading,
  error,
  onRetry,
}: {
  items: MarketView[];
  value: MarketView | null;
  onChange: (assetId: number) => void;
  disabled: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const index = items.findIndex((market) => market.assetId === value?.assetId);
  const select = (next: number) => {
    const market = items[next];
    if (market) onChange(market.assetId);
  };
  return (
    <fieldset className="hub-bot-selector hub-market-selector" disabled={disabled}>
      <legend>CHOOSE YOUR ASSET</legend>
      <div className="hub-bot-carousel" role="group" aria-label="Trading asset">
        <button
          className="hub-bot-arrow"
          type="button"
          aria-label="Previous asset"
          disabled={disabled || items.length === 0}
          onClick={() => select(index <= 0 ? items.length - 1 : index - 1)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m15 5-7 7 7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="hub-bot-identity" aria-live="polite" aria-atomic="true">
          <strong>{loading ? 'Loading…' : (value?.symbol ?? 'Select asset')}</strong>
          <span className="hub-market-status" data-open={value?.open}>
            {value ? (value.open ? 'MARKET OPEN' : 'MARKET CLOSED') : 'TRADING MARKET'}
          </span>
        </div>
        <button
          className="hub-bot-arrow"
          type="button"
          aria-label="Next asset"
          disabled={disabled || items.length === 0}
          onClick={() => select(index < 0 || index === items.length - 1 ? 0 : index + 1)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m9 5 7 7-7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {error ? (
        <div className="hub-market-error" role="alert">
          <p>Could not update available assets.</p>
          <button type="button" onClick={onRetry}>
            TRY AGAIN ↻
          </button>
        </div>
      ) : (
        <p>
          {loading
            ? 'Fetching available markets…'
            : value?.open
              ? 'Available for your next duel.'
              : value?.closedReason
                ? CLOSED_REASON[value.closedReason]
                : items.length === 0
                  ? 'No assets are available right now.'
                  : 'Choose an open market to battle.'}
        </p>
      )}
    </fieldset>
  );
}
