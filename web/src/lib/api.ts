import { dropSessionToken, sessionToken } from "./auth";

/** An API failure: {"error": {code, message, details}} from the server, with details.problems pulled out. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly problems: string[];

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    // 422s carry details.problems (strings); 400s from request validation carry [{path, message}].
    const problems = (details as { problems?: unknown } | undefined)?.problems;
    this.problems = Array.isArray(problems)
      ? problems.map(String)
      : Array.isArray(details)
        ? details.map((d: { path?: string; message?: string }) => (d.path ? `${d.path}: ${d.message}` : String(d.message)))
        : [];
  }

  /** A numeric field in details, e.g. document_id on a duplicate upload. */
  detail(key: string): number | null {
    const value = (this.details as Record<string, unknown> | undefined)?.[key];
    return typeof value === "number" ? value : null;
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const token = await sessionToken();
  if (!token) {
    onUnauthorized();
    throw new ApiError(401, "no_session", "You are signed out.");
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(`/api${path}`, { ...init, headers });
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await send(path, init);
  if (res.status === 401) {
    // The cached JWT may have expired early; get a fresh one once before giving up.
    dropSessionToken();
    res = await send(path, init);
  }
  if (res.ok) return res;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  const error = new ApiError(
    res.status,
    body?.error?.code ?? "http_error",
    body?.error?.message ?? `${res.status} ${res.statusText}`,
    body?.error?.details,
  );
  if (res.status === 401) onUnauthorized();
  throw error;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  return (res.status === 204 ? null : await res.json()) as T;
}

export function postJson<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  return api<T>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function apiBlob(path: string): Promise<Blob> {
  return (await request(path)).blob();
}

/** Builds a query string, dropping empty values. */
export function qs(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, string | number | boolean | null | undefined][]) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
