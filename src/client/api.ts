// HTTP client for the Swipe List API, shared by the `swipe` CLI and the ingestion
// worker. Both read the server URL and credential that `swipe login` stores.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CONFIG_PATH = path.join(os.homedir(), ".config", "swipe", "config.json");

export interface Config {
  url: string;
  token: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly payload?: unknown,
  ) {
    super(message);
  }
}

export function serverOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError("enter a valid server URL", null);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new ApiError("use HTTPS for a remote Swipe List server", null);
  }
  if (url.username || url.password) throw new ApiError("use a server URL without credentials", null);
  return url.origin;
}

export async function loadConfig(): Promise<Config> {
  let text: string;
  try {
    text = await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new ApiError(`not logged in: run \`swipe login --url <server url>\` and paste your credential (${CONFIG_PATH} is missing)`, null);
  }
  return JSON.parse(text) as Config;
}

export type Query = Record<string, string | number | boolean | undefined>;

/** Calls `/api<route>` and returns the parsed JSON body, or null for 204. Non-2xx responses throw ApiError. */
export async function request<T = unknown>(
  config: Config,
  method: string,
  route: string,
  opts: { query?: Query; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const url = new URL(`/api${route}`, serverOrigin(config.url));
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { authorization: `Bearer ${config.token}` };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, redirect: "error" });
  } catch (error) {
    throw new ApiError(`cannot reach ${config.url}: ${(error as Error).message}`, null);
  }
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(`${method} ${route} failed with ${res.status}`, res.status, payload);
  return payload as T;
}
