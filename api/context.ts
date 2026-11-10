import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { authenticateRequest, isStaleSessionError, type SessionUser } from "./kimi/auth";
import { clearedSessionCookie } from "./lib/cookies";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: SessionUser;
};

export async function createContext(opts: FetchCreateContextFnOptions): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch (error) {
    if (isStaleSessionError(error)) {
      opts.resHeaders.append("set-cookie", clearedSessionCookie(opts.req.headers));
    }
  }
  return ctx;
}
