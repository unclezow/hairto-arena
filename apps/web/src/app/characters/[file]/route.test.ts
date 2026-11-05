import { describe, expect, it } from 'vitest';
import { GET } from './route';

const request = new Request('http://localhost/characters/1.json');
const get = (file: string) => GET(request, { params: Promise.resolve({ file }) });

describe('character metadata', () => {
  it('serves the shared catalog model for NEAR character references', async () => {
    const response = await get('1.json');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'Mage', image: '/arena/characters/Mage.glb', properties: { model: '/arena/characters/Mage.glb' } });
  });

  it('rejects unknown ids and non-catalog file names', async () => {
    for (const file of ['99.json', '-1.json', '1.5.json', '1', '01.json', '9007199254740992.json', `${'0'.repeat(63)}1.json`]) {
      expect((await get(file)).status).toBe(404);
    }
  });
});
