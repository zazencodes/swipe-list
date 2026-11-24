import { createAuthClient } from "@neondatabase/auth";

/** Same-origin: the server proxies /api/auth/* to Neon Auth so the session cookies are first-party. */
export const authClient = createAuthClient(`${window.location.origin}/api/auth`);

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

/** Refresh this long before the JWT's exp so a request never leaves with a token about to expire. */
const REFRESH_MARGIN_MS = 60_000;

function expiryOf(jwt: string): number {
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("session token is not a JWT");
  const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
  if (typeof json.exp !== "number") throw new Error("session token has no exp claim");
  return json.exp * 1000;
}

async function fetchToken(): Promise<string | null> {
  let token: string | undefined;
  try {
    // The Neon adapter treats /token like /get-session and answers from its session cache
    // ({session, user}, no token). X-Force-Fetch is the adapter's own bypass: it strips the
    // header and sends the request to the server.
    const { data } = await authClient.token({ fetchOptions: { headers: { "X-Force-Fetch": "1" } } });
    token = data?.token;
  } catch (error) {
    // The adapter throws AuthApiError on non-2xx; 401 means there is no session.
    if ((error as { status?: number }).status === 401) return null;
    throw error;
  }
  if (!token) return null;
  cached = { token, expiresAt: expiryOf(token) };
  return token;
}

/** The dashboard JWT for `Authorization: Bearer`, or null when there is no signed-in session. */
export async function sessionToken(): Promise<string | null> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached.token;
  inflight ??= fetchToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function dropSessionToken() {
  cached = null;
}

export async function signOut() {
  dropSessionToken();
  await authClient.signOut();
}

/**
 * Runs an auth call and returns a message for the owner, or null on success. The Neon adapter throws
 * AuthApiError for failed requests (keeping Better Auth's message, e.g. "Invalid OTP"), so both a
 * thrown error and a returned `error` end up here.
 */
export async function authAttempt(call: () => Promise<{ error?: unknown }>): Promise<string | null> {
  try {
    const { error } = await call();
    return error ? authErrorMessage(error) : null;
  } catch (error) {
    return authErrorMessage(error);
  }
}

function authErrorMessage(error: unknown): string {
  const { message = "", status } = (error ?? {}) as { message?: string; status?: number };
  if (/invalid otp/i.test(message)) return "That code is not right. Check the email and try again.";
  if (/expired/i.test(message)) return "That code has expired. Send a new one.";
  if (/too many attempts/i.test(message)) return "Too many wrong codes. Send a new one.";
  if (status === 429 || /rate limit|too many requests/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  if (/invalid email/i.test(message)) return "Enter a valid email address.";
  return message || "Something went wrong. Try again.";
}
