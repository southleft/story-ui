import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.test.ts'],
    environment: 'node',
    /**
     * Vitest's 5s default is too tight for the handful of tests that compile
     * TypeScript or run the whole generation pipeline. They pass in about
     * eight seconds on an idle machine and time out when the machine is busy —
     * which is exactly when the pre-commit hook runs them, so a green suite
     * became a red commit twice over with nothing wrong. A generous ceiling
     * still fails a genuine hang; it just stops reporting load as a defect.
     */
    testTimeout: 30_000,
  },
});
