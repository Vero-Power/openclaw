import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Curator } from "../../src/sentinel/curator.js";
import { ensureLibrarySkeleton } from "../../src/sentinel/library.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

let libPath: string;

describe("Curator", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-cur-"));
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("files a pattern insight under insights/patterns/", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({ relPath: "insights/patterns/bom-volume-weekly.md" }),
      ),
    };
    const cur = new Curator(llm);
    const result = await cur.fileInsight(
      {
        category: "pattern",
        summary: "BOM volume up 23% WoW",
        evidence: "62 vs 50",
        derived_from: [1],
        confidence: 0.85,
        generated_at: Date.now(),
      },
      libPath,
    );
    expect(result.filedTo).toBe("insights/patterns/bom-volume-weekly.md");
    const full = join(libPath, result.filedTo);
    expect(existsSync(full)).toBe(true);
    const content = readFileSync(full, "utf-8");
    expect(content).toContain("BOM volume up 23%");
    expect(content).toContain("62 vs 50");
  });

  it("appends a new section when the target file already exists", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({ relPath: "insights/patterns/bom-volume-weekly.md" }),
      ),
    };
    const cur = new Curator(llm);
    await cur.fileInsight(
      {
        category: "pattern",
        summary: "First insight",
        evidence: "5 things",
        derived_from: [1],
        confidence: 0.7,
        generated_at: Date.now(),
      },
      libPath,
    );
    await cur.fileInsight(
      {
        category: "pattern",
        summary: "Second insight",
        evidence: "7 things",
        derived_from: [2],
        confidence: 0.7,
        generated_at: Date.now(),
      },
      libPath,
    );
    const content = readFileSync(join(libPath, "insights/patterns/bom-volume-weekly.md"), "utf-8");
    expect(content).toContain("First insight");
    expect(content).toContain("Second insight");
  });

  it("falls back to a generic path if the LLM router fails", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => "not-json"),
    };
    const cur = new Curator(llm);
    const result = await cur.fileInsight(
      {
        category: "pattern",
        summary: "Some pattern",
        evidence: "3 things",
        derived_from: [],
        confidence: 0.5,
        generated_at: Date.now(),
      },
      libPath,
    );
    expect(result.filedTo).toMatch(/^insights\/patterns\/.+\.md$/);
    expect(existsSync(join(libPath, result.filedTo))).toBe(true);
  });
});
