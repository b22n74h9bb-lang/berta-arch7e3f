import type { CookieOptions } from "hono/utils/cookie";
import * as cookie from "cookie";
import { Session } from "@contracts/constants";

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);
  return { httpOnly: true, path: "/", sameSite: localhost ? "Lax" : "None", secure: !localhost };
}

export function clearedSessionCookie(headers: Headers): string {
  const opts = getSessionCookieOptions(headers);
  return cookie.serialize(Session.cookieName, "", {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite === "None" ? "none" : "lax",
    secure: opts.secure,
    maxAge: 0,
  });
}
