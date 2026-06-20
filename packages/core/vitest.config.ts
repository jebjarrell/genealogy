import { defineConfig } from 'vitest/config';

// The core suite runs in a Node environment — this is the proof of the
// portability constraint (TRD §3, §11): the same pure logic that runs in the
// browser passes its tests under Node with no DOM available.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
  },
});
