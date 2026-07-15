import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("S017 accessibility and testability contract", () => {
  it("keeps the frozen stable selectors on the three current screens", () => {
    const composer = read("app/page.tsx");
    const login = read("app/login/page.tsx");
    const review = read("app/pr/[worldPrId]/page.tsx");
    for (const selector of ["composer-screen", "composer-request", "create-world-pr", "fixture-status"]) expect(composer).toContain(`data-testid=\"${selector}\"`);
    for (const selector of ["login-screen", "dashboard-passcode", "login-submit"]) expect(login).toContain(`data-testid=\"${selector}\"`);
    for (const selector of ["review-screen", "assumption-panel", "planned-actions", "review-timeline", "fixture-mode-notice"]) expect(review).toContain(`data-testid=\"${selector}\"`);
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
    expect(styles).toContain("textarea:focus-visible, input:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("animation-duration: .01ms");
    expect(styles).toContain("outline: 3px solid #c69338");
  });
});
