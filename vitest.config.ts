import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // These files only forward process arguments into the tested API.
        'src/entry.ts',
        'src/bin.ts',
      ],
      reporter: ['text-summary'],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 80,
        lines: 70,
      },
    },
  },
});
