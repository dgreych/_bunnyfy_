import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'workers/**/*.mjs'],
    languageOptions: {
      parserOptions: { project: false },
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },
  {
    // Porte verbatim dos renderers Jimp da Tavern (nazuna-gyomei,
    // dados/src/tavern/rendering) — lógica visual não deve ser redesenhada
    // aqui, só relocada para rodar com mais CPU. Tipagem solta do Jimp 0.16
    // não compensa uma tipagem forçada que arriscaria divergir do original.
    files: ['src/tavernGame/rendering/**/*.ts'],
    languageOptions: {
      parserOptions: { project: false },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'data/', 'eslint.config.js'],
  },
);
