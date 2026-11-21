import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const COOKIE_NAME = "wt_session";

export function newSessionId(): string {
  return randomUUID();
}

/** Route Handler helper: returns the anonymous case-file scope, creating one if needed. */
export async function getOrCreateSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing && /^[a-f0-9-]{36}$/i.test(existing)) return existing;
  const sessionId = newSessionId();
  store.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return sessionId;
}

export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  return existing && /^[a-f0-9-]{36}$/i.test(existing) ? existing : null;
}
