import { describe, expect, it } from "vitest";
import { scanClientText } from "@/scripts/verify-client-bundle";

describe("client bundle security check", () => {
  it("rejects private environment names without exposing values", () => {
    expect(scanClientText("chunk.js", "const field = 'REWIND_SESSION_SECRET';")).toEqual([
      { file: "chunk.js", rule: "client-private-environment-name" },
    ]);
  });

  it("allows a synthetic fixture bundle", () => {
    expect(scanClientText("chunk.js", "const status = 'No external effects in this slice';")).toEqual([]);
  });
});
