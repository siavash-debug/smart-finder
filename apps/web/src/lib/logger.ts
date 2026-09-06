import "server-only";

import { createLogger, isLogLevel, type Logger } from "@smart-finder/shared";

import { WEB_VERSION } from "./version";

/**
 * Server-side logger for the serve plane. `LOG_LEVEL` is read directly rather than through the
 * validated env schema so that a malformed value degrades to `info` instead of preventing the
 * web app from starting — logging configuration is not worth an outage.
 */
const level = process.env.LOG_LEVEL;

export const logger: Logger = createLogger({
  level: level !== undefined && isLogLevel(level) ? level : "info",
  base: { service: "web", version: WEB_VERSION },
});
