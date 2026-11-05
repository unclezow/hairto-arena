import { Dir } from '@hairto-arena/shared';
import hashes from '../../../../contracts/arena/tests/vectors/hashes.json' with { type: 'json' };
import { positionCommit, positionSalt } from './position-commit.js';

const player = 'rookie.bots.hairto.testnet';
const seed = 'ab'.repeat(32);
const salt = 'cd'.repeat(32);

describe('positionCommit', () => {
  it('matches the arena commit vectors', () => {
    for (const v of hashes.commits) {
      const dir = v.dir === 1 ? Dir.Long : Dir.Short;
      const expected = Buffer.from(v.commit, 'hex').toString('base64');
      expect(positionCommit(dir, v.salt, BigInt(v.duel_id), v.player)).toBe(expected);
    }
  });

  it('changes with every input', () => {
    const base = positionCommit(Dir.Long, salt, 7n, player);
    expect(positionCommit(Dir.Short, salt, 7n, player)).not.toBe(base);
    expect(positionCommit(Dir.Long, 'ce'.repeat(32), 7n, player)).not.toBe(base);
    expect(positionCommit(Dir.Long, salt, 8n, player)).not.toBe(base);
    expect(positionCommit(Dir.Long, salt, 7n, 'trend.bots.hairto.testnet')).not.toBe(base);
  });
});

describe('positionSalt', () => {
  it('is reproducible from the seed and differs per trade', () => {
    expect(positionSalt(seed, 0)).toMatch(/^[0-9a-f]{64}$/);
    expect(positionSalt(seed, 0)).toBe(positionSalt(seed, 0));
    expect(positionSalt(seed, 0)).not.toBe(positionSalt(seed, 1));
    expect(positionSalt(seed, 0)).not.toBe(positionSalt('ac'.repeat(32), 0));
  });
});
