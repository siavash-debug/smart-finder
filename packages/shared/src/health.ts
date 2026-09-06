/**
 * Health reporting shapes shared by both execution planes.
 *
 * `/healthz` is liveness — it answers "can this process serve at all" and touches no
 * dependency. `/readyz` is readiness — it probes dependencies and reports per component.
 * Splitting them keeps an orchestrator from restarting healthy processes because a shared
 * dependency blipped (ADR-0010).
 */

export type ComponentStatus = "ok" | "degraded" | "down";

export interface ComponentHealth {
  name: string;
  status: ComponentStatus;
  /** Human-readable cause. Must never contain credentials or connection strings. */
  detail?: string;
  latency_ms?: number;
}

export type ReadinessStatus = "ready" | "not_ready";

export interface ReadinessReport {
  status: ReadinessStatus;
  checked_at: string;
  components: ComponentHealth[];
}

export interface LivenessReport {
  status: "ok";
  service: string;
  version: string;
  uptime_s: number;
  checked_at: string;
}

/**
 * A component that is `down` blocks readiness. `degraded` does not: the process can still
 * serve, and flipping out of the load balancer would make a partial outage total.
 */
export function aggregateReadiness(
  components: ComponentHealth[],
  now: Date = new Date(),
): ReadinessReport {
  const status: ReadinessStatus = components.some((component) => component.status === "down")
    ? "not_ready"
    : "ready";

  return {
    status,
    checked_at: now.toISOString(),
    components,
  };
}

export function readinessHttpStatus(report: ReadinessReport): 200 | 503 {
  return report.status === "ready" ? 200 : 503;
}

export function buildLiveness(options: {
  service: string;
  version: string;
  uptimeSeconds: number;
  now?: Date;
}): LivenessReport {
  return {
    status: "ok",
    service: options.service,
    version: options.version,
    uptime_s: Math.round(options.uptimeSeconds),
    checked_at: (options.now ?? new Date()).toISOString(),
  };
}
