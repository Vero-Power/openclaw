import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CompanyContextFirestoreLike } from "../observers/external-context/company-context.js";

export interface PersonDirectoryEntry {
  email: string;
  slack_id: string | null;
  display_name: string | null;
  source: "firestore_owner" | "firestore_sales_rep" | "library_profile";
  evidence_count: number;
  notes: string | null;
}

export interface BuildPeopleDirectoryDeps {
  firestoreClient: CompanyContextFirestoreLike;
  libPath: string;
  userAliases: Record<string, string>;
}

interface LibraryProfile {
  email: string;
  display_name: string | null;
  notes: string | null;
}

function parseLibraryProfiles(libPath: string): LibraryProfile[] {
  const peopleDir = join(libPath, "people");
  if (!existsSync(peopleDir)) {
    return [];
  }
  const entries = readdirSync(peopleDir).filter((f) => f.endsWith(".md"));
  const out: LibraryProfile[] = [];
  for (const file of entries) {
    let content: string;
    try {
      content = readFileSync(join(peopleDir, file), "utf8");
    } catch {
      continue;
    }
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
      continue;
    }
    const frontmatter = match[1];
    const emailMatch = frontmatter.match(/^email:\s*(.+)$/m);
    if (!emailMatch) {
      continue;
    }
    const email = emailMatch[1].trim();
    if (!email) {
      continue;
    }
    const displayMatch = frontmatter.match(/^display_name:\s*(.+)$/m);
    const notesMatch = frontmatter.match(/^notes:\s*(.+)$/m);
    out.push({
      email,
      display_name: displayMatch ? displayMatch[1].trim() : null,
      notes: notesMatch ? notesMatch[1].trim() : null,
    });
  }
  return out;
}

export async function buildPeopleDirectory(
  deps: BuildPeopleDirectoryDeps,
): Promise<PersonDirectoryEntry[]> {
  const byEmail = new Map<string, PersonDirectoryEntry>();

  const assignees = await deps.firestoreClient.listProjectAssignees();
  for (const row of assignees) {
    if (row.owner_email) {
      const email = row.owner_email;
      const existing = byEmail.get(email);
      if (existing) {
        existing.evidence_count++;
      } else {
        byEmail.set(email, {
          email,
          slack_id: deps.userAliases[email] ?? null,
          display_name: null,
          source: "firestore_owner",
          evidence_count: 1,
          notes: null,
        });
      }
    }
    if (row.sales_rep_email) {
      const email = row.sales_rep_email;
      const existing = byEmail.get(email);
      if (existing) {
        existing.evidence_count++;
      } else {
        byEmail.set(email, {
          email,
          slack_id: deps.userAliases[email] ?? null,
          display_name: null,
          source: "firestore_sales_rep",
          evidence_count: 1,
          notes: null,
        });
      }
    }
  }

  const profiles = parseLibraryProfiles(deps.libPath);
  for (const profile of profiles) {
    const existing = byEmail.get(profile.email);
    if (existing) {
      existing.display_name = profile.display_name ?? existing.display_name;
      existing.notes = profile.notes ?? existing.notes;
    } else {
      byEmail.set(profile.email, {
        email: profile.email,
        slack_id: deps.userAliases[profile.email] ?? null,
        display_name: profile.display_name,
        source: "library_profile",
        evidence_count: 0,
        notes: profile.notes,
      });
    }
  }

  return Array.from(byEmail.values());
}
