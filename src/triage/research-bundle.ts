const MAX_BUNDLE_BYTES = 50_000;
const TRUNCATED_SUMMARY_CHARS = 500;

export interface BundleEntry {
  step_idx: number;
  action: string;
  args: Record<string, unknown>;
  status: "success" | "error";
  result?: unknown;
  error?: string;
  invoked_at: number;
}

export interface ResearchBundle {
  entries: BundleEntry[];
  truncated: boolean;
  total_bytes: number;
}

export function emptyBundle(): ResearchBundle {
  return { entries: [], truncated: false, total_bytes: 0 };
}

function entryBytes(entry: BundleEntry): number {
  return Buffer.byteLength(JSON.stringify(entry), "utf8");
}

function truncatedEntry(entry: BundleEntry): BundleEntry {
  const serialized = entry.result === undefined ? "" : JSON.stringify(entry.result);
  return {
    ...entry,
    result: {
      _truncated: true,
      summary: serialized.slice(0, TRUNCATED_SUMMARY_CHARS),
    },
  };
}

export function appendEntry(bundle: ResearchBundle, entry: BundleEntry): ResearchBundle {
  const projected = bundle.total_bytes + entryBytes(entry);
  if (projected <= MAX_BUNDLE_BYTES) {
    return {
      entries: [...bundle.entries, entry],
      truncated: bundle.truncated,
      total_bytes: projected,
    };
  }
  const trunc = truncatedEntry(entry);
  const truncBytes = entryBytes(trunc);
  return {
    entries: [...bundle.entries, trunc],
    truncated: true,
    total_bytes: bundle.total_bytes + truncBytes,
  };
}

export function serializeBundleForPrompt(bundle: ResearchBundle): string {
  if (bundle.entries.length === 0) {
    return "(no research bundle — no actions ran)";
  }
  const blocks = bundle.entries.map((e) => {
    const header = `--- step ${e.step_idx} | action: ${e.action} | status: ${e.status} ---`;
    const argsLine = `args: ${JSON.stringify(e.args)}`;
    const body =
      e.status === "error"
        ? `error: ${e.error ?? "(no message)"}`
        : `result: ${JSON.stringify(e.result)}`;
    return `${header}\n${argsLine}\n${body}`;
  });
  const trailer = bundle.truncated
    ? "\n(NOTE: some results were truncated to fit the 50KB bundle cap)"
    : "";
  return blocks.join("\n\n") + trailer;
}

export function serializeBundleForStorage(bundle: ResearchBundle): string {
  return JSON.stringify(bundle);
}

export function deserializeBundleFromStorage(raw: string | null): ResearchBundle {
  if (raw === null) {
    return emptyBundle();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "entries" in parsed &&
      Array.isArray((parsed as ResearchBundle).entries)
    ) {
      return parsed as ResearchBundle;
    }
    return emptyBundle();
  } catch {
    return emptyBundle();
  }
}
