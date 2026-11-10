import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { env } from "../lib/env";
import { log } from "../lib/logger";
import { getSessionCookieOptions } from "../lib/cookies";
import { Session } from "@contracts/constants";
import { signSessionToken } from "../kimi/session";
import { findUserByUnionId, setUserRole, upsertUser } from "../queries/users";
import { upsertMemberForSignIn } from "../queries/members";
import { githubUnionId, isOwnerGithubId, oauthStatesMatch } from "./membership";

const STATE_COOKIE = "gh_oauth_state";
const GITHUB_SCOPE = "read:user user:email";
const GITHUB_API = "https://api.github.com";

class GithubRequestError extends Error {
  status: number;
  constructor(status: number) {
    super("GitHub request failed");
    this.status = status;
  }
}

export function githubOAuthConfigured(): boolean {
  return Boolean(env.githubClientId && env.githubClientSecret);
}

function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function stateCookieOptions(headers: Headers, maxAge = 600): CookieOptions {
  const host = headers.get("x-forwarded-host") || headers.get("host") || "";
  return { httpOnly: true, path: "/", sameSite: "Lax", secure: !isLocalHost(host), maxAge };
}

function redirectUri(c: Context): string {
  if (env.githubOAuthRedirectUrl) return env.githubOAuthRedirectUrl;
  const forwarded = c.req.header("x-forwarded-proto");
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || "localhost";
  const proto = forwarded || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}/api/oauth/callback`;
}

function clearStateCookie(c: Context) {
  setCookie(c, STATE_COOKIE, "", stateCookieOptions(c.req.raw.headers, 0));
}

export function createGithubAuthorizeHandler() {
  return (c: Context) => {
    if (!githubOAuthConfigured()) return c.json({ error: "github_oauth_disabled" }, 404);
    const state = `gh:${crypto.randomUUID()}`;
    setCookie(c, STATE_COOKIE, state, stateCookieOptions(c.req.raw.headers));
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", env.githubClientId);
    url.searchParams.set("redirect_uri", redirectUri(c));
    url.searchParams.set("scope", GITHUB_SCOPE);
    url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  };
}

type GithubUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type GithubEmail = { email: string; primary: boolean; verified: boolean };

async function githubFetch(path: string, token: string): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "berta-arch7e3f",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

async function exchangeCode(code: string, callbackUrl: string): Promise<string> {
  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: callbackUrl,
    }),
  });
  if (!resp.ok) throw new GithubRequestError(resp.status);
  const data = (await resp.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    const known = new Set([
      "incorrect_client_credentials",
      "bad_verification_code",
      "redirect_uri_mismatch",
    ]);
    log.warn("github token exchange rejected", {
      reason: data.error && known.has(data.error) ? data.error : "rejected",
    });
    throw new GithubRequestError(400);
  }
  return data.access_token;
}

function pickEmail(profile: GithubUser, emails: GithubEmail[]): string | null {
  const chosen = emails.find((item) => item.primary && item.verified)
    ?? emails.find((item) => item.verified)
    ?? null;
  const email = chosen?.email || profile.email || "";
  const trimmed = email.trim();
  return trimmed ? trimmed.slice(0, 320) : null;
}

async function fetchProfile(token: string): Promise<{ profile: GithubUser; email: string | null }> {
  const userResp = await githubFetch("/user", token);
  if (!userResp.ok) throw new GithubRequestError(userResp.status);
  const profile = (await userResp.json()) as GithubUser;
  if (!Number.isInteger(profile.id) || profile.id < 1 || !/^[A-Za-z0-9-]{1,255}$/.test(profile.login ?? "")) {
    throw new GithubRequestError(502);
  }
  const emailResp = await githubFetch("/user/emails", token);
  const emails = emailResp.ok ? ((await emailResp.json()) as GithubEmail[]) : [];
  return { profile, email: pickEmail(profile, Array.isArray(emails) ? emails : []) };
}

export async function handleGithubCallback(c: Context) {
  const providerError = c.req.query("error");
  if (providerError) {
    clearStateCookie(c);
    log.warn("github authorization was not completed", {
      reason: providerError === "access_denied" ? "access_denied" : "provider_error",
    });
    return c.redirect("/login", 302);
  }
  if (!githubOAuthConfigured()) return c.json({ error: "github_oauth_disabled" }, 404);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, STATE_COOKIE);
  clearStateCookie(c);
  if (!code) return c.json({ error: "code_required" }, 400);
  if (!oauthStatesMatch(state, cookieState)) return c.json({ error: "invalid_oauth_state" }, 400);
  try {
    const callbackUrl = redirectUri(c);
    const accessToken = await exchangeCode(code, callbackUrl);
    const { profile, email } = await fetchProfile(accessToken);
    const githubId = String(profile.id);
    const unionId = githubUnionId(githubId);
    const owner = isOwnerGithubId(githubId, env.ownerGithubId);
    await upsertUser({
      unionId,
      name: (profile.name || profile.login).slice(0, 255),
      email,
      avatar: profile.avatar_url,
      role: owner ? "admin" : "user",
      lastSignInAt: new Date(),
    });
    const user = await findUserByUnionId(unionId);
    if (!user) throw new Error("user missing after sign-in");
    if (user.role !== (owner ? "admin" : "user")) {
      await setUserRole(user.id, owner ? "admin" : "user");
    }
    const member = await upsertMemberForSignIn({
      githubId,
      login: profile.login,
      userId: user.id,
      ownerGithubId: env.ownerGithubId,
    });
    const token = await signSessionToken({
      unionId,
      clientId: env.appId || "github",
      sessionGeneration: member.sessionGeneration,
    });
    const cookieOpts = getSessionCookieOptions(c.req.raw.headers);
    setCookie(c, Session.cookieName, token, { ...cookieOpts, maxAge: Session.maxAgeMs / 1000 });
    return c.redirect("/", 302);
  } catch (error) {
    const status = error instanceof GithubRequestError ? error.status : undefined;
    log.error("github sign-in failed", status ? { status } : undefined);
    return c.json({ error: "github_sign_in_failed" }, 500);
  }
}
