import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("S025 scoped MCP entry point", () => {
  it("exposes create and read-only status without approval or provider credentials", () => {
    const source = readFileSync(resolve(process.cwd(), "mcp/server.ts"), "utf8");
    expect(source).toContain('server.tool(\n    "create_world_pr"');
    expect(source).toContain('server.tool(\n    "get_world_pr_status"');
    for (const forbiddenTool of ["approve", "execute", "recover", "activate", "reset"]) {
      expect(source).not.toContain(`server.tool(\n    "${forbiddenTool}`);
    }
    expect(source).not.toContain("GOOGLE_CLIENT_SECRET");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).toContain("reviewUrl");
    expect(source).toContain("replayPending");
  });
});
