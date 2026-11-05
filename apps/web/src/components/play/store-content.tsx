import CharacterCollection from './character-collection';
import './store.css';

export default function StoreContent() {
  return (
    <section className="armory" aria-label="Character store">
      <header className="armory-header">
        <div>
          <p>HAIRTO ARENA / CHARACTER STORE</p>
          <h1>
            THE ARMORY<span>✦</span>
          </h1>
        </div>
        <span className="armory-header-tag">FIND YOUR SIGNATURE</span>
      </header>
      <CharacterCollection />
    </section>
  );
}
