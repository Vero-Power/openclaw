import { describe, it, expect } from "vitest";
import {
  appendEntry,
  emptyBundle,
  serializeBundleForPrompt,
  serializeBundleForStorage,
  deserializeBundleFromStorage,
  type BundleEntry,
} from "../../src/triage/research-bundle.js";

function makeEntry(overrides: Partial<BundleEntry> = {}): BundleEntry {
  return {
    step_idx: 0,
    action: "firestoreCount",
    args: { collection: "vero_projects" },
    status: "success",
    result: { collection: "vero_projects", count: 224 },
    invoked_at: 1000,
    ...overrides,
  };
}

describe("research-bundle", () => {
  it("appends entries and tracks total_bytes", () => {
    const b1 = appendEntry(emptyBundle(), makeEntry());
    expect(b1.entries).toHaveLength(1);
    expect(b1.total_bytes).toBeGreaterThan(0);
    expect(b1.truncated).toBe(false);
  });

  it("truncates oversized result fields when total exceeds 50KB", () => {
    let bundle = emptyBundle();
    const bigBlob = "x".repeat(60_000);
    bundle = appendEntry(bundle, makeEntry({ step_idx: 0, result: { big: bigBlob } }));
    expect(bundle.truncated).toBe(true);
    expect((bundle.entries[0].result as Record<string, unknown>)["_truncated"]).toBe(true);
  });

  it("preserves earlier entries when a later one would exceed the cap", () => {
    let bundle = emptyBundle();
    bundle = appendEntry(bundle, makeEntry({ step_idx: 0, result: { count: 1 } }));
    const bigBlob = "y".repeat(60_000);
    bundle = appendEntry(bundle, makeEntry({ step_idx: 1, result: { big: bigBlob } }));
    expect(bundle.entries).toHaveLength(2);
    expect(bundle.entries[0].result).toEqual({ count: 1 });
    expect((bundle.entries[1].result as Record<string, unknown>)["_truncated"]).toBe(true);
  });

  it("serializeBundleForPrompt renders each entry as a labeled block", () => {
    const b = appendEntry(
      appendEntry(emptyBundle(), makeEntry({ step_idx: 0 })),
      makeEntry({
        step_idx: 1,
        action: "firestoreQuery",
        result: { docs: [{ _id: "a", name: "A" }] },
      }),
    );
    const out = serializeBundleForPrompt(b);
    expect(out).toContain("step 0");
    expect(out).toContain("firestoreCount");
    expect(out).toContain("step 1");
    expect(out).toContain("firestoreQuery");
    expect(out).toContain("vero_projects");
  });

  it("serialize + deserialize round-trip preserves entries + flags", () => {
    const b = appendEntry(emptyBundle(), makeEntry());
    const json = serializeBundleForStorage(b);
    const restored = deserializeBundleFromStorage(json);
    expect(restored.entries).toHaveLength(1);
    expect(restored.entries[0].action).toBe("firestoreCount");
    expect(restored.truncated).toBe(false);
  });

  it("deserialize handles null + invalid JSON gracefully", () => {
    expect(deserializeBundleFromStorage(null).entries).toEqual([]);
    expect(deserializeBundleFromStorage("not json").entries).toEqual([]);
  });
});
