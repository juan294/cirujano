export default {
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    reporters: ['default', 'json'],
    outputFile: { json: 'raw-tests.json' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.mjs'],
      reporter: ['json', 'text'],
      reportsDirectory: 'raw-coverage',
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
};
