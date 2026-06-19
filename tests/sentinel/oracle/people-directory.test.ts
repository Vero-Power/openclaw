import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import type { CompanyContextFirestoreLike } from "../../../src/sentinel/observers/external-context/company-context.js";
import { buildPeopleDirectory } from "../../../src/sentinel/oracle/people-directory.js";

function tmpLib(): string {
  return join(tmpdir(), `jr-lib-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeFirestoreFake(
  overrides: Partial<CompanyContextFirestoreLike> = {},
): CompanyContextFirestoreLike {
  return {
    countProjectsByField: overrides.countProjectsByField ?? (async () => ({})),
    sumProjectValue: overrides.sumProjectValue ?? (async () => 0),
    countWorkOrdersByStatus: overrides.countWorkOrdersByStatus ?? (async () => ({})),
    listProjectAssignees: overrides.listProjectAssignees ?? (async () => []),
  };
}

describe("buildPeopleDirectory", () => {
  let libPath: string;
  beforeEach(() => {
    libPath = tmpLib();
    mkdirSync(join(libPath, "people"), { recursive: true });
  });
  afterEach(() => {
    if (existsSync(libPath)) {
      rmSync(libPath, { recursive: true, force: true });
    }
  });

  it("returns Firestore-derived assignees with evidence_count aggregating across projects", async () => {
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: "ridge@veropwr.com", sales_rep_email: "thomas.morrow@veropwr.com" },
        { owner_email: "ridge@veropwr.com", sales_rep_email: "thomas.morrow@veropwr.com" },
        { owner_email: "ridge@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({
      firestoreClient: client,
      libPath,
      userAliases: { "ridge@veropwr.com": "URIDGE", "thomas.morrow@veropwr.com": "UTHOMAS" },
    });
    const ridge = dir.find((e) => e.email === "ridge@veropwr.com");
    expect(ridge).toBeDefined();
    expect(ridge?.evidence_count).toBe(3);
    expect(ridge?.slack_id).toBe("URIDGE");
    const thomas = dir.find((e) => e.email === "thomas.morrow@veropwr.com");
    expect(thomas?.evidence_count).toBe(2);
    expect(thomas?.slack_id).toBe("UTHOMAS");
  });

  it("returns library-derived entries from people/*.md frontmatter", async () => {
    writeFileSync(
      join(libPath, "people", "kaleb-lundquist.md"),
      "---\nemail: kaleb.lundquist@blytzpay.com\ndisplay_name: Kaleb Lundquist\nnotes: ops point of contact\n---\n\n# Kaleb\nSome notes.\n",
    );
    const client = makeFirestoreFake();
    const dir = await buildPeopleDirectory({
      firestoreClient: client,
      libPath,
      userAliases: { "kaleb.lundquist@blytzpay.com": "UKALEB" },
    });
    const kaleb = dir.find((e) => e.email === "kaleb.lundquist@blytzpay.com");
    expect(kaleb).toBeDefined();
    expect(kaleb?.display_name).toBe("Kaleb Lundquist");
    expect(kaleb?.notes).toBe("ops point of contact");
    expect(kaleb?.slack_id).toBe("UKALEB");
    expect(kaleb?.source).toBe("library_profile");
  });

  it("merges Firestore + library entries deduped by email, library notes win", async () => {
    writeFileSync(
      join(libPath, "people", "ridge.md"),
      "---\nemail: ridge@veropwr.com\nnotes: CEO, prefers strategic context\n---\n",
    );
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: "ridge@veropwr.com", sales_rep_email: null },
        { owner_email: "ridge@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({
      firestoreClient: client,
      libPath,
      userAliases: { "ridge@veropwr.com": "URIDGE" },
    });
    expect(dir).toHaveLength(1);
    const r = dir[0];
    expect(r.email).toBe("ridge@veropwr.com");
    expect(r.evidence_count).toBe(2);
    expect(r.notes).toBe("CEO, prefers strategic context");
  });

  it("returns null slack_id when alias map has no match", async () => {
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: "unknown@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({ firestoreClient: client, libPath, userAliases: {} });
    expect(dir[0].slack_id).toBeNull();
  });

  it("skips entries with null/empty email", async () => {
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: null, sales_rep_email: null },
        { owner_email: "real@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({ firestoreClient: client, libPath, userAliases: {} });
    expect(dir).toHaveLength(1);
    expect(dir[0].email).toBe("real@veropwr.com");
  });
});
