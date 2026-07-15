import { describe, expect, it, vi } from "vitest";
import { verifyOpenAiAccess } from "@/scripts/verify-openai-access";

const model = "gpt-5.6-sol";
const key = "unit-test-openai-key-that-must-never-be-printed";

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

describe("OpenAI access verifier", () => {
  it("fails closed without making a provider request when configuration is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(verifyOpenAiAccess({}, fetchMock)).resolves.toEqual({ status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when either key or model is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(verifyOpenAiAccess({ OPENAI_MODEL: model }, fetchMock)).resolves.toEqual({
      status: "failed",
      model,
    });
    await expect(verifyOpenAiAccess({ OPENAI_API_KEY: key }, fetchMock)).resolves.toEqual({ status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects surrounding whitespace instead of silently changing configuration", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(verifyOpenAiAccess({ OPENAI_API_KEY: key, OPENAI_MODEL: ` ${model}` }, fetchMock)).resolves.toEqual({
      status: "failed",
    });
    await expect(verifyOpenAiAccess({ OPENAI_API_KEY: ` ${key}`, OPENAI_MODEL: model }, fetchMock)).resolves.toEqual({
      status: "failed",
      model,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks exactly the configured model with a GET and no request body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, { id: model, object: "model" }));

    await expect(verifyOpenAiAccess({ OPENAI_API_KEY: key, OPENAI_MODEL: model }, fetchMock)).resolves.toEqual({
      status: "ok",
      model,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`);
    expect(init).toMatchObject({ method: "GET" });
    expect(init).not.toHaveProperty("body");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
  });

  it("does not silently accept a different model returned by the provider", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, { id: "some-other-model" }));

    await expect(verifyOpenAiAccess({ OPENAI_API_KEY: key, OPENAI_MODEL: model }, fetchMock)).resolves.toEqual({
      status: "failed",
      model,
    });
  });

  it("collapses non-success, malformed, and network responses without provider details", async () => {
    const providerError = `provider detail containing ${key}`;
    const cases = [
      vi.fn<typeof fetch>().mockResolvedValue(response(403, { error: { message: providerError } })),
      vi.fn<typeof fetch>().mockResolvedValue(response(200, { id: "wrong-model", error: providerError })),
      vi.fn<typeof fetch>().mockRejectedValue(new Error(providerError)),
    ];

    for (const fetchMock of cases) {
      const result = await verifyOpenAiAccess({ OPENAI_API_KEY: key, OPENAI_MODEL: model }, fetchMock);
      expect(result).toEqual({ status: "failed", model });
      expect(JSON.stringify(result)).not.toContain(key);
      expect(JSON.stringify(result)).not.toContain(providerError);
    }
  });

  it("can be imported without invoking fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
