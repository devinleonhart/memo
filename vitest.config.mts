import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Wiring with no logic of its own.
      exclude: ['src/index.ts', 'src/bootstrap.ts', 'src/registry.ts', 'src/@types/**'],
      thresholds: {
        branches: 85,
        functions: 88,
        lines: 95,
        statements: 95
      }
    }
  }
})
