/**
 * Reported by `/healthz` so a running container can be identified without shell access.
 * Kept in sync with `apps/worker/package.json` by hand — reading the manifest at runtime
 * would depend on the file surviving the container build, which it does not.
 */
export const WORKER_VERSION = "0.1.0";
