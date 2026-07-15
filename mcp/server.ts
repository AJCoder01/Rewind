import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ApiErrorResponseSchema, CreateWorldPrResponseSchema, McpWorldPrStatusSchema, OpaqueIdSchema } from "@/lib/contracts/v1";
import { createOpaqueId } from "@/lib/domain/ids";
import { loadMcpEnvironment } from "@/lib/config/environment";

type FetchLike = typeof fetch;

export function createRewindMcpServer(fetchImpl: FetchLike = fetch): McpServer {
  const config = loadMcpEnvironment();
  const backendToken = config.MCP_BACKEND_TOKEN;
  const appBaseUrl = config.APP_BASE_URL;
  const endpoint = new URL("/api/v1/world-prs", appBaseUrl);

  const server = new McpServer({ name: "rewind", version: "0.1.0" });
  server.tool(
    "create_world_pr",
    "Create a reviewable World PR for the controlled Acme scenario. This tool never approves or executes it.",
    { request: z.string().trim().min(1).max(2000) },
    async ({ request }) => {
      const idempotencyKey = createOpaqueId("idem_");
      try {
        const response = await fetchWithOneNetworkRetry(fetchImpl, endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${backendToken}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ request }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) return errorToolResult(body);
        const result = CreateWorldPrResponseSchema.parse(body);
        const safeToolResult = {
          worldPrId: result.worldPrId,
          status: result.status,
          reviewUrl: result.reviewUrl,
          ...(result.status === "clarification_required" ? { clarification: result.clarification } : {}),
          ...(result.replayPending ? { replayPending: true as const } : {}),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(safeToolResult) }] };
      } catch {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "The authenticated Rewind backend could not be reached safely." }],
        };
      }
    },
  );

  server.tool(
    "get_world_pr_status",
    "Read the safe status of a World PR. This tool is read-only and cannot approve or execute it.",
    { worldPrId: OpaqueIdSchema },
    async ({ worldPrId }) => {
      try {
        const endpointForStatus = new URL(`/api/v1/world-prs/${encodeURIComponent(worldPrId)}/status`, appBaseUrl);
        const response = await fetchImpl(endpointForStatus, {
          method: "GET",
          headers: { authorization: `Bearer ${backendToken}` },
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) return errorToolResult(body);
        const result = McpWorldPrStatusSchema.parse(body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "The authenticated Rewind backend could not be reached safely." }],
        };
      }
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createRewindMcpServer();
  await server.connect(new StdioServerTransport());
}

async function fetchWithOneNetworkRetry(fetchImpl: FetchLike, input: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (firstError) {
    try {
      return await fetchImpl(input, init);
    } catch {
      throw firstError;
    }
  }
}

function errorToolResult(body: unknown): { isError: true; content: [{ type: "text"; text: string }] } {
  const parsedError = ApiErrorResponseSchema.safeParse(body);
  const message = parsedError.success
    ? `${parsedError.data.error.code}: ${parsedError.data.error.message}`
    : "The backend rejected the request without a valid safe error response.";
  return { isError: true, content: [{ type: "text", text: message }] };
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  runMcpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The MCP server could not start safely.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
