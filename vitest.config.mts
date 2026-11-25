import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/@types/**', 'src/functions/handlers/**'],
      // The floor is what the tests cover today; raise it as they grow.
      thresholds: {
        branches: 65,
        functions: 65,
        lines: 70,
        statements: 70
      }
    }
  }
})
