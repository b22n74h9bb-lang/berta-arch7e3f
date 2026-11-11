import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { createGithubAuthorizeHandler } from "./github/auth";
import { createGithubWebhookHandler } from "./bridge/github-webhook";
import { createWechatCallbackHandler } from "./bridge/wechat-callback";
import { Paths } from "@contracts/constants";
import { log } from "./lib/logger";
import { handleClientLog } from "./lib/clientlog";
import { REQUEST_ID_HEADER, runWithRequestId } from "./lib/requestcontext";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  if (c.req.path === "/api/log") {
    await next();
    return;
  }
  const start = Date.now();
  await runWithRequestId(requestId, async () => {
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, requestId);
    if (!c.req.path.startsWith("/api/")) return;
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  });
});

// Keep body limits route-scoped so bodyless requests work through the dev server.
app.use("/api/trpc/*", bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.githubAuthorize, createGithubAuthorizeHandler());
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.post(Paths.githubWebhook, bodyLimit({ maxSize: 1024 * 1024 }), createGithubWebhookHandler());
app.on(["GET", "POST"], "/api/wechat/callback", bodyLimit({ maxSize: 64 * 1024 }), createWechatCallbackHandler());
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "berta-arch7e3f",
    time: new Date().toISOString(),
  }),
);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({ endpoint: "/api/trpc", req: c.req.raw, router: appRouter, createContext });
});
app.post("/api/log", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.body(null, 413) }), handleClientLog);
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

app.onError((err, c) => {
  log.error("unhandled request error", {
    method: c.req.method,
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => log.info(`Server running on http://localhost:${port}/`));
}
