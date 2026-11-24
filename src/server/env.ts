// Every variable is required. A missing value stops the server at boot.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

export function loadEnv() {
  return {
    databaseUrl: required("DATABASE_URL"),
    neonAuthBaseUrl: required("NEON_AUTH_BASE_URL"),
    neonAuthJwksUrl: required("NEON_AUTH_JWKS_URL"),
    authCookieSecret: required("AUTH_COOKIE_SECRET"),
    ownerEmails: required("OWNER_EMAILS")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    mediaBucket: required("MEDIA_BUCKET"),
    host: required("HOST"),
    /** Dashboard, login proxy and API; kept on a private network (Tailscale). */
    dashboardPort: Number(required("DASHBOARD_PORT")),
    /** Credential-only API and client downloads; published to the internet. */
    agentPort: Number(required("AGENT_PORT")),
    /** Public base URL of the agent listener, written into the client installer. */
    agentUrl: required("AGENT_URL"),
    /** Where the owner opens the dashboard; `GET /me` returns it so the skill can point to it. */
    dashboardUrl: required("DASHBOARD_URL"),
  };
}

export type Env = ReturnType<typeof loadEnv>;
