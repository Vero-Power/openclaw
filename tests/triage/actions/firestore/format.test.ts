import { describe, it, expect } from "vitest";
import {
  formatCollections,
  formatKeys,
  formatDoc,
  formatQueryDocs,
  formatCount,
} from "../../../../src/triage/actions/firestore/format.js";

describe("firestore/format", () => {
  it("formatCollections handles empty + populated", () => {
    expect(formatCollections([])).toBe("No collections found.");
    expect(formatCollections(["a", "b", "c"])).toBe("3 collections: a, b, c");
  });

  it("formatKeys lists fields + a sample doc", () => {
    const out = formatKeys(
      "vero_projects",
      ["id", "name", "status"],
      [{ _id: "abc", name: "Site A", status: "active" }],
    );
    expect(out).toContain("vero_projects");
    expect(out).toContain("id, name, status");
    expect(out).toContain("Site A");
  });

  it("formatDoc handles null (not found) + present", () => {
    expect(formatDoc("vero_projects", "abc", null)).toContain("not found");
    expect(formatDoc("vero_projects", "abc", { _id: "abc", name: "Site A" })).toContain("Site A");
  });

  it("formatQueryDocs caps the rendered list", () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({ _id: `doc-${i}`, name: `name-${i}` }));
    const out = formatQueryDocs("vero_projects", docs, 10);
    expect(out).toContain("vero_projects");
    expect(out).toContain("doc-0");
    expect(out.split("\n").filter((l) => l.includes("doc-")).length).toBeLessThanOrEqual(5);
  });

  it("formatCount reports the value", () => {
    expect(formatCount("vero_projects", 1247)).toContain("1247");
    expect(formatCount("vero_projects", 1247)).toContain("vero_projects");
  });
});
