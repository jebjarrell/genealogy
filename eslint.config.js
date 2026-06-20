// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Node built-in module names that must never be imported from @genealogy/core.
 * The core library is pure TypeScript and must run unchanged in a browser and
 * in Node — so it may not depend on any Node-only API. (See TRD §3, §11.)
 */
const NODE_BUILTINS = [
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
];

/**
 * Rendering / framework libraries that must never be imported from core.
 * Everything that touches the screen lives in apps/web, never in core. (TRD §1, §4.3.)
 */
const FORBIDDEN_CORE_PACKAGES = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@xyflow/react',
  'zustand',
  '@dagrejs/dagre',
  'dagre',
];

/**
 * DOM / network globals that must never appear in core. `fetch` in particular is
 * the network boundary: core defines the PlaceResolver interface but never calls
 * the network itself. (TRD §1, §4.3, §8.1.)
 */
const FORBIDDEN_CORE_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'alert',
  'confirm',
  'prompt',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLElement',
  'Node',
  'Element',
  'CustomEvent',
  '__dirname',
  '__filename',
  'process',
  'global',
  'Buffer',
  'require',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/.eslint-forbidden-probe.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Project-wide TypeScript hygiene.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // ---- The portability firewall around @genealogy/core (TRD §1, §3, §11) ----
    // Any DOM, network, Node-only, or rendering-library dependency here fails CI.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...NODE_BUILTINS, ...FORBIDDEN_CORE_PACKAGES].map((name) => ({
            name,
            message:
              '@genealogy/core must be DOM-, network-, and Node-free (TRD §1/§3/§11). Move this dependency to apps/web or @genealogy/geo.',
          })),
          patterns: [
            {
              group: ['node:*'],
              message: '@genealogy/core must not import Node built-ins (TRD §3/§11).',
            },
            {
              group: ['@xyflow/*', 'react-dom/*'],
              message:
                '@genealogy/core must not import rendering libraries (TRD §1/§4.3).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...FORBIDDEN_CORE_GLOBALS.map((name) => ({
          name,
          message:
            '@genealogy/core must not use DOM/network/Node globals (TRD §1/§3). `fetch` is the network boundary — see PlaceResolver (TRD §8.1).',
        })),
      ],
    },
  },
  {
    // The single sanctioned exception: the GEDCOM adapter imports the parser
    // library (pure JS, not DOM/network/Node), but still no DOM/network globals.
    // read-gedcom is allowed here and nowhere else.
    files: ['packages/core/src/gedcom/parse.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...NODE_BUILTINS, ...FORBIDDEN_CORE_PACKAGES].map((name) => ({
            name,
            message:
              '@genealogy/core must be DOM-, network-, and Node-free (TRD §1/§3/§11).',
          })),
          patterns: [
            { group: ['node:*'], message: 'No Node built-ins in core.' },
            {
              group: ['@xyflow/*', 'react-dom/*'],
              message: 'No rendering libs in core.',
            },
          ],
        },
      ],
    },
  },
  {
    // Test files may use Node globals (they run under Node/Vitest) and read fixtures.
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
