import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['agent/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: 'evals',
          include: ['test/evals/**/*.eval.ts'],
          setupFiles: ['test/evals/setup.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
