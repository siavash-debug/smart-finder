import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // Workspace packages ship compiled JS in `dist/`, but transpiling them here keeps the build
  // working if a package is ever consumed straight from source.
  transpilePackages: ["@smart-finder/shared", "@smart-finder/database"],

  // `pg` is a native-ish CommonJS driver; bundling it into server chunks breaks its dynamic
  // requires. Keep it external so it is loaded by Node at runtime.
  serverExternalPackages: ["pg"],

  // Type errors must fail the build. Linting is not configured here at all: Next 16 removed
  // built-in lint, and the repository has a single root ESLint config run by `npm run lint`.
  typescript: { ignoreBuildErrors: false },

  poweredByHeader: false,
};

export default config;
