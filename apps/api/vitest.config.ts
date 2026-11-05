import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    env: {
      LOG_LEVEL: 'fatal',
      ADMIN_ACCOUNTS: 'owner.hairto.testnet',
      RATE_LIMIT_READ_PER_WINDOW: '100000',
      RATE_LIMIT_WRITE_PER_WINDOW: '100000',
      RATE_LIMIT_AUTH_PER_WINDOW: '100000',
    },
    root: './',
    include: ['**/*.spec.ts'],
  },
});
