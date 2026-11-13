export function healthReport(dbUp: boolean, now = new Date()): {
  status: 200 | 503;
  body: { ok: boolean; service: "berta-arch7e3f"; time: string; db: "up" | "down" };
} {
  return {
    status: dbUp ? 200 : 503,
    body: {
      ok: dbUp,
      service: "berta-arch7e3f",
      time: now.toISOString(),
      db: dbUp ? "up" : "down",
    },
  };
}

/** Outside Docker, listen on loopback. Compose sets HOST=0.0.0.0 so the published port can reach the process. */
export function listenHostname(host: string | undefined): string {
  const value = host?.trim();
  return value || "127.0.0.1";
}
