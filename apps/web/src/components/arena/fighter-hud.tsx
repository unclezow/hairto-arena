import './fighter-hud.css';

export function FighterHud({
  number,
  name,
  role,
  team,
  hp,
  hit,
}: {
  number: string;
  name: string;
  role: string;
  team: 'blue' | 'orange';
  hp: number;
  hit: { id: number; damage: number } | null;
}) {
  const remaining = `${Math.max(0, Math.min(100, hp / 10))}%`;
  return (
    <div
      className={`arena-health-player arena-health-${team} ${hp <= 250 ? 'arena-health-critical' : ''} ${hit ? 'combat-hud-hit' : ''}`}
    >
      <div className="arena-health-name-row">
        <h2>{name}</h2>
        <span className="arena-health-player-tag">
          {role.startsWith('BOT') ? 'CPU' : `P${Number(number)}`}
        </span>
      </div>
      <div className="arena-health-frame">
        <div
          className="arena-health-track"
          role="progressbar"
          aria-label={`${name} HP`}
          aria-valuemin={0}
          aria-valuemax={1000}
          aria-valuenow={hp}
        >
          <span className="arena-health-damage" style={{ width: remaining }} />
          <span className="arena-health-fill" style={{ width: remaining }} />
          <span className="arena-health-shine" aria-hidden="true" />
        </div>
      </div>
      <div className="arena-health-details">
        <span>{role}</span>
        <span>
          <strong>{hp.toLocaleString('en-US')}</strong>
          <span className="arena-health-total"> / 1,000</span> HP
        </span>
      </div>
      {hit && (
        <span key={hit.id} className="combat-damage-number">
          −{hit.damage}
          <small>{hp === 0 ? 'K.O.' : 'DIRECT HIT'}</small>
        </span>
      )}
    </div>
  );
}
