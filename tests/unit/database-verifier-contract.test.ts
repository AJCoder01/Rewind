import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIVILEGES_SQL,
  defaultPrivilegesMatch,
  type DefaultPrivilegeRow,
} from "@/scripts/verify-database";

const reviewedRows: readonly DefaultPrivilegeRow[] = [
  {
    scope: "global",
    object_type: "f",
    grantee: "postgres",
    privileges: ["EXECUTE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "S",
    grantee: "postgres",
    privileges: ["SELECT", "UPDATE", "USAGE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "S",
    grantee: "rewind_app",
    privileges: ["SELECT", "USAGE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "f",
    grantee: "postgres",
    privileges: ["EXECUTE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "r",
    grantee: "postgres",
    privileges: ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "r",
    grantee: "rewind_app",
    privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    any_grantable: false,
  },
];

describe("database verifier default-privilege contract", () => {
  it("accepts only the reviewed PostgreSQL 17 global/public owner/runtime rows", () => {
    expect(defaultPrivilegesMatch(reviewedRows)).toBe(true);
    expect(defaultPrivilegesMatch([...reviewedRows].reverse())).toBe(true);
  });

  it("keeps PUBLIC OID zero and global ACL rows visible to fail-closed evaluation", () => {
    expect(DEFAULT_PRIVILEGES_SQL).toContain("WHEN e.grantee = 0 THEN 'PUBLIC'");
    expect(DEFAULT_PRIVILEGES_SQL).toContain("LEFT JOIN pg_roles grantee");
    expect(DEFAULT_PRIVILEGES_SQL).toContain("d.defaclnamespace = 0");

    expect(defaultPrivilegesMatch([
      ...reviewedRows,
      {
        scope: "global",
        object_type: "f",
        grantee: "PUBLIC",
        privileges: ["EXECUTE"],
        any_grantable: false,
      },
    ])).toBe(false);
  });

  it("rejects PUBLIC and every unexpected role even when their grants otherwise look valid", () => {
    for (const grantee of ["PUBLIC", "anon", "authenticated", "service_role", "reporting_role"]) {
      expect(defaultPrivilegesMatch([
        ...reviewedRows,
        {
          scope: "public",
          object_type: "r",
          grantee,
          privileges: ["SELECT"],
          any_grantable: false,
        },
      ])).toBe(false);
    }
  });

  it("rejects missing owner rows, altered privileges, and grant options", () => {
    expect(defaultPrivilegesMatch(reviewedRows.slice(1))).toBe(false);
    expect(defaultPrivilegesMatch(reviewedRows.map((row, index) =>
      index === 5 ? { ...row, privileges: [...row.privileges, "TRUNCATE"] } : row,
    ))).toBe(false);
    expect(defaultPrivilegesMatch(reviewedRows.map((row, index) =>
      index === 2 ? { ...row, any_grantable: true } : row,
    ))).toBe(false);
  });
});
