/**
 * Resolves Turso connection settings from the environment.
 *
 * Accepts the plain names (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN) and, as a
 * fallback, the prefixed names the Vercel Marketplace integration can create
 * (e.g. STORAGE_TURSO_DATABASE_URL). Shared by the runtime client and
 * drizzle.config.ts. Never log the returned authToken.
 */
export const DEFAULT_LOCAL_DB_URL = "file:local.db";

function readEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const direct = env[name]?.trim();
  if (direct) return direct;
  const suffix = `_${name}`;
  const prefixedKey = Object.keys(env)
    .filter((k) => k.endsWith(suffix) && env[k]?.trim())
    .sort()[0];
  return prefixedKey ? env[prefixedKey]!.trim() : undefined;
}

export interface DbConfig {
  url: string;
  authToken?: string;
  isLocalFile: boolean;
}

export function resolveDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const url = readEnv("TURSO_DATABASE_URL", env) ?? DEFAULT_LOCAL_DB_URL;
  const authToken = readEnv("TURSO_AUTH_TOKEN", env) || undefined;
  return { url, authToken, isLocalFile: url.startsWith("file:") };
}

/** Removes anything that looks like a credential from an error message. */
export function redactSecrets(message: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = message;
  const { authToken } = resolveDbConfig(env);
  if (authToken) out = out.split(authToken).join("[redacted]");
  // JWT-shaped strings and authToken query params.
  out = out.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]");
  out = out.replace(/(authToken=)[^&\s]+/gi, "$1[redacted]");
  return out;
}
