'use client';

import { BOT_LEVELS, SCORE, type BotLevel } from '@hairto-arena/shared';
import { useId } from 'react';
import './bot-selector.css';

const STRATEGIES: Partial<Record<BotLevel, string>> = {
  1: 'An unpredictable rookie with a short-term trading style.',
  2: 'Follows momentum and holds through a clear trend.',
  3: 'Trades against stretched prices, looking for a reversal.',
  4: 'An AI that reads the price window and signs every decision.',
};

export function BotSelector({
  value,
  levels = [1, 2, 3],
  onChange,
  disabled,
}: {
  value: BotLevel;
  /** Active levels from the arena, ascending. */
  levels?: BotLevel[];
  onChange: (level: BotLevel) => void;
  disabled: boolean;
}) {
  const at = Math.max(0, levels.indexOf(value));
  const step = (delta: number) => levels[(at + delta + levels.length) % levels.length] ?? value;
  const id = useId();
  const points = SCORE.pointsByBotLevel[value];
  return (
    <fieldset className="hub-bot-selector" disabled={disabled}>
      <legend>CHOOSE YOUR OPPONENT</legend>
      <div
        className="hub-bot-carousel"
        role="group"
        aria-label="Bot opponent"
        aria-describedby={`${id}-description ${id}-points`}
      >
        <button
          className="hub-bot-arrow"
          type="button"
          aria-label="Previous bot"
          disabled={disabled}
          onClick={() => onChange(step(-1))}
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
          <strong>{BOT_LEVELS[value].name}</strong>
          <span>LEVEL {value}</span>
        </div>
        <button
          className="hub-bot-arrow"
          type="button"
          aria-label="Next bot"
          disabled={disabled}
          onClick={() => onChange(step(1))}
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
      <p id={`${id}-description`}>{STRATEGIES[value]}</p>
      <div className="hub-bot-points" id={`${id}-points`}>
        <span>
          WIN{' '}
          <strong>
            +{points.win[0]}–{points.win[1]}
          </strong>
        </span>
        <span>
          LOSS{' '}
          <strong>
            −{points.loss[0]}–{points.loss[1]}
          </strong>
        </span>
      </div>
    </fieldset>
  );
}
