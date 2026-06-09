import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const SEED_FOLDERS = [
  "people",
  "projects",
  "operations",
  "insights/patterns",
  "insights/anomalies",
  "insights/opportunities",
  "insights/friction",
  "reports/daily",
  "reports/weekly",
  "reports/ideas",
  "threads",
];

export function ensureLibrarySkeleton(libPath: string): void {
  if (!existsSync(libPath)) {
    mkdirSync(libPath, { recursive: true });
  }
  for (const folder of SEED_FOLDERS) {
    const full = join(libPath, folder);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
    }
  }
  const indexPath = join(libPath, "INDEX.md");
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, "# JR's Library — Index\n\n_(auto-regenerated each cycle)_\n");
  }
}

interface FileEntry {
  relPath: string;
  title: string | null;
  summary: string | null;
  tags: string[];
}

function walkMd(dir: string, baseDir: string, out: FileEntry[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(full, baseDir, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "INDEX.md") {
      continue;
    }
    const rel = relative(baseDir, full);
    const content = readFileSync(full, "utf-8");
    const fm = parseFrontmatter(content);
    out.push({
      relPath: rel,
      title: fm.title ?? null,
      summary: fm.summary ?? null,
      tags: fm.tags ?? [],
    });
  }
}

function parseFrontmatter(content: string): {
  title?: string;
  summary?: string;
  tags?: string[];
} {
  if (!content.startsWith("---")) {
    return {};
  }
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return {};
  }
  const block = content.slice(3, endIdx).trim();
  const result: { title?: string; summary?: string; tags?: string[] } = {};
  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (key === "title") {
      result.title = value;
    } else if (key === "summary") {
      result.summary = value;
    } else if (key === "tags") {
      // Naive [a, b, c] parsing
      value = value.replace(/^\[|\]$/g, "");
      result.tags = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return result;
}

export function regenerateIndex(libPath: string): void {
  const files: FileEntry[] = [];
  walkMd(libPath, libPath, files);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const lines: string[] = [
    "# JR's Library — Index",
    "",
    `_Auto-regenerated ${new Date().toISOString()} — ${files.length} files_`,
    "",
  ];

  let currentFolder = "";
  for (const f of files) {
    const folder = f.relPath.includes("/") ? f.relPath.split("/")[0] : "(root)";
    if (folder !== currentFolder) {
      currentFolder = folder;
      lines.push(`## ${folder}`, "");
    }
    const display = f.title ?? f.relPath;
    const summary = f.summary ? ` — ${f.summary}` : "";
    lines.push(`- [${display}](${f.relPath})${summary}`);
  }
  lines.push("");

  writeFileSync(join(libPath, "INDEX.md"), lines.join("\n"));
}
