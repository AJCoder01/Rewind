import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiErrorResponseSchema, CreateWorldPrResponseSchema } from "@/lib/contracts/v1";
import { createOpaqueId } from "@/lib/domain/ids";

async function main(): Promise<void> {
  const backendToken = process.env.MCP_BACKEND_TOKEN;
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!backendToken) {
    throw new Error("MCP_BACKEND_TOKEN is required; the MCP server will not start without scoped authentication.");
  }
  if (!appBaseUrl) throw new Error("APP_BASE_URL is required so the MCP server can call the authenticated Rewind backend.");

  const endpoint = new URL("/api/v1/world-prs", appBaseUrl);
  const server = new McpServer({ name: "rewind", version: "0.1.0" });
  server.tool(
    "create_world_pr",
    "Create a reviewable World PR for the controlled Acme scenario. This tool never approves or executes it.",
    { request: z.string().trim().min(1).max(2000) },
    async ({ request }) => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${backendToken}`,
            "content-type": "application/json",
            "idempotency-key": createOpaqueId("idem_"),
          },
          body: JSON.stringify({ request }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsedError = ApiErrorResponseSchema.safeParse(body);
          const message = parsedError.success
            ? `${parsedError.data.error.code}: ${parsedError.data.error.message}`
            : "The backend rejected the request without a valid error response.";
          return { isError: true, content: [{ type: "text" as const, text: message }] };
        }
        const result = CreateWorldPrResponseSchema.parse(body);
        const safeToolResult = { worldPrId: result.worldPrId, status: result.status, reviewUrl: result.reviewUrl };
        return { content: [{ type: "text" as const, text: JSON.stringify(safeToolResult) }] };
      } catch {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "The authenticated Rewind backend could not be reached safely." }],
        };
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The MCP server could not start safely.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
