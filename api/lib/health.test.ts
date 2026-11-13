import { describe, expect, it } from "vitest";
import { healthReport, listenHostname } from "./health";

describe("health and bind", () => {
  it("reports the database as up only when the ping succeeds", () => {
    const now = new Date("2026-11-14T00:00:00.000Z");
    expect(healthReport(true, now)).toEqual({
      status: 200,
      body: { ok: true, service: "berta-arch7e3f", time: "2026-11-14T00:00:00.000Z", db: "up" },
    });
    expect(healthReport(false, now).status).toBe(503);
    expect(healthReport(false, now).body.db).toBe("down");
    expect(healthReport(false, now).body.ok).toBe(false);
  });

  it("binds to loopback unless a host is set", () => {
    expect(listenHostname(undefined)).toBe("127.0.0.1");
    expect(listenHostname("  ")).toBe("127.0.0.1");
    expect(listenHostname("0.0.0.0")).toBe("0.0.0.0");
  });
});
