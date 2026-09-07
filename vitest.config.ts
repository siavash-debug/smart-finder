import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Workspace packages are aliased to their TypeScript source so tests always exercise the
 * current code rather than a possibly stale `dist/` build.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: "@smart-finder/shared", replacement: resolvePath("./packages/shared/src/index.ts") },
      {
        find: "@smart-finder/normalizer",
        replacement: resolvePath("./packages/normalizer/src/index.ts"),
      },
      {
        find: "@smart-finder/matching",
        replacement: resolvePath("./packages/matching/src/index.ts"),
      },
      {
        find: "@smart-finder/telegram",
        replacement: resolvePath("./packages/telegram/src/index.ts"),
      },
      {
        find: "@smart-finder/database",
        replacement: resolvePath("./packages/database/src/index.ts"),
      },
      {
        find: "@smart-finder/scraper",
        replacement: resolvePath("./packages/scraper/src/index.ts"),
      },
      // See apps/web/src/lib/test-support/server-only-stub.ts for why.
      {
        find: "server-only",
        replacement: resolvePath("./apps/web/src/lib/test-support/server-only-stub.ts"),
      },
      // Next.js resolves apps/web's own "@/*" path alias (apps/web/tsconfig.json) via its
      // bundler; Vitest doesn't read that config, so it needs the same mapping here too.
      { find: /^@\//, replacement: `${resolvePath("./apps/web/src")}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
