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
  type Queryable,
} from "./pool.js";

export { checkDatabaseHealth } from "./health.js";

export type {
  AppUserRow,
  JobRow,
  JobStatus,
  NotificationChannel,
  NotificationRow,
  NotificationStatus,
  PropertyType,
  SearchProfileRow,
  TelegramCommandLogRow,
  TransactionType,
} from "./domain.js";

export {
  claimJobs,
  completeJob,
  computeBackoffMs,
  countJobsByStatus,
  enqueueJob,
  failJob,
  getJobById,
  type ClaimJobsInput,
  type EnqueueJobInput,
  type FailJobInput,
} from "./job-queue.js";

export {
  createUser,
  findOrCreateUserByTelegramId,
  findUserById,
  findUserByTelegramId,
  type CreateUserInput,
} from "./user-repository.js";

export {
  deactivateSearchProfile,
  getActiveSearchProfile,
  getSearchProfileById,
  listSearchProfileHistory,
  replaceActiveSearchProfile,
  type SearchProfileInput,
} from "./search-profile-repository.js";

export {
  countNotificationsByStatus,
  countNotificationsForUserSince,
  createNotification,
  getNotificationById,
  getNotificationByIdempotencyKey,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSuppressed,
  recordNotificationAttemptFailure,
  rescheduleNotification,
  type CreateNotificationInput,
} from "./notification-repository.js";

export {
  getRecentCommandTimestamps,
  recordTelegramCommand,
} from "./telegram-rate-limit-repository.js";
