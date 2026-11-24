import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Db } from "./db.ts";
import type { Actor } from "./domain/actor.ts";
import { TOKEN_PREFIX, verifyCredential } from "./domain/credentials.ts";
import { AppError } from "./errors.ts";

/** Verifies a dashboard session JWT and returns the owner's email, or null if the token is not a valid owner token. */
export type OwnerVerifier = (jwt: string) => Promise<string | null>;

export function neonOwnerVerifier(opts: { jwksUrl: string; authBaseUrl: string; ownerEmails: string[] }): OwnerVerifier {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl));
  const issuer = new URL(opts.authBaseUrl).origin;
  return async (jwt) => {
    try {
      const { payload } = await jwtVerify(jwt, jwks, { issuer });
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
      return email && payload.emailVerified === true && opts.ownerEmails.includes(email) ? email : null;
    } catch {
      return null;
    }
  };
}

/**
 * Agents send `Authorization: Bearer swl_...` (a credential); the dashboard
 * sends a Neon Auth JWT for an owner email.
 */
export async function authenticate(db: Db, header: string | undefined, verifyOwner: OwnerVerifier): Promise<Actor> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new AppError(401, "unauthenticated", "send Authorization: Bearer <credential>");
  if (token.startsWith(TOKEN_PREFIX)) {
    const credential = await verifyCredential(db, token);
    if (!credential) throw new AppError(401, "unauthenticated", "credential is invalid or revoked");
    return { kind: "credential", ...credential };
  }
  const email = await verifyOwner(token);
  if (!email) throw new AppError(401, "unauthenticated", "session token is invalid, expired, or not an owner account");
  return { kind: "owner", email };
}
