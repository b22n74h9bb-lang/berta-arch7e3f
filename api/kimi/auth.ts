import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import * as jose from "jose";
import * as cookie from "cookie";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { signSessionToken, verifySessionToken } from "./session";
import { users as kimiUsers } from "./platform";
import { findUserByUnionId, setUserRole, upsertUser } from "../queries/users";
import { ensureMemberForUser } from "../queries/members";
import { githubIdFromUnion, isOwnerGithubId, sessionAccess } from "../github/membership";
import { handleGithubCallback } from "../github/auth";
import type { TokenResponse } from "./types";
import type { User } from "@db/schema";
import type { MembershipView } from "../github/membership";

export class StaleSessionError extends Error {
  constructor() {
    super("Session is no longer valid.");
  }
}

export function isStaleSessionError(error: unknown): error is StaleSessionError {
  return error instanceof StaleSessionError;
}

export type SessionUser = User & { membership?: MembershipView };

async function exchangeAuthCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.appId,
    redirect_uri: redirectUri,
    client_secret: env.appSecret,
  });
  const resp = await fetch(`${env.kimiAuthUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<TokenResponse>;
}

const jwks = jose.createRemoteJWKSet(
  new URL(`${env.kimiAuthUrl}/api/.well-known/jwks.json`),
);

async function verifyAccessToken(accessToken: string): Promise<{ userId: string; clientId: string }> {
  const { payload } = await jose.jwtVerify(accessToken, jwks);
  const userId = payload.user_id as string;
  const clientId = payload.client_id as string;
  if (!userId) throw new Error("user_id missing from access token");
  return { userId, clientId };
}

export async function authenticateRequest(headers: Headers): Promise<SessionUser> {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) {
    console.warn("[auth] No session cookie found in request.");
    throw Errors.forbidden("Invalid authentication token.");
  }
  const claim = await verifySessionToken(token);
  if (!claim) throw Errors.forbidden("Invalid authentication token.");
  const user = await findUserByUnionId(claim.unionId);
  if (!user) throw Errors.forbidden("User not found. Please re-login.");
  const githubId = githubIdFromUnion(claim.unionId);
  if (!githubId) return user;
  const member = await ensureMemberForUser({
    githubId,
    loginHint: user.name ?? "",
    userId: user.id,
    ownerGithubId: env.ownerGithubId,
  });
  if (sessionAccess({ tokenGeneration: claim.sessionGeneration, member }) === "stale") {
    throw new StaleSessionError();
  }
  const owner = isOwnerGithubId(githubId, env.ownerGithubId);
  const role = owner ? "admin" : "user";
  if (user.role !== role) await setUserRole(user.id, role);
  return {
    ...user,
    role,
    membership: {
      status: member.status,
      role: member.role,
      login: member.login,
      githubId: member.githubId,
      sessionGeneration: member.sessionGeneration,
    },
  };
}

export function createOAuthCallbackHandler() {
  return async (c: Context) => {
    const state = c.req.query("state");
    if (state?.startsWith("gh:")) return handleGithubCallback(c);
    const code = c.req.query("code");
    const error = c.req.query("error");
    const errorDescription = c.req.query("error_description");
    if (error) {
      if (error === "access_denied") return c.redirect("/", 302);
      return c.json({ error, error_description: errorDescription }, 400);
    }
    if (!code || !state) return c.json({ error: "code and state are required" }, 400);
    try {
      const redirectUri = atob(state);
      const tokenResp = await exchangeAuthCode(code, redirectUri);
      const { userId } = await verifyAccessToken(tokenResp.access_token);
      const userProfile = await kimiUsers.getProfile(tokenResp.access_token);
      if (!userProfile) throw new Error("Failed to fetch user profile from Kimi Open");
      await upsertUser({
        unionId: userId,
        name: userProfile.name,
        avatar: userProfile.avatar_url,
        lastSignInAt: new Date(),
      });
      const token = await signSessionToken({ unionId: userId, clientId: env.appId });
      const cookieOpts = getSessionCookieOptions(c.req.raw.headers);
      setCookie(c, Session.cookieName, token, {
        ...cookieOpts,
        maxAge: Session.maxAgeMs / 1000,
      });
      return c.redirect("/", 302);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      return c.json({ error: "OAuth callback failed" }, 500);
    }
  };
}

export { exchangeAuthCode, verifyAccessToken };
