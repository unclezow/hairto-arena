import { expect, test, type Page } from '@playwright/test';

const accountId = 'player.testnet';
async function mockWalletAndApi(page: Page, role: 'none' | 'fighter' | 'backer' = 'none', options: { near?: string; decline?: boolean; prompted?: boolean } = {}) {
  let near = options.near ?? '100000000000000000000000';
  await page.addInitScript(({ accountId, decline, prompted }) => {
    let connected = false;
    if (prompted) localStorage.setItem(`hairto:quick-play-prompt:testnet:${accountId}`, 'seen');
    const wallet = {
      manifest: { id: 'test-wallet', type: 'injected', name: 'Test NEAR Wallet', icon: '/play/currencies/near-token.png', description: 'Mocked NEAR wallet', website: location.origin, executor: '', version: '1.0.0', platform: ['web'], permissions: {}, features: { testnet: true, signMessage: true, signAndSendTransaction: true, signAndSendTransactions: true } },
      signIn: async () => { connected = true; return [{ accountId }]; },
      signOut: async () => { connected = false; },
      getAccounts: async () => connected ? [{ accountId }] : [],
      signMessage: async () => {
        if (decline) throw new Error('User rejected signature');
        return { accountId, publicKey: 'ed25519:test', signature: 'mock-signature' };
      },
      signAndSendTransaction: async (transaction: { actions: { type: string; params: { publicKey?: string; accessKey?: { permission: unknown } } }[] }) => {
        for (const action of transaction.actions) {
          if (action.type === 'AddKey') localStorage.setItem('e2e:access-key', JSON.stringify(action.params));
          if (action.type === 'DeleteKey') localStorage.removeItem('e2e:access-key');
        }
        return { status: { SuccessValue: '' }, transaction: { hash: 'test-transaction' } };
      },
    };
    window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet })));
  }, { accountId, decline: options.decline ?? false, prompted: options.prompted ?? false });
  const respond = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/config')) return route.fulfill(respond({ network: 'testnet', rpcUrl: 'https://rpc.example', explorerUrl: 'https://testnet.nearblocks.io', contracts: { arena: 'arena.testnet', vault: 'vault.testnet', usdc: 'usdc.testnet', characters: 'characters.testnet' } }));
    if (path.endsWith('/auth/nonce')) return route.fulfill(respond({ message: 'Sign in', recipient: 'localhost', nonce: Buffer.alloc(32, 7).toString('base64') }));
    if (path.endsWith('/auth/verify')) return route.fulfill(respond({ token: 'mock-session', accountId, role }));
    if (path.endsWith('/me/status')) return route.fulfill(respond({ role }));
    if (path.endsWith('/me/daily')) return route.fulfill(respond({ played: 0 }));
    if (path.endsWith('/leaderboard/me')) return route.fulfill(respond({ rank: null, points: 0, duels: 0 }));
    if (path.includes('/wallets/')) return route.fulfill(respond({ owned: [0], equipped: 0 }));
    if (path.endsWith('/markets')) return route.fulfill(respond({ items: [{ assetId: 2, symbol: 'BTC', open: true, closedReason: null }] }));
    return route.fulfill(respond({ items: [] }));
  });
  await page.route('https://raw.githubusercontent.com/hot-dao/near-selector/**', (route) => route.fulfill(respond({ version: '1.0.0', wallets: [] })));
  await page.route('https://rpc.example/**', async (route) => {
    const request = route.request().postDataJSON();
    const meta = { block_height: 1, block_hash: '11111111111111111111111111111111' };
    if (request.params.request_type === 'view_account') return route.fulfill(respond({ jsonrpc: '2.0', id: request.id, result: { ...meta, amount: near, locked: '0', storage_usage: 0, code_hash: '11111111111111111111111111111111', storage_paid_at: 0 } }));
    if (request.params.request_type === 'view_access_key') {
      const stored = await page.evaluate(() => localStorage.getItem('e2e:access-key'));
      if (!stored) return route.fulfill(respond({ jsonrpc: '2.0', id: request.id, error: { name: 'HANDLER_ERROR', code: -32000, message: 'Access key does not exist', data: 'Access key does not exist', cause: { name: 'UNKNOWN_ACCESS_KEY', info: { account_id: accountId, public_key: request.params.public_key } } } }));
      const { accessKey } = JSON.parse(stored);
      const key = accessKey.permission;
      return route.fulfill(respond({ jsonrpc: '2.0', id: request.id, result: { ...meta, nonce: 1, permission: { FunctionCall: { receiver_id: key.receiverId, method_names: key.methodNames, allowance: key.allowance } } } }));
    }
    return route.fulfill(respond({ jsonrpc: '2.0', id: request.id, result: { ...meta, logs: [], result: Array.from(Buffer.from(JSON.stringify('1000000000'))) } }));
  });
  return { fund: (amount = '100000000000000000000000') => { near = amount; } };
}

async function connect(page: Page) {
  await page.getByRole('dialog', { name: 'CONNECT WALLET' }).getByRole('button', { name: 'CONNECT', exact: true }).click();
  await page.getByText('Test NEAR Wallet', { exact: true }).click();
}

