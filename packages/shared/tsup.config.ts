import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Never wipe dist/ in watch mode: the API and worker compile against index.d.ts while `pnpm dev` starts, and a
  // clean leaves them a window with index.js but no types yet (TS7016 on every import).
  clean: !options.watch,
  target: 'es2023',
}));
