/**
 * Runtime entry point for both planes.
 *
 * The migration runner is deliberately NOT re-exported here. It resolves its SQL directory
 * from `import.meta.url` at runtime, which a bundler cannot statically analyse, and pulling it
 * into the serve plane's import graph breaks the Next.js build. Migrations are a deploy-time
 * concern — import them from `@smart-finder/database/migrate`.
 */

export {
  closePool,
  createPool,
  installTypeParsers,
  withTransaction,
  type CreatePoolOptions,
  type DatabaseClient,
  type DatabasePool,
} from "./pool.js";

export { checkDatabaseHealth } from "./health.js";