test('landing preserves its pitch and How to Play dialog', async ({ page }) => {
  await mockWalletAndApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Trade.');
  await expect(page.getByText('NEAR TESTNET', { exact: true })).toBeVisible();
  await expect(page.getByText('No-loss principal')).toBeVisible();
  await page.getByRole('button', { name: 'HOW TO PLAY' }).click();
  await expect(page.getByRole('dialog', { name: 'How to Play' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('BATTLE remains hidden until API sign-in', async ({ page }) => {
  await mockWalletAndApi(page);
  await page.goto('/play/lobby');
  await expect(page.getByText('BATTLE', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'CONNECT WALLET' })).toBeVisible();
});

test('new accounts fund first, then choose a role and skip quick play', async ({ page }, testInfo) => {
  const rpc = await mockWalletAndApi(page, 'none', { near: '49999999999999999999999' });
  await page.goto('/play/lobby?connect=1');
  await connect(page);
  await expect(page.getByRole('dialog', { name: 'FUND YOUR ACCOUNT' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GET TESTNET NEAR' })).toHaveAttribute('href', 'https://near-faucet.io');
  await page.screenshot({ path: `/tmp/near-fund-${testInfo.project.name}.png`, fullPage: true });
  rpc.fund();
  await expect(page.getByRole('dialog', { name: 'CHOOSE YOUR ROLE' })).toBeVisible({ timeout: 12_000 });
  await page.getByRole('button', { name: /FIGHTER.*DEPOSIT/ }).click();
  await page.getByRole('button', { name: 'ENTER LOBBY' }).click();
  await expect(page.getByRole('heading', { name: 'ENABLE QUICK PLAY' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('BATTLE', { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/near-lobby-${testInfo.project.name}.png`, fullPage: true });
});

test('finished steps support back-navigation and wallet switching', async ({ page }) => {
  await mockWalletAndApi(page);
  await page.goto('/play/lobby?connect=1');
  await connect(page);
  await expect(page.getByRole('dialog', { name: 'CHOOSE YOUR ROLE' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to step 1: Connect' }).click();
  await expect(page.getByRole('dialog', { name: 'WALLET CONNECTED' })).toBeVisible();
  await page.getByRole('button', { name: 'NEXT', exact: true }).click();
  await page.getByRole('button', { name: 'Use a different wallet' }).click();
  await expect(page.getByText('Test NEAR Wallet', { exact: true })).toBeVisible();
  await expect(page.getByText('BATTLE', { exact: true })).toHaveCount(0);
});

test('returning funded Fighters skip Role after sign-in', async ({ page }) => {
  await mockWalletAndApi(page, 'fighter', { prompted: true });
  await page.goto('/play/lobby?connect=1');
  await connect(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Copy NEAR account ID ${accountId}` })).toBeVisible();
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Season leaderboard' })).toBeVisible();
});

test('declined signatures show a readable retry action', async ({ page }) => {
  await mockWalletAndApi(page, 'none', { decline: true });
  await page.goto('/play/lobby?connect=1');
  await connect(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Signature declined' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TRY AGAIN', exact: true })).toBeVisible();
  await expect(page.getByText('BATTLE', { exact: true })).toHaveCount(0);
});

test('quick play can be enabled and removed through the mocked wallet', async ({ page }) => {
  await mockWalletAndApi(page, 'fighter');
  await page.goto('/play/lobby?connect=1');
  await connect(page);
  await page.getByRole('button', { name: 'ENABLE QUICK PLAY', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /USDC in game. Open balance details/ }).click();
  await page.getByRole('button', { name: 'Remove quick play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable quick play', exact: true })).toBeVisible();
});

test('a new Backer can change role selection and enter the fenced Backer page', async ({ page }) => {
  await mockWalletAndApi(page);
  await page.goto('/play/lobby?connect=1');
  await connect(page);
  await page.getByRole('button', { name: /FIGHTER.*DEPOSIT/ }).click();
  await page.getByRole('button', { name: 'Change role', exact: true }).click();
  await page.getByRole('button', { name: /BACKER.*DEPOSIT/ }).click();
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page).toHaveURL(/\/play\/backer$/);
  await expect(page.getByRole('heading', { name: 'Backer', exact: true })).toBeVisible();
  await expect(page.getByText('Backer actions are not available yet.')).toBeVisible();
  await expect(page.getByText('0.1 NEAR (gas) · 1,000 USDC (mock)', { exact: true })).toBeVisible();
});

test('direct live-arena links are fenced and do not request a duel ticket', async ({ page }) => {
  await mockWalletAndApi(page);
  const tickets: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/duels/ticket')) tickets.push(request.url()); });
  await page.goto('/arena?duel=1');
  const dialog = page.getByRole('alertdialog', { name: 'DUELS NOT AVAILABLE YET' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'TRY AGAIN' }).click();
  await expect(page).toHaveURL(/\/play\/lobby$/);
  expect(tickets).toEqual([]);
});

test('result pages preserve their layout with live result reads fenced', async ({ page }) => {
  await mockWalletAndApi(page);
  await page.goto('/duel/1/result');
  await expect(page.getByRole('heading', { name: 'DUELS NOT AVAILABLE YET', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'BACK TO LOBBY' })).toBeVisible();
});

test('direct leaderboard links preserve the lobby connection gate', async ({ page }) => {
  await mockWalletAndApi(page);
  await page.goto('/play/leaderboard');
  await expect(page).toHaveURL(/panel=leaderboard/);
  await expect(page.getByRole('dialog', { name: 'CONNECT WALLET' })).toBeVisible();
});

test('economy and admin controls are explicitly unavailable in the wallet baseline', async ({ page }) => {
  await mockWalletAndApi(page);
  await page.goto('/economy');
  await expect(page.getByText('Economy details are not available yet.')).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByText('Admin actions are not available yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start new season', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Harvest into the pot', exact: true })).toBeDisabled();
});
