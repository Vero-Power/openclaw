import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensureLibrarySkeleton, regenerateIndex } from "../../src/sentinel/library.js";

let libPath: string;

describe("library helpers", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-"));
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("ensureLibrarySkeleton creates the seeded folder structure", () => {
    ensureLibrarySkeleton(libPath);
    expect(existsSync(join(libPath, "people"))).toBe(true);
    expect(existsSync(join(libPath, "projects"))).toBe(true);
    expect(existsSync(join(libPath, "operations"))).toBe(true);
    expect(existsSync(join(libPath, "insights/patterns"))).toBe(true);
    expect(existsSync(join(libPath, "insights/anomalies"))).toBe(true);
    expect(existsSync(join(libPath, "insights/opportunities"))).toBe(true);
    expect(existsSync(join(libPath, "insights/friction"))).toBe(true);
    expect(existsSync(join(libPath, "reports/daily"))).toBe(true);
    expect(existsSync(join(libPath, "reports/weekly"))).toBe(true);
    expect(existsSync(join(libPath, "reports/ideas"))).toBe(true);
    expect(existsSync(join(libPath, "threads"))).toBe(true);
    expect(existsSync(join(libPath, "INDEX.md"))).toBe(true);
  });

  it("ensureLibrarySkeleton is idempotent", () => {
    ensureLibrarySkeleton(libPath);
    expect(() => ensureLibrarySkeleton(libPath)).not.toThrow();
  });

  it("regenerateIndex lists every .md file under the library", () => {
    ensureLibrarySkeleton(libPath);
    // Drop a couple of files with frontmatter
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      join(libPath, "people/ridge-payne.md"),
      "---\ntitle: Ridge Payne\nsummary: Vero CEO\ntags: [people, leadership]\n---\n\n# Ridge\n",
    );
    fs.writeFileSync(
      join(libPath, "insights/patterns/bom-volume.md"),
      "---\ntitle: BOM volume trend\nsummary: 23% WoW growth\ntags: [pattern, bom]\n---\n",
    );

    regenerateIndex(libPath);

    const indexContent = readFileSync(join(libPath, "INDEX.md"), "utf-8");
    expect(indexContent).toContain("people/ridge-payne.md");
    expect(indexContent).toContain("Vero CEO");
    expect(indexContent).toContain("insights/patterns/bom-volume.md");
    expect(indexContent).toContain("23% WoW growth");
  });
});
