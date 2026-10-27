import { authRouter } from "./auth-router";
import { bertaRouter } from "./berta-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  berta: bertaRouter,
});

export type AppRouter = typeof appRouter;
