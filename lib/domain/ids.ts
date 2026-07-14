import { randomBytes } from "node:crypto";

export function createOpaqueId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("base64url")}`;
}
