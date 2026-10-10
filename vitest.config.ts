import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/frontend/**/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      '@warehouse/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url)
        .pathname,
    },
  },
});
