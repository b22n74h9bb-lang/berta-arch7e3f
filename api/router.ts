import { authRouter } from "./auth-router";
import { bertaRouter } from "./berta-router";
import { pluginsRouter } from "./plugins-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  berta: bertaRouter,
  plugins: pluginsRouter,
});

export type AppRouter = typeof appRouter;
