import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Workspace packages are aliased to their TypeScript source so tests always exercise the
 * current code rather than a possibly stale `dist/` build.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@smart-finder/shared": resolvePath("./packages/shared/src/index.ts"),
      "@smart-finder/normalizer": resolvePath("./packages/normalizer/src/index.ts"),
      "@smart-finder/matching": resolvePath("./packages/matching/src/index.ts"),
      "@smart-finder/database": resolvePath("./packages/database/src/index.ts"),
    },
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
