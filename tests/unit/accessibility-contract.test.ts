import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.match(/[a-f0-9]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255);
    if (!channels || channels.length !== 3) throw new Error("Expected a six-digit hex color.");
    const [red, green, blue] = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("S017 accessibility and testability contract", () => {
  it("keeps the frozen stable selectors on the three current screens", () => {
    const composer = read("app/page.tsx");
    const connection = read("app/components/connection-preflight-panel.tsx");
    const login = read("app/login/page.tsx");
    const review = read("app/pr/[worldPrId]/page.tsx");
    const execution = read("app/components/execution-timeline.tsx");
    for (const selector of ["composer-screen", "composer-request", "create-world-pr", "fixture-status"]) expect(composer).toContain(`data-testid=\"${selector}\"`);
    for (const selector of ["connection-preflight", "connection-summary", "preflight-summary", "model-runtime"]) expect(connection).toContain(`data-testid=\"${selector}\"`);
    for (const selector of ["login-screen", "dashboard-passcode", "login-submit"]) expect(login).toContain(`data-testid=\"${selector}\"`);
    for (const selector of ["review-screen", "assumption-panel", "planned-actions", "review-timeline", "fixture-mode-notice", "clarification-panel"]) expect(review).toContain(`data-testid=\"${selector}\"`);
    expect(execution).toContain('data-testid="execution-timeline"');
    expect(composer).toContain("Exact dashboard approval");
    expect(review).toContain("this deterministic review cannot approve or execute");
  });

  it("keeps semantic status/error labels, visible focus, and reduced-motion rules", () => {
    const composer = read("app/page.tsx");
    const login = read("app/login/page.tsx");
    const review = read("app/pr/[worldPrId]/page.tsx");
    const styles = read("app/globals.css");
    expect(composer).toContain('aria-label="Current slice status"');
    expect(login).toContain('role="alert"');
    expect(review).toContain('aria-live="polite"');
    expect(review).toContain('role="status"');
    expect(review).toContain('aria-live="polite"');
    expect(styles).toContain("textarea:focus-visible, input:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("animation-duration: .01ms");
    expect(styles).toContain("--focus-ring: #000000");
    expect(styles).toContain("outline: 3px solid var(--focus-ring)");
    for (const background of ["#f5f7f2", "#ffffff", "#2c6b4f"]) {
      expect(contrastRatio("#000000", background)).toBeGreaterThanOrEqual(3);
    }
  });
});
