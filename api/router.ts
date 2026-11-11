import { authRouter } from "./auth-router";
import { bertaRouter } from "./berta-router";
import { bridgeRouter } from "./bridge-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  berta: bertaRouter,
  bridge: bridgeRouter,
});

export type AppRouter = typeof appRouter;
