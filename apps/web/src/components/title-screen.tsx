'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef } from 'react';
import { DUEL, POT_SPLIT, PRIZE_CURVE_BPS, SCORE, VAULTS } from '@hairto-arena/shared';
import './title-screen.css';

export function TitleScreen() {
  const guide = useRef<HTMLDialogElement>(null);

  return (
    <main className="entry-screen">
      <header className="entry-header">
        <span className="entry-wordmark">
          HAIRTO <span>ARENA</span>
        </span>
        <span className="entry-network">
          <i /> NEAR TESTNET
        </span>
      </header>
      <section className="entry-hero" aria-labelledby="title-heading">
        <div className="entry-art">
          <div className="entry-orbit" aria-hidden="true" />
          <Image
            src="/play/arenas/floating-grounds-diorama-v1.png"
            alt="Floating Grounds, a fantasy battle arena on a floating island"
            width={720}
            height={720}
            sizes="(max-width: 760px) 90vw, 48vw"
            priority
          />
          <span className="entry-artCaption">◆ FLOATING GROUNDS ◆</span>
        </div>
        <div className="entry-copy">
          <p className="entry-eyebrow">YOUR NEXT BATTLE IS ON THE CHART</p>
          <h1 id="title-heading">
            Trade.
            <br />
            Battle.
            <br />
            <span>Rise.</span>
          </h1>
          <p className="entry-description">
            Real market prices. {DUEL.roundDurationMs / 1000}-second paper duels. Challenge a bot and
            fight your way to the top of the season.
          </p>
          <div className="entry-actions">
            <Link className="entry-primary" href="/play/lobby">
              PLAY <span aria-hidden="true">↗</span>
            </Link>
            <button
              className="entry-secondary"
              type="button"
              onClick={() => guide.current?.showModal()}
            >
              HOW TO PLAY <span aria-hidden="true">?</span>
            </button>
          </div>
          <p className="entry-caption">EXPLORE THE LOBBY FIRST · CONNECT WHEN YOU’RE READY</p>
        </div>
      </section>
      <section className="entry-benefits" aria-label="What you play for">
        <article>
          <span className="entry-seal" aria-hidden="true">
            ◇
          </span>
          <div>
            <h2>No-loss principal</h2>
            <p>Your deposit is not wagered in duels. Withdraw your principal anytime.</p>
          </div>
        </article>
        <article>
          <Image src="/play/icons/leaderboard-trophy-v1.png" alt="" width={64} height={64} />
          <div>
            <h2>Top {PRIZE_CURVE_BPS.length} earn rewards</h2>
            <p>
              Play at least {SCORE.minDuelsForLeaderboard} counted duels, qualify, and climb the
              season ranking.
            </p>
          </div>
        </article>
        <article>
          <Image src="/play/icons/store-chest-v1.png" alt="" width={64} height={64} />
          <div>
            <h2>Powered by yield</h2>
            <p>Season rewards come from vault yield. Your principal never funds the prize pot.</p>
          </div>
        </article>
      </section>
      <footer className="entry-footer">
        <span>GOOGL · BTC · XAU</span>
        <span>TESTNET · PAPER TRADING · MOCK TOKENS & YIELD</span>
        <span>BUILT ON NEAR</span>
      </footer>
      <dialog
        ref={guide}
        className="entry-guide"
        aria-labelledby="guide-heading"
        onClick={(event) => {
          if (event.target === event.currentTarget) guide.current?.close();
        }}
      >
        <div className="entry-guideBody">
          <button
            type="button"
            className="entry-close"
            aria-label="Close How to Play"
            onClick={() => guide.current?.close()}
          >
            ×
          </button>
          <p className="entry-eyebrow">THE FIGHTER’S FIELD GUIDE</p>
          <h2 id="guide-heading">How to Play</h2>
          <p className="entry-guideIntro">
            Read the market. Pick your moment. Make every trade count.
          </p>
          <ol className="entry-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Prepare your fighter</h3>
                <p>
                  Connect with Google, email, or a NEAR wallet in the lobby. Claim test USDC, then deposit at
                  least {VAULTS.fighter.minDepositUsd} USDC into the Fighter pool. You also need testnet NEAR
                  for gas. One wallet holds one role: Fighter or Backer.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Battle the bot</h3>
                <p>
                  Press BATTLE for a {DUEL.roundDurationMs / 1000}-second paper duel on live market
                  prices. Open LONG if you expect a rise, SHORT if you expect a fall. Close after at
                  least {DUEL.minHoldMs / 1000} {DUEL.minHoldMs === 1000 ? 'second' : 'seconds'}: profit damages your opponent, a loss damages you.
                  Up to {DUEL.maxTradesPerDuel} trades per duel; positions stay hidden until
                  revealed.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Climb into the Top {PRIZE_CURVE_BPS.length}</h3>
                <p>
                  Complete at least {SCORE.minDuelsForLeaderboard} counted duels to qualify for the
                  leaderboard. There is no daily battle limit: every valid duel counts. Wins add
                  points and losses deduct points based on bot level and final HP difference. Draws
                  award 0 points; your season score never falls below 0. Finish in the Top{' '}
                  {PRIZE_CURVE_BPS.length} to earn your rank’s share of the Fighter prize pool.
                  Claim after season results are finalized.
                </p>
              </div>
            </li>
          </ol>
          <div className="entry-rewardNote">
            <strong>Where do rewards come from?</strong>
            <p>
              Vault yield funds the season pot: {POT_SPLIT.fighterBps / 100}% for Fighters,{' '}
              {POT_SPLIT.backerBps / 100}% for Backer bonuses. Reward amounts depend on the pot and
              your final rank; qualifying alone does not guarantee a prize.
            </p>
          </div>
          <p className="entry-disclosure">
            <strong>What “no loss” means:</strong> your principal is not used for trades or prizes
            and can be withdrawn anytime. Gas is spent separately. This demo uses testnet tokens and
            mock yield, with no real-money rewards. A future real vault would still carry
            smart-contract and asset risks.
          </p>
          <Link className="entry-primary" href="/play/lobby" onClick={() => guide.current?.close()}>
            ENTER LOBBY <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </dialog>
    </main>
  );
}
