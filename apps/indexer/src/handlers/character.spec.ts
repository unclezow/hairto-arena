import { beforeEach, describe, expect, it } from 'vitest';
import * as h from './index.js';
import { MemoryStore } from './memory-store.js';

const A = 'alice.testnet';
const B = 'bob.testnet';

let height = 500n;
let logIndex = 0;
const ev = <D>(data: D) => {
  height += 1n;
  logIndex += 1;
  return {
    data,
    block: { height, timestampMs: 1_000_000n + height },
    position: { logIndex },
    receiptId: `R${height}`,
    txHash: `T${height}`,
    executor: 'characters.hairto.testnet',
  };
};

describe('character handlers', () => {
  let store: MemoryStore;
  beforeEach(async () => {
    store = new MemoryStore();
    await h.onCharacterListed(
      ev({ token_id: '2', name: 'Knight', price: '5000000', max_supply: 10 }),
      store,
    );
  });

  it('lists and updates a character', async () => {
    await h.onCharacterUpdated(
      ev({ token_id: '2', name: 'Knight', price: '6000000', max_supply: 10, active: false }),
      store,
    );
    expect(store.get('character', { id: 2n })).toMatchObject({
      price: 6_000_000n,
      maxSupply: 10,
      minted: 0,
      active: false,
    });
  });

  it('moves character 2 from A to B: A ends with 0 and B with 1', async () => {
    await h.onMtMint(ev([{ owner_id: A, token_ids: ['2'], amounts: ['1'] }]), store);
    expect(store.get('characterBalance', { account: A, characterId: 2n })).toMatchObject({
      amount: 1n,
    });
    expect(store.get('character', { id: 2n })).toMatchObject({ minted: 1 });
    await h.onMtTransfer(
      ev([{ old_owner_id: A, new_owner_id: B, token_ids: ['2'], amounts: ['1'] }]),
      store,
    );
    expect(store.get('characterBalance', { account: A, characterId: 2n })).toMatchObject({
      amount: 0n,
    });
    expect(store.get('characterBalance', { account: B, characterId: 2n })).toMatchObject({
      amount: 1n,
    });
  });

  it('applies a log once even when it is processed again', async () => {
    const mint = ev([{ owner_id: A, token_ids: ['2'], amounts: ['1'] }]);
    await h.onMtMint(mint, store);
    await h.onMtMint(mint, store);
    expect(store.get('characterBalance', { account: A, characterId: 2n })).toMatchObject({
      amount: 1n,
    });
    expect(store.get('character', { id: 2n })).toMatchObject({ minted: 1 });
  });

  it('records purchases and grants, and the equip history', async () => {
    await h.onCharacterPurchased(ev({ buyer: A, token_id: '2', price: '5000000' }), store);
    await h.onCharacterGranted(ev({ to: B, token_id: '2' }), store);
    expect(store.all('characterPurchase').map((p) => [p.kind, p.account, p.price])).toEqual([
      ['purchase', A, 5_000_000n],
      ['grant', B, 0n],
    ]);
    await h.onCharacterEquipped(ev({ account_id: A, token_id: '2' }), store);
    await h.onCharacterEquipped(ev({ account_id: A, token_id: '0' }), store);
    expect(store.get('characterEquipped', { account: A })).toMatchObject({ characterId: 0n });
    expect(store.all('characterEquipEvent')).toHaveLength(2);
  });
});
