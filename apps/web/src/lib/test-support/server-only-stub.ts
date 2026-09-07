/**
 * Vitest doesn't run through Next.js's bundler, so the real `server-only` package's
 * client/server-boundary guard trips on any test that imports a module marked
 * `import "server-only"`. This stub — aliased in `vitest.config.ts` — replaces it with a
 * no-op for tests only; the real package is still used at build/runtime via Next.js.
 */
export {};
