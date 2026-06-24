export type Doc = { _id: string } & Record<string, unknown>;

export function formatCollections(collections: string[]): string {
  if (collections.length === 0) {
    return "No collections found.";
  }
  return `${collections.length} collections: ${collections.join(", ")}`;
}

export function formatKeys(collection: string, keys: string[], sampleDocs: Doc[]): string {
  const head = `${collection} — ${keys.length} fields: ${keys.join(", ")}`;
  if (sampleDocs.length === 0) {
    return `${head}\nNo sample docs available.`;
  }
  const sampleLines = sampleDocs.slice(0, 3).map((d) => `  - ${JSON.stringify(d).slice(0, 200)}`);
  return `${head}\nSample (${Math.min(3, sampleDocs.length)} of ${sampleDocs.length}):\n${sampleLines.join("\n")}`;
}

export function formatDoc(collection: string, id: string, doc: Doc | null): string {
  if (!doc) {
    return `${collection}/${id} — not found.`;
  }
  return `${collection}/${id}:\n\`\`\`json\n${JSON.stringify(doc, null, 2).slice(0, 800)}\n\`\`\``;
}

export function formatQueryDocs(collection: string, docs: Doc[], totalReturned: number): string {
  if (docs.length === 0) {
    return `${collection} — query returned 0 docs.`;
  }
  const visible = docs.slice(0, 5);
  const more =
    totalReturned > visible.length ? `\n(${totalReturned - visible.length} more not shown)` : "";
  const lines = visible.map((d) => `  - ${JSON.stringify(d).slice(0, 150)}`);
  return `${collection} — ${totalReturned} docs:\n${lines.join("\n")}${more}`;
}

export function formatCount(collection: string, count: number): string {
  return `${collection} — ${count} docs match.`;
}
