// Audit finding 15. There was no linter of any kind here: no config, no
// dependency, no script. CI ran the build and the order smoke test and nothing
// else, across 160 TypeScript files.
//
// The clearest evidence that one was missing: five `eslint-disable` comments
// already existed in the source -- in Home.tsx, Supervisor.tsx, OrderDetail.tsx
// and AddonLibrary.tsx -- written for a linter that was never installed. They
// had been suppressing nothing at all.
//
// WHAT THIS CONFIG DELIBERATELY DOES NOT DO
//
// no-explicit-any is OFF. It fires 34 times. Every one is cosmetic, and a lint
// gate that blocks merges on 34 style complaints is a lint gate somebody
// switches off within the week. The point of this file is to catch bugs.
//
// react-hooks/exhaustive-deps is a WARNING, not an error, and must stay that
// way until each of its 21 hits has been read individually. It is the most
// valuable rule here -- it flags the stale-closure family that produced audit
// finding 04 -- but "just add the missing dependency" is genuinely dangerous in
// this codebase: several of the hits are on polling effects in Vendor.tsx and
// Admin.tsx, where adding a dependency that changes every render turns a 8s
// poll into an infinite re-render loop. Fixing them is separate work needing a
// screen-by-screen judgement, not an --fix run.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/**', 'node_modules/**', 'ios/**', 'android/**',
      'supabase/baseline/**',      // generated types, not ours to lint
      'public/assets/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // The app itself: browser globals.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',   // see note above -- keep as warn
    },
  },

  // Service workers. These are plain .js with importScripts and the service
  // worker global scope -- 24 of the original no-undef errors were nothing but
  // this scope missing from the config.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.browser, firebase: 'readonly' },
    },
  },

  // Supabase edge functions run on Deno, not Node.
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { ...globals.node, Deno: 'readonly' } },
  },

  // Build and maintenance scripts run on Node.
  {
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Style-only rules that would gate merges on cosmetics. Off on purpose.
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Unused args prefixed with _ are a deliberate signal, not an oversight.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none',
      }],
    },
  },
)
