import { describe, expect, it } from "vitest";

import {
  aggregateReadiness,
  buildLiveness,
  readinessHttpStatus,
  type ComponentHealth,
} from "./health.js";

const at = new Date("2026-09-06T12:00:00.000Z");

describe("aggregateReadiness", () => {
  it("reports ready when every component is ok", () => {
    const report = aggregateReadiness([{ name: "database", status: "ok", latency_ms: 3 }], at);

    expect(report.status).toBe("ready");
    expect(report.checked_at).toBe("2026-09-06T12:00:00.000Z");
    expect(readinessHttpStatus(report)).toBe(200);
  });

  it("reports not_ready when any component is down", () => {
    const components: ComponentHealth[] = [
      { name: "database", status: "down", detail: "connection refused" },
      { name: "queue", status: "ok" },
    ];

    const report = aggregateReadiness(components, at);

    expect(report.status).toBe("not_ready");
    expect(readinessHttpStatus(report)).toBe(503);
  });

  it("stays ready when a component is only degraded", () => {
    const report = aggregateReadiness([{ name: "database", status: "degraded" }], at);

    expect(report.status).toBe("ready");
    expect(readinessHttpStatus(report)).toBe(200);
  });

  it("treats an empty component list as ready", () => {
    expect(aggregateReadiness([], at).status).toBe("ready");
  });

  it("preserves component detail for diagnosis", () => {
    const report = aggregateReadiness(
      [{ name: "database", status: "down", detail: "timeout after 10000ms" }],
      at,
    );

    expect(report.components[0]).toEqual({
      name: "database",
      status: "down",
      detail: "timeout after 10000ms",
    });
  });
});

describe("buildLiveness", () => {
  it("rounds uptime and stamps the check time", () => {
    const report = buildLiveness({
      service: "worker",
      version: "0.1.0",
      uptimeSeconds: 12.7,
      now: at,
    });

    expect(report).toEqual({
      status: "ok",
      service: "worker",
      version: "0.1.0",
      uptime_s: 13,
      checked_at: "2026-09-06T12:00:00.000Z",
    });
  });
});
