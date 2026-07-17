import { loadEnvConfig } from "@next/env";

export type DatabaseUrlVariable = "DATABASE_URL" | "DATABASE_MIGRATION_URL";
export type StringEnvironment = Readonly<Record<string, string | undefined>>;

const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
const acceptedTlsModes = new Set(["require", "verify-ca", "verify-full"]);

export function loadPrivateLocalEnvironment(cwd = process.cwd()): string | null {
  const development = process.env.NODE_ENV !== "production";
  const result = loadEnvConfig(cwd, development, { info: () => undefined, error: () => undefined }, true);
  return result.loadedEnvFiles[0]?.path ?? null;
}

export function requireDatabaseUrl(variable: DatabaseUrlVariable, environment: StringEnvironment = process.env): string {
  const value = environment[variable];
  if (!value) throw new Error(`${variable} is required; no database connection was attempted.`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid PostgreSQL connection URL; no database connection was attempted.`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${variable} must use the postgres or postgresql scheme; no database connection was attempted.`);
  }
  if (!parsed.hostname || !parsed.username || !parsed.password || parsed.pathname.length <= 1) {
    throw new Error(`${variable} must include a host, username, password, and database name; no database connection was attempted.`);
  }

  const tlsModes = parsed.searchParams.getAll("sslmode");
  const libpqCompatibility = parsed.searchParams.getAll("uselibpqcompat");
  if (
    !localHostnames.has(parsed.hostname) &&
    (tlsModes.length !== 1 ||
      !acceptedTlsModes.has(tlsModes[0]) ||
      libpqCompatibility.length !== 1 ||
      libpqCompatibility[0] !== "true")
  ) {
    throw new Error(`${variable} must require TLS with one accepted sslmode and uselibpqcompat=true; no database connection was attempted.`);
  }

  return value;
}
