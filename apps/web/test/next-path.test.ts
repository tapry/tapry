import { describe, expect, it, vi } from "vitest";

// page-auth imports Next's request helpers, which only exist inside a request.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("../src/server/context", () => ({ getServices: async () => ({}) }));

const { safeNext } = await import("../src/server/page-auth");

describe("where to go after signing in", () => {
  it("accepts a path on this server, as the website's plan buttons send it", () => {
    expect(safeNext("/checkout/creator")).toBe("/checkout/creator");
    expect(safeNext("/checkout/own_storage?yearly=1")).toBe("/checkout/own_storage?yearly=1");
    expect(safeNext(["/settings?tab=plan", "/other"])).toBe("/settings?tab=plan");
  });

  it("ignores anything that could lead to another site, or isn't a plain path", () => {
    for (const bad of [
      undefined,
      "",
      "https://evil.example/checkout",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "checkout/creator",
      "/checkout/creator#x",
      "/a b",
      "/x\n/y",
      "/@evil.example",
      "/checkout:evil",
    ]) {
      expect(safeNext(bad as string | undefined), String(bad)).toBeNull();
    }
  });
});
