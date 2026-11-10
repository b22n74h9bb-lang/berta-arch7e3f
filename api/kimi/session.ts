import * as jose from "jose";
import { env } from "../lib/env";
import type { SessionPayload } from "./types";

const JWT_ALG = "HS256";

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[session] No token provided for verification.");
    return null;
  }
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, { algorithms: [JWT_ALG] });
    const { unionId, clientId, sessionGeneration } = payload;
    if (typeof unionId !== "string" || typeof clientId !== "string" || !unionId || !clientId) {
      console.warn("[session] JWT payload missing required fields.");
      return null;
    }
    if (
      sessionGeneration !== undefined &&
      (typeof sessionGeneration !== "number" || !Number.isInteger(sessionGeneration) || sessionGeneration < 1)
    ) {
      console.warn("[session] JWT payload has an invalid session generation.");
      return null;
    }
    return { unionId, clientId, sessionGeneration };
  } catch (error) {
    console.warn("[session] JWT verification failed:", error);
    return null;
  }
}
