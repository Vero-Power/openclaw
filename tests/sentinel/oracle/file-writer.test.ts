import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { writePerPersonFile, slugForEmail } from "../../../src/sentinel/oracle/file-writer.js";
import type { Recommendation } from "../../../src/sentinel/oracle/store.js";

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: overrides.id ?? "r1",
    title: overrides.title ?? "Do the thing",
    rationale: overrides.rationale ?? "because",
    evidence: overrides.evidence ?? [],
    assignee_email: overrides.assignee_email ?? "kaleb@example.com",
    assignee_slack_id: overrides.assignee_slack_id ?? null,
    scope: overrides.scope ?? "ops",
    urgency: overrides.urgency ?? "medium",
    confidence: overrides.confidence ?? "medium",
    generated_at: overrides.generated_at ?? 1_700_000_000_000,
  };
}

describe("slugForEmail", () => {
  it("returns the local-part lowercased and non-alphanumerics replaced with dashes", () => {
    expect(slugForEmail("Kaleb.Lundquist@blytzpay.com")).toBe("kaleb-lundquist");
    expect(slugForEmail("ridge@veropwr.com")).toBe("ridge");
    expect(slugForEmail("thomas_morrow@veropwr.com")).toBe("thomas-morrow");
  });
});

describe("writePerPersonFile", () => {
  let libPath: string;

  beforeEach(() => {
    libPath = join(tmpdir(), `jr-lib-fw-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(libPath, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(libPath)) {
      rmSync(libPath, { recursive: true, force: true });
    }
  });

  it("writes a file at recommendations/<slug>.md with YAML frontmatter + sections by urgency", () => {
    const recs = [
      rec({ id: "h1", title: "High thing", urgency: "high" }),
      rec({ id: "m1", title: "Medium thing", urgency: "medium" }),
      rec({ id: "l1", title: "Low thing", urgency: "low" }),
    ];
    const path = writePerPersonFile(libPath, "kaleb@example.com", recs);
    expect(path).toBe(join(libPath, "recommendations", "kaleb.md"));
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("---");
    expect(content).toContain("total_actions: 3");
    expect(content).toContain("## High urgency");
    expect(content).toContain("## Medium urgency");
    expect(content).toContain("## Low urgency");
    expect(content).toContain("High thing");
    expect(content).toContain("Medium thing");
    expect(content).toContain("Low thing");
    // High should appear before low
    expect(content.indexOf("High thing")).toBeLessThan(content.indexOf("Low thing"));
  });

  it("renders an empty-state file when recs is empty", () => {
    const path = writePerPersonFile(libPath, "nobody@example.com", []);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("total_actions: 0");
    expect(content).toContain("Nothing on your plate");
  });

  it("creates the recommendations directory if missing", () => {
    const recsDir = join(libPath, "recommendations");
    expect(existsSync(recsDir)).toBe(false);
    writePerPersonFile(libPath, "kaleb@example.com", [rec()]);
    expect(existsSync(recsDir)).toBe(true);
  });

  it("is idempotent — full rewrite, second call replaces the first", () => {
    writePerPersonFile(libPath, "kaleb@example.com", [rec({ id: "x", title: "Old action" })]);
    writePerPersonFile(libPath, "kaleb@example.com", [rec({ id: "y", title: "New action" })]);
    const content = readFileSync(join(libPath, "recommendations", "kaleb.md"), "utf8");
    expect(content).not.toContain("Old action");
    expect(content).toContain("New action");
  });
});
