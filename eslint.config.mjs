import { defineConfig } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  },

  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // eslint.config.mjs isn't in any tsconfig; lint it with a default project.
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Catch the async-bug class that bites Discord bots.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Commands and events are loaded from their folders with require() and
      // held as `any`, so the any-propagation checks cannot pass yet.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off'
    }
  },

  {
    // Tests stub async functions on purpose.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off'
    }
  },

  // Formatting is Prettier's job (`pnpm format`); turn off any rules that clash with it.
  eslintConfigPrettier
)
