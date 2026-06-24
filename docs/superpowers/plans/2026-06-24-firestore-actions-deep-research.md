# Firestore Actions + Deep-Research Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 5 read-only Firestore actions the planner playbook already references (`firestoreCollections`, `firestoreKeys`, `firestoreGet`, `firestoreQuery`, `firestoreCount`), wire `research_bundle` to capture full action results instead of 200-char excerpts, and add a single-pass-with-audit-loop so JR judges whether the data it gathered is enough before responding.

**Architecture:** Each action is a thin wrapper over `@google/firestore` returning `{ <data>, _display: <markdown> }`. The Executor still stores `_display` as the per-step excerpt (existing path) but ALSO pushes full results onto a per-session `research_bundle` capped at 50KB. After the initial Executor pass, a new Auditor LLM call decides if the bundle is sufficient; if not, it proposes up to 3 additional steps which run and get appended to the bundle. The Responder reads the full bundle (not just excerpts) so the LLM that talks to the user grounds on real Firestore values.

**Tech Stack:** TypeScript, `@google/firestore` (already a transitive dep via `firebase-admin`), `better-sqlite3`, `zod`, Gemini Flash via existing pi-ai client.

**Branch:** `feat/firestore-actions-deep-research` (already created off main).

**Spec:** `docs/superpowers/specs/2026-06-24-firestore-actions-deep-research-design.md`

---

## Task 1: Firestore client factory + test seam

**Files:**

- Create: `/Users/vero/openclaw/src/triage/actions/firestore/client.ts`
- Test: `/Users/vero/openclaw/tests/triage/actions/firestore/client.test.ts`

Context: Lazy-construct a Firestore client from the existing `GOOGLE_APPLICATION_CREDENTIALS` service account. Mirrors the lazy adapter pattern used in `src/sentinel/embeddings/gemini-adapter.ts`. All 5 actions will use this. The test seam: a `FirestoreLike` interface with the methods we actually use, so per-action tests can inject fakes without needing the real SDK.

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/actions/firestore/client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createFirestoreClientFromAdmin,
  type FirestoreLike,
} from "../../../../src/triage/actions/firestore/client.js";

describe("firestore/client", () => {
  it("createFirestoreClientFromAdmin maps the admin Firestore methods onto FirestoreLike", () => {
    const fakeAdminFirestore = {
      listCollections: async () => [{ id: "vero_projects" }, { id: "coperniq_projects" }],
      collection: (name: string) => ({
        doc: (id: string) => ({ id, ref: `${name}/${id}` }),
        get: async () => ({ docs: [], size: 0 }),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      }),
    };
    const client = createFirestoreClientFromAdmin(fakeAdminFirestore as never);
    expect(typeof client.listCollections).toBe("function");
    expect(typeof client.collection).toBe("function");
  });

  it("FirestoreLike interface compiles with the documented method set", () => {
    // Type-only assertion via a no-op fake — proves the interface surface
    const fake: FirestoreLike = {
      listCollections: async () => [],
      collection: (_: string) => ({
        doc: (_id: string) => ({
          get: async () => ({ exists: false, id: _id, data: () => undefined }),
        }),
        get: async () => ({ docs: [] }),
        where: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ docs: [] }),
                count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
              }),
            }),
          }),
        }),
        orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      }),
    };
    expect(fake).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/client.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/actions/firestore/client.ts`:

```ts
// Narrow surface of Firestore we actually use. Lets tests inject a fake
// without bringing in the real SDK. Mirrors how the embedding-service
// pattern injects a GeminiEmbeddingAdapter.

export interface FirestoreDocSnapshot {
  id: string;
  exists?: boolean;
  data: () => Record<string, unknown> | undefined;
}

export interface FirestoreQuerySnapshot {
  docs: FirestoreDocSnapshot[];
}

export interface FirestoreCountSnapshot {
  data: () => { count: number };
}

export interface FirestoreQueryRef {
  where(field: string, op: string, value: unknown): FirestoreQueryRef;
  orderBy(field: string, direction?: "asc" | "desc"): FirestoreQueryRef;
  limit(n: number): FirestoreQueryRef;
  get(): Promise<FirestoreQuerySnapshot>;
  count(): { get(): Promise<FirestoreCountSnapshot> };
}

export interface FirestoreDocRef {
  get(): Promise<FirestoreDocSnapshot>;
}

export interface FirestoreCollectionRef extends FirestoreQueryRef {
  doc(id: string): FirestoreDocRef;
}

export interface FirestoreLike {
  listCollections(): Promise<Array<{ id: string }>>;
  collection(name: string): FirestoreCollectionRef;
}

// Adapt the @google-cloud/firestore admin SDK to the narrow FirestoreLike
// surface. Identity-shaped pass-through — the SDK already matches.
export function createFirestoreClientFromAdmin(admin: FirestoreLike): FirestoreLike {
  return admin;
}

// Lazy default factory. The first call constructs the admin Firestore via
// GOOGLE_APPLICATION_CREDENTIALS (same SA already used by sentinel/oracle).
let cached: FirestoreLike | null = null;
export async function createDefaultFirestoreClient(): Promise<FirestoreLike> {
  if (cached) {
    return cached;
  }
  const mod = await import("@google-cloud/firestore");
  const Firestore =
    mod.Firestore ?? (mod as { default: { Firestore: typeof mod.Firestore } }).default.Firestore;
  cached = new Firestore() as unknown as FirestoreLike;
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/client.test.ts`
Expected: PASS — 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/firestore/client.ts tests/triage/actions/firestore/client.test.ts
git commit -m "feat(triage): firestore client factory + FirestoreLike test seam

Lazy-imports @google-cloud/firestore and constructs a client from
GOOGLE_APPLICATION_CREDENTIALS — same SA the sentinel + oracle
already use. Narrow FirestoreLike interface lets per-action tests
inject canned fakes without the real SDK."
```

---

## Task 2: Shared `_display` formatters

**Files:**

- Create: `/Users/vero/openclaw/src/triage/actions/firestore/format.ts`
- Test: `/Users/vero/openclaw/tests/triage/actions/firestore/format.test.ts`

Context: Each action needs to produce a markdown `_display` excerpt for the per-step log. Centralize formatting so all 5 actions render consistently.

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/actions/firestore/format.test.ts`:

```ts
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
    // Truncates the visible list (we render the first 5 inline)
    expect(out.split("\n").filter((l) => l.includes("doc-")).length).toBeLessThanOrEqual(5);
  });

  it("formatCount reports the value", () => {
    expect(formatCount("vero_projects", 1247)).toContain("1247");
    expect(formatCount("vero_projects", 1247)).toContain("vero_projects");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/format.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/actions/firestore/format.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/format.test.ts`
Expected: PASS — 5/5 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/firestore/format.ts tests/triage/actions/firestore/format.test.ts
git commit -m "feat(triage): firestore _display formatters

Markdown formatters for each of the 5 read actions (Collections, Keys,
Get, Query, Count). Centralized so the executor's per-step excerpt is
consistent + bounded across all actions."
```

---

## Task 3: `firestoreCollections` action

**Files:**

- Create: `/Users/vero/openclaw/src/triage/actions/firestore/collections.ts`
- Test: `/Users/vero/openclaw/tests/triage/actions/firestore/collections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/actions/firestore/collections.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { firestoreCollectionsAction } from "../../../../src/triage/actions/firestore/collections.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as ActionContext;
}

describe("firestoreCollections", () => {
  it("returns the list of root collections with a _display string", async () => {
    const fakeClient = {
      listCollections: async () => [{ id: "vero_projects" }, { id: "coperniq_projects" }],
      collection: () => {
        throw new Error("not used");
      },
    };
    const result = await firestoreCollectionsAction.invoke(
      {},
      ctx({ firestoreClientOverride: fakeClient } as Partial<ActionContext> as ActionContext),
    );
    expect(result.collections).toEqual(["vero_projects", "coperniq_projects"]);
    expect(result._display).toContain("2 collections");
    expect(result._display).toContain("vero_projects");
  });

  it("handles empty result", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => {
        throw new Error("not used");
      },
    };
    const result = await firestoreCollectionsAction.invoke(
      {},
      ctx({ firestoreClientOverride: fakeClient } as Partial<ActionContext> as ActionContext),
    );
    expect(result.collections).toEqual([]);
    expect(result._display).toContain("No collections");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/collections.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/actions/firestore/collections.ts`:

```ts
import { z } from "zod";
import type { CatalogAction } from "../types.js";
import { createDefaultFirestoreClient, type FirestoreLike } from "./client.js";
import { formatCollections } from "./format.js";

const ArgsSchema = z.object({}).strict();
type Args = z.infer<typeof ArgsSchema>;

export interface FirestoreCollectionsResult {
  collections: string[];
  _display: string;
}

async function resolveClient(ctx: {
  firestoreClientOverride?: FirestoreLike;
}): Promise<FirestoreLike> {
  if (ctx.firestoreClientOverride) {
    return ctx.firestoreClientOverride;
  }
  return createDefaultFirestoreClient();
}

export const firestoreCollectionsAction: CatalogAction<Args, FirestoreCollectionsResult> = {
  name: "firestoreCollections",
  description:
    "List all root-level Firestore collections. Use when the user asks 'what data do we have' or before deciding which collection to query.",
  args_schema: ArgsSchema,
  idempotent: true,
  external_effect: false,
  estimated_duration_ms: 500,
  invoke: async (_args, ctx) => {
    const client = await resolveClient(ctx as { firestoreClientOverride?: FirestoreLike });
    const cols = await client.listCollections();
    const collections = cols.map((c) => c.id).sort();
    return {
      collections,
      _display: formatCollections(collections),
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/collections.test.ts`
Expected: PASS — 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/firestore/collections.ts tests/triage/actions/firestore/collections.test.ts
git commit -m "feat(triage): firestoreCollections action

Lists root-level Firestore collections. First of the 5 read-only
actions the PR #12 planner playbook already references."
```

---

## Task 4: `firestoreKeys` action

**Files:**

- Create: `/Users/vero/openclaw/src/triage/actions/firestore/keys.ts`
- Test: `/Users/vero/openclaw/tests/triage/actions/firestore/keys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/actions/firestore/keys.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { firestoreKeysAction } from "../../../../src/triage/actions/firestore/keys.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

describe("firestoreKeys", () => {
  it("samples docs and returns the union of field names + sample bodies", async () => {
    const docs = [
      { id: "a", data: () => ({ name: "A", status: "active" }) },
      { id: "b", data: () => ({ name: "B", value: 100 }) },
    ];
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, id: "", data: () => undefined }) }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: (_: number) => ({ get: async () => ({ docs }) }),
        get: async () => ({ docs }),
      }),
    };
    const result = await firestoreKeysAction.invoke(
      { collection: "vero_projects" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(result.collection).toBe("vero_projects");
    expect(new Set(result.keys)).toEqual(new Set(["name", "status", "value"]));
    expect(result.sample_docs).toHaveLength(2);
    expect(result.sample_docs[0]._id).toBe("a");
    expect(result._display).toContain("vero_projects");
    expect(result._display).toContain("name");
  });

  it("respects the sample arg (default 5)", async () => {
    let receivedLimit = -1;
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, id: "", data: () => undefined }) }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: (n: number) => {
          receivedLimit = n;
          return { get: async () => ({ docs: [] }) };
        },
        get: async () => ({ docs: [] }),
      }),
    };
    await firestoreKeysAction.invoke(
      { collection: "x", sample: 10 },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(receivedLimit).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/keys.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/actions/firestore/keys.ts`:

```ts
import { z } from "zod";
import type { CatalogAction } from "../types.js";
import { createDefaultFirestoreClient, type FirestoreLike } from "./client.js";
import { formatKeys, type Doc } from "./format.js";

const ArgsSchema = z
  .object({
    collection: z.string().min(1),
    sample: z.number().int().positive().max(20).default(5),
  })
  .strict();
type Args = z.infer<typeof ArgsSchema>;

export interface FirestoreKeysResult {
  collection: string;
  keys: string[];
  sample_docs: Doc[];
  _display: string;
}

async function resolveClient(ctx: {
  firestoreClientOverride?: FirestoreLike;
}): Promise<FirestoreLike> {
  if (ctx.firestoreClientOverride) {
    return ctx.firestoreClientOverride;
  }
  return createDefaultFirestoreClient();
}

export const firestoreKeysAction: CatalogAction<Args, FirestoreKeysResult> = {
  name: "firestoreKeys",
  description:
    "Sample docs from a Firestore collection and return the union of field names. Use this BEFORE firestoreQuery to learn the schema (so the where/orderBy fields are real).",
  args_schema: ArgsSchema,
  idempotent: true,
  external_effect: false,
  estimated_duration_ms: 800,
  invoke: async (args, ctx) => {
    const client = await resolveClient(ctx as { firestoreClientOverride?: FirestoreLike });
    const snapshot = await client.collection(args.collection).limit(args.sample).get();
    const sample_docs: Doc[] = snapshot.docs.map((d) => ({ _id: d.id, ...(d.data() ?? {}) }));
    const keys = Array.from(
      new Set(sample_docs.flatMap((d) => Object.keys(d).filter((k) => k !== "_id"))),
    ).sort();
    return {
      collection: args.collection,
      keys,
      sample_docs,
      _display: formatKeys(args.collection, keys, sample_docs),
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/keys.test.ts`
Expected: PASS — 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/firestore/keys.ts tests/triage/actions/firestore/keys.test.ts
git commit -m "feat(triage): firestoreKeys action

Schema-introspection action: samples up to N docs from a collection,
returns the union of field names + the sample docs themselves. Planner
uses this before firestoreQuery to know what fields are queryable."
```

---

## Task 5: `firestoreGet` action

**Files:**

- Create: `/Users/vero/openclaw/src/triage/actions/firestore/get.ts`
- Test: `/Users/vero/openclaw/tests/triage/actions/firestore/get.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/actions/firestore/get.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { firestoreGetAction } from "../../../../src/triage/actions/firestore/get.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

describe("firestoreGet", () => {
  it("returns the doc when present", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: (_: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            id,
            exists: true,
            data: () => ({ name: "Site A", status: "active" }),
          }),
        }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        get: async () => ({ docs: [] }),
      }),
    };
    const r = await firestoreGetAction.invoke(
      { collection: "vero_projects", id: "abc" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r.doc).toEqual({ _id: "abc", name: "Site A", status: "active" });
    expect(r._display).toContain("Site A");
  });

  it("returns null when missing", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: (id: string) => ({ get: async () => ({ id, exists: false, data: () => undefined }) }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        get: async () => ({ docs: [] }),
      }),
    };
    const r = await firestoreGetAction.invoke(
      { collection: "vero_projects", id: "missing" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r.doc).toBeNull();
    expect(r._display).toContain("not found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/get.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/actions/firestore/get.ts`:

```ts
import { z } from "zod";
import type { CatalogAction } from "../types.js";
import { createDefaultFirestoreClient, type FirestoreLike } from "./client.js";
import { formatDoc, type Doc } from "./format.js";

const ArgsSchema = z
  .object({
    collection: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();
type Args = z.infer<typeof ArgsSchema>;

export interface FirestoreGetResult {
  collection: string;
  id: string;
  doc: Doc | null;
  _display: string;
}

async function resolveClient(ctx: {
  firestoreClientOverride?: FirestoreLike;
}): Promise<FirestoreLike> {
  if (ctx.firestoreClientOverride) {
    return ctx.firestoreClientOverride;
  }
  return createDefaultFirestoreClient();
}

export const firestoreGetAction: CatalogAction<Args, FirestoreGetResult> = {
  name: "firestoreGet",
  description:
    "Fetch one Firestore document by id. Returns null in `doc` when the document does not exist (still a success — caller may proceed).",
  args_schema: ArgsSchema,
  idempotent: true,
  external_effect: false,
  estimated_duration_ms: 300,
  invoke: async (args, ctx) => {
    const client = await resolveClient(ctx as { firestoreClientOverride?: FirestoreLike });
    const snapshot = await client.collection(args.collection).doc(args.id).get();
    const doc: Doc | null = snapshot.exists
      ? { _id: snapshot.id, ...(snapshot.data() ?? {}) }
      : null;
    return {
      collection: args.collection,
      id: args.id,
      doc,
      _display: formatDoc(args.collection, args.id, doc),
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/get.test.ts`
Expected: PASS — 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/firestore/get.ts tests/triage/actions/firestore/get.test.ts
git commit -m "feat(triage): firestoreGet action

Fetch one Firestore document by id. Returns doc=null on miss (still a
success — caller can branch on it without an exception). Result is
serialized as { _id, ...data } for consistent bundle shape."
```

---

## Task 6: `firestoreQuery` action

**Files:**

- Create: `/Users/vero/openclaw/src/triage/actions/firestore/query.ts`
- Test: `/Users/vero/openclaw/tests/triage/actions/firestore/query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/actions/firestore/query.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { firestoreQueryAction } from "../../../../src/triage/actions/firestore/query.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

function makeQuery(
  received: { where: unknown[]; orderBy: unknown[]; limit: number | null },
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
) {
  const q: {
    where: (f: string, op: string, v: unknown) => typeof q;
    orderBy: (f: string, d?: string) => typeof q;
    limit: (n: number) => typeof q;
    get: () => Promise<{ docs: typeof docs }>;
    count: () => { get: () => Promise<{ data: () => { count: number } }> };
  } = {
    where(f, op, v) {
      received.where.push({ field: f, op, value: v });
      return q;
    },
    orderBy(f, d) {
      received.orderBy.push({ field: f, direction: d ?? "asc" });
      return q;
    },
    limit(n) {
      received.limit = n;
      return q;
    },
    get: async () => ({ docs }),
    count: () => ({ get: async () => ({ data: () => ({ count: docs.length }) }) }),
  };
  return q;
}

describe("firestoreQuery", () => {
  it("applies where + orderBy + limit and returns mapped docs", async () => {
    const received = {
      where: [] as unknown[],
      orderBy: [] as unknown[],
      limit: null as number | null,
    };
    const docs = [
      { id: "a", data: () => ({ name: "A", value: 1 }) },
      { id: "b", data: () => ({ name: "B", value: 2 }) },
    ];
    const fakeClient = {
      listCollections: async () => [],
      collection: () => makeQuery(received, docs),
    };
    const r = await firestoreQueryAction.invoke(
      {
        collection: "vero_projects",
        where: [{ field: "status", op: "==", value: "active" }],
        orderBy: { field: "value", direction: "desc" },
        limit: 5,
      },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(received.where).toEqual([{ field: "status", op: "==", value: "active" }]);
    expect(received.orderBy).toEqual([{ field: "value", direction: "desc" }]);
    expect(received.limit).toBe(5);
    expect(r.docs).toEqual([
      { _id: "a", name: "A", value: 1 },
      { _id: "b", name: "B", value: 2 },
    ]);
    expect(r.total_returned).toBe(2);
    expect(r._display).toContain("vero_projects");
    expect(r._display).toContain("2 docs");
  });

  it("clamps limit to 50", async () => {
    const received = {
      where: [] as unknown[],
      orderBy: [] as unknown[],
      limit: null as number | null,
    };
    const fakeClient = {
      listCollections: async () => [],
      collection: () => makeQuery(received, []),
    };
    await firestoreQueryAction.invoke(
      { collection: "x", limit: 200 },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(received.limit).toBe(50);
  });

  it("defaults limit to 10 when omitted", async () => {
    const received = {
      where: [] as unknown[],
      orderBy: [] as unknown[],
      limit: null as number | null,
    };
    const fakeClient = {
      listCollections: async () => [],
      collection: () => makeQuery(received, []),
    };
    await firestoreQueryAction.invoke(
      { collection: "x" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(received.limit).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/query.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/actions/firestore/query.ts`:

```ts
import { z } from "zod";
import type { CatalogAction } from "../types.js";
import { createDefaultFirestoreClient, type FirestoreLike } from "./client.js";
import { formatQueryDocs, type Doc } from "./format.js";

const WhereClauseSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["==", "!=", "<", "<=", ">", ">=", "in", "array-contains"]),
  value: z.unknown(),
});

const OrderBySchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

const ArgsSchema = z
  .object({
    collection: z.string().min(1),
    where: z.array(WhereClauseSchema).optional(),
    orderBy: OrderBySchema.optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
type Args = z.infer<typeof ArgsSchema>;

export interface FirestoreQueryResult {
  collection: string;
  docs: Doc[];
  total_returned: number;
  _display: string;
}

async function resolveClient(ctx: {
  firestoreClientOverride?: FirestoreLike;
}): Promise<FirestoreLike> {
  if (ctx.firestoreClientOverride) {
    return ctx.firestoreClientOverride;
  }
  return createDefaultFirestoreClient();
}

export const firestoreQueryAction: CatalogAction<Args, FirestoreQueryResult> = {
  name: "firestoreQuery",
  description:
    "Filter + order + limit a Firestore collection. Use after firestoreKeys so the field names are real. limit defaults to 10, max 50.",
  args_schema: ArgsSchema,
  idempotent: true,
  external_effect: false,
  estimated_duration_ms: 800,
  invoke: async (args, ctx) => {
    const client = await resolveClient(ctx as { firestoreClientOverride?: FirestoreLike });
    let q = client.collection(args.collection) as ReturnType<FirestoreLike["collection"]>;
    if (args.where) {
      for (const w of args.where) {
        q = q.where(w.field, w.op, w.value);
      }
    }
    if (args.orderBy) {
      q = q.orderBy(args.orderBy.field, args.orderBy.direction);
    }
    const effectiveLimit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    q = q.limit(effectiveLimit);
    const snapshot = await q.get();
    const docs: Doc[] = snapshot.docs.map((d) => ({ _id: d.id, ...(d.data() ?? {}) }));
    return {
      collection: args.collection,
      docs,
      total_returned: docs.length,
      _display: formatQueryDocs(args.collection, docs, docs.length),
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/query.test.ts`
Expected: PASS — 3/3 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/firestore/query.ts tests/triage/actions/firestore/query.test.ts
git commit -m "feat(triage): firestoreQuery action

Filter + order + limit. Hard-caps limit at 50 to prevent runaway result
sets. Defaults to 10 when omitted. Each where clause supports the
standard Firestore ops (==, !=, <, <=, >, >=, in, array-contains)."
```

---

## Task 7: `firestoreCount` action

**Files:**

- Create: `/Users/vero/openclaw/src/triage/actions/firestore/count.ts`
- Test: `/Users/vero/openclaw/tests/triage/actions/firestore/count.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/actions/firestore/count.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { firestoreCountAction } from "../../../../src/triage/actions/firestore/count.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

describe("firestoreCount", () => {
  it("returns the count from the aggregation snapshot", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, id: "", data: () => undefined }) }),
        where: () => ({
          where: () => ({}),
          orderBy: () => ({}),
          limit: () => ({}),
          get: async () => ({ docs: [] }),
          count: () => ({ get: async () => ({ data: () => ({ count: 42 }) }) }),
        }),
        orderBy: () => ({}),
        limit: () => ({}),
        get: async () => ({ docs: [] }),
        count: () => ({ get: async () => ({ data: () => ({ count: 1247 }) }) }),
      }),
    };
    const r1 = await firestoreCountAction.invoke(
      { collection: "vero_projects" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r1.count).toBe(1247);
    expect(r1._display).toContain("1247");

    const r2 = await firestoreCountAction.invoke(
      { collection: "vero_projects", where: [{ field: "status", op: "==", value: "active" }] },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r2.count).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/count.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/actions/firestore/count.ts`:

```ts
import { z } from "zod";
import type { CatalogAction } from "../types.js";
import { createDefaultFirestoreClient, type FirestoreLike } from "./client.js";
import { formatCount } from "./format.js";

const WhereClauseSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["==", "!=", "<", "<=", ">", ">=", "in", "array-contains"]),
  value: z.unknown(),
});

const ArgsSchema = z
  .object({
    collection: z.string().min(1),
    where: z.array(WhereClauseSchema).optional(),
  })
  .strict();
type Args = z.infer<typeof ArgsSchema>;

export interface FirestoreCountResult {
  collection: string;
  count: number;
  _display: string;
}

async function resolveClient(ctx: {
  firestoreClientOverride?: FirestoreLike;
}): Promise<FirestoreLike> {
  if (ctx.firestoreClientOverride) {
    return ctx.firestoreClientOverride;
  }
  return createDefaultFirestoreClient();
}

export const firestoreCountAction: CatalogAction<Args, FirestoreCountResult> = {
  name: "firestoreCount",
  description:
    "Count docs in a Firestore collection, optionally with where filters. Cheap aggregation — use this instead of firestoreQuery when you only need the count.",
  args_schema: ArgsSchema,
  idempotent: true,
  external_effect: false,
  estimated_duration_ms: 400,
  invoke: async (args, ctx) => {
    const client = await resolveClient(ctx as { firestoreClientOverride?: FirestoreLike });
    let q = client.collection(args.collection) as ReturnType<FirestoreLike["collection"]>;
    if (args.where) {
      for (const w of args.where) {
        q = q.where(w.field, w.op, w.value);
      }
    }
    const snapshot = await q.count().get();
    const count = snapshot.data().count;
    return {
      collection: args.collection,
      count,
      _display: formatCount(args.collection, count),
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/firestore/count.test.ts`
Expected: PASS — 1/1 test green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/firestore/count.ts tests/triage/actions/firestore/count.test.ts
git commit -m "feat(triage): firestoreCount action

Aggregation-only count, with optional where filters. Much cheaper
than firestoreQuery when you just need 'how many'. Last of the 5
read-only actions."
```

---

## Task 8: Register the 5 actions + update registry test

**Files:**

- Modify: `/Users/vero/openclaw/src/triage/actions/index.ts`
- Modify: `/Users/vero/openclaw/tests/triage/actions/registry.test.ts`

- [ ] **Step 1: Read the current registration file**

Run: `cd /Users/vero/openclaw && cat src/triage/actions/index.ts`

Confirm where `bootstrapActionCatalog` registers the existing `coperniqFirestoreIngestAction`.

- [ ] **Step 2: Add the imports + registrations**

In `/Users/vero/openclaw/src/triage/actions/index.ts`, add at the top (alongside existing imports):

```ts
import { firestoreCollectionsAction } from "./firestore/collections.js";
import { firestoreCountAction } from "./firestore/count.js";
import { firestoreGetAction } from "./firestore/get.js";
import { firestoreKeysAction } from "./firestore/keys.js";
import { firestoreQueryAction } from "./firestore/query.js";
```

In the `bootstrapActionCatalog` function, immediately after the existing `reg.register(coperniqFirestoreIngestAction);` line, add:

```ts
reg.register(firestoreCollectionsAction);
reg.register(firestoreKeysAction);
reg.register(firestoreGetAction);
reg.register(firestoreQueryAction);
reg.register(firestoreCountAction);
```

- [ ] **Step 3: Update the registry test**

Modify the existing test in `/Users/vero/openclaw/tests/triage/actions/registry.test.ts` to account for the 5 new actions. Find the `describe("bootstrapActionCatalog", ...)` block.

At the top of that describe block, declare the base set:

```ts
const BASE_ACTIONS = [
  "coperniqFirestoreIngest",
  "firestoreCollections",
  "firestoreKeys",
  "firestoreGet",
  "firestoreQuery",
  "firestoreCount",
];
```

Update each existing test:

```ts
it("with no deps registers the base action set", () => {
  const reg = bootstrapActionCatalog();
  const names = reg.list().map((a) => a.name);
  expect(names).toEqual(expect.arrayContaining(BASE_ACTIONS));
  expect(names).toHaveLength(BASE_ACTIONS.length);
});

it("with empty deps object registers the base action set", () => {
  const reg = bootstrapActionCatalog({});
  const names = reg.list().map((a) => a.name);
  expect(names).toEqual(expect.arrayContaining(BASE_ACTIONS));
  expect(names).toHaveLength(BASE_ACTIONS.length);
});

it("with slackClient but no botToken does not register Slack actions", () => {
  const reg = bootstrapActionCatalog({ slackClient: makeSlackClient() });
  const names = reg.list().map((a) => a.name);
  expect(names).toEqual(expect.arrayContaining(BASE_ACTIONS));
  expect(names).toHaveLength(BASE_ACTIONS.length);
});

it("with both slackClient and botToken registers base + Slack actions", () => {
  const reg = bootstrapActionCatalog({ slackClient: makeSlackClient(), botToken: "xoxb-fake" });
  const names = reg.list().map((a) => a.name);
  for (const n of BASE_ACTIONS) expect(names).toContain(n);
  expect(names).toContain("dm_user");
  expect(names).toContain("post_to_channel");
  expect(names).toContain("reply_in_thread");
  expect(names).toHaveLength(BASE_ACTIONS.length + 3);
});
```

- [ ] **Step 4: Run the registry tests**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/actions/registry.test.ts`
Expected: PASS — all 4 tests green.

Run the broader triage suite for regression:

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage 2>&1 | tail -5`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/actions/index.ts tests/triage/actions/registry.test.ts
git commit -m "feat(triage): register the 5 Firestore read actions in the catalog

Planner playbook (from PR #12) already references these actions in
its prompt. Today the planner generates plans like 'firestoreKeys →
firestoreCount → firestoreQuery' and the executor rejects them as
unknown — every data-shaped DM falls through to chat with a generic
answer. After this commit the actions are live and the playbook works
end-to-end."
```

---

## Task 9: Research bundle module

**Files:**

- Create: `/Users/vero/openclaw/src/triage/research-bundle.ts`
- Test: `/Users/vero/openclaw/tests/triage/research-bundle.test.ts`

Context: Type + helpers for accumulating full action results across an entire triage session. Bounded at 50KB total so a runaway query can't blow the responder's prompt budget.

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/research-bundle.test.ts`:

```ts
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
    expect((bundle.entries[0].result as { _truncated: boolean })._truncated).toBe(true);
  });

  it("preserves earlier entries when a later one would exceed the cap", () => {
    let bundle = emptyBundle();
    bundle = appendEntry(bundle, makeEntry({ step_idx: 0, result: { count: 1 } }));
    const bigBlob = "y".repeat(60_000);
    bundle = appendEntry(bundle, makeEntry({ step_idx: 1, result: { big: bigBlob } }));
    expect(bundle.entries).toHaveLength(2);
    expect(bundle.entries[0].result).toEqual({ count: 1 });
    expect((bundle.entries[1].result as { _truncated: boolean })._truncated).toBe(true);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/research-bundle.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/research-bundle.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/research-bundle.test.ts`
Expected: PASS — 6/6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/research-bundle.ts tests/triage/research-bundle.test.ts
git commit -m "feat(triage): research-bundle module — accumulate full action results

Each entry has the FULL result, not a 200-char excerpt. Bounded at
50KB total: oversized results get replaced with a {_truncated, summary}
marker so the responder LLM still sees they happened. Serialize +
deserialize for triage_sessions.research_bundle persistence.

serializeBundleForPrompt renders the bundle as labeled blocks the
responder can read; this is what makes 'JR cites actual values' work."
```

---

## Task 10: Wire bundle into Executor + session-store

**Files:**

- Modify: `/Users/vero/openclaw/src/triage/executor.ts`
- Modify: `/Users/vero/openclaw/src/triage/session-store.ts`
- Modify: `/Users/vero/openclaw/src/triage/types.ts`
- Test: extend `/Users/vero/openclaw/tests/triage/executor.test.ts` (or matching test file)

Context: The Executor already runs each step and stores a `_display` excerpt. Now it ALSO appends the full result onto a per-session research bundle and persists it on completion.

- [ ] **Step 1: Inspect existing executor + session-store + TriageSession type**

Run: `cd /Users/vero/openclaw && cat src/triage/executor.ts; echo "==="; grep -nE "research_bundle\|TriageSession\|setExecutionLog" src/triage/session-store.ts; echo "==="; grep -nE "research_bundle\|TriageSession" src/triage/types.ts`

Confirm: the `TriageSession` interface in `types.ts` has `research_bundle: unknown`; `session-store.ts` reads/writes `research_bundle` column as JSON. You'll add: `getBundle(request_id) → ResearchBundle` and `setBundle(request_id, bundle)`.

- [ ] **Step 2: Add bundle methods to session-store**

In `/Users/vero/openclaw/src/triage/session-store.ts`, add these imports near the top alongside the existing ones:

```ts
import {
  emptyBundle,
  type ResearchBundle,
  serializeBundleForStorage,
  deserializeBundleFromStorage,
} from "./research-bundle.js";
```

Add these methods to the `SessionStore` class (alongside the existing `setExecutionLog`):

```ts
  getBundle(request_id: string): ResearchBundle {
    const row = this.db
      .prepare("SELECT research_bundle FROM triage_sessions WHERE request_id = ?")
      .get(request_id) as { research_bundle: string | null } | undefined;
    if (!row) {
      return emptyBundle();
    }
    return deserializeBundleFromStorage(row.research_bundle);
  }

  setBundle(request_id: string, bundle: ResearchBundle): void {
    this.db
      .prepare("UPDATE triage_sessions SET research_bundle = ?, updated_at = ? WHERE request_id = ?")
      .run(serializeBundleForStorage(bundle), Date.now(), request_id);
  }
```

- [ ] **Step 3: Modify Executor to capture full results into the bundle**

In `/Users/vero/openclaw/src/triage/executor.ts`, add the imports:

```ts
import { appendEntry, type BundleEntry } from "./research-bundle.js";
```

Replace the existing `executeStepWithRetry` return type and add full-result capture. The function currently returns `{ status, excerpt, retried }`. Change it to ALSO return the full result so the caller can append to the bundle.

Update the return type:

```ts
  private async executeStepWithRetry(
    step: PlanStep,
    request_id: string,
    ctx: ActionContext,
  ): Promise<{
    status: ExecutionLogEntry["status"];
    excerpt: string;
    retried: boolean;
    result?: unknown;
    error?: string;
  }> {
    try {
      const r = await this.deps.registry.invoke(step.action, step.args, ctx);
      return {
        status: "success",
        excerpt: pickExcerpt(r),
        retried: false,
        result: r,
      };
    } catch (err1) {
      try {
        const r = await this.deps.registry.invoke(step.action, step.args, ctx);
        return {
          status: "retried_success",
          excerpt: pickExcerpt(r),
          retried: true,
          result: r,
        };
      } catch (err2) {
        return {
          status: "retried_error",
          excerpt: `${(err1 as Error).message} | retry: ${(err2 as Error).message}`,
          retried: true,
          error: `${(err1 as Error).message} | retry: ${(err2 as Error).message}`,
        };
      }
    }
  }
```

In the main `execute` loop (in the same file), after the line `entry.retried = result.retried;` (around the spot where the executor finalizes each step's log entry), add the bundle append. Find the block that looks like:

```ts
const result = await this.executeStepWithRetry(step, request_id, ctx);
entry.ended_at = Date.now();
entry.status = result.status;
entry.result_excerpt = result.excerpt;
entry.retried = result.retried;
```

Immediately after `entry.retried = result.retried;`, add:

```ts
// Capture FULL result into the research bundle (parallel to the 200-char
// excerpt path above). The responder reads the bundle, not the excerpts,
// so this is what makes JR cite real values.
const bundleBefore = this.deps.store.getBundle(request_id);
const bundleEntry: BundleEntry = {
  step_idx: i,
  action: step.action,
  args: step.args,
  status: result.status === "success" || result.status === "retried_success" ? "success" : "error",
  result: result.result,
  error: result.error,
  invoked_at: entry.started_at,
};
const bundleAfter = appendEntry(bundleBefore, bundleEntry);
this.deps.store.setBundle(request_id, bundleAfter);
```

- [ ] **Step 4: Verify regression**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage 2>&1 | tail -5`
Expected: All tests pass.

If the executor test file has any direct assertions about the return type of `executeStepWithRetry`, update them to allow the new `result?` and `error?` fields.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/executor.ts src/triage/session-store.ts
git commit -m "feat(triage): wire Executor to populate research_bundle with full results

Existing 200-char excerpt path (execution_log) stays — it's still
useful for the debug Slack progress message. In parallel, full action
results now land in research_bundle via appendEntry, capped at 50KB
total. SessionStore gains getBundle/setBundle helpers.

This closes the context-loss gap: previously a firestoreQuery returning
5 docs reached the responder as a 200-char JSON fragment. Now the
responder sees all 5 docs."
```

---

## Task 11: Auditor module

**Files:**

- Create: `/Users/vero/openclaw/src/triage/auditor.ts`
- Test: `/Users/vero/openclaw/tests/triage/auditor.test.ts`

Context: LLM-backed module. Takes (user question, executed plan, current bundle) and decides if JR has enough data to answer. If not, proposes up to 3 additional steps (capped, validated against known action names).

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/auditor.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Auditor } from "../../src/triage/auditor.js";
import type { LlmClient } from "../../src/triage/llm-client.js";
import { appendEntry, emptyBundle } from "../../src/triage/research-bundle.js";
import type { Plan } from "../../src/triage/types.js";

const PLAN: Plan = {
  steps: [{ action: "firestoreCount", args: { collection: "vero_projects" } }],
  confidence: 0.8,
  summary: "count projects",
};

const KNOWN_ACTIONS = new Set([
  "firestoreCollections",
  "firestoreKeys",
  "firestoreGet",
  "firestoreQuery",
  "firestoreCount",
]);

function bundleWithCount(): ReturnType<typeof emptyBundle> {
  return appendEntry(emptyBundle(), {
    step_idx: 0,
    action: "firestoreCount",
    args: { collection: "vero_projects" },
    status: "success",
    result: { count: 224 },
    invoked_at: 1,
  });
}

describe("Auditor", () => {
  it("returns sufficient=true when the LLM says yes", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({ sufficient: true, rationale: "count answers the question" }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "how many projects do we have?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(true);
    expect(out.additional_steps).toBeUndefined();
  });

  it("returns sufficient=false with valid additional_steps", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          sufficient: false,
          rationale: "user wants details on active projects",
          additional_steps: [
            {
              action: "firestoreQuery",
              args: {
                collection: "vero_projects",
                where: [{ field: "status", op: "==", value: "active" }],
              },
            },
          ],
        }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "what are the active projects?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(false);
    expect(out.additional_steps).toHaveLength(1);
    expect(out.additional_steps?.[0]?.action).toBe("firestoreQuery");
  });

  it("filters out additional_steps that reference unknown actions", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          sufficient: false,
          rationale: "needs more",
          additional_steps: [
            { action: "firestoreQuery", args: { collection: "x" } },
            { action: "nonExistentAction", args: {} },
          ],
        }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "details please",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(false);
    expect(out.additional_steps).toHaveLength(1);
    expect(out.additional_steps?.[0]?.action).toBe("firestoreQuery");
  });

  it("caps additional_steps at 3 even if the LLM proposes more", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          sufficient: false,
          rationale: "lots more",
          additional_steps: Array.from({ length: 7 }, () => ({
            action: "firestoreQuery",
            args: { collection: "x" },
          })),
        }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.additional_steps).toHaveLength(3);
  });

  it("degrades to sufficient=true when the LLM throws", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => {
        throw new Error("gemini down");
      }),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(true);
    expect(out.rationale).toMatch(/audit failed|degraded/);
  });

  it("degrades to sufficient=true when the LLM returns malformed JSON", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => "not json at all"),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/auditor.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/auditor.ts`:

````ts
import { z } from "zod";
import type { LlmClient } from "./llm-client.js";
import { serializeBundleForPrompt, type ResearchBundle } from "./research-bundle.js";
import type { Plan, PlanStep } from "./types.js";

const MAX_FOLLOWUP_STEPS = 3;

const AdditionalStepSchema = z.object({
  action: z.string(),
  args: z.record(z.string(), z.unknown()),
  rationale: z.string().optional(),
});

const AuditResponseSchema = z.object({
  sufficient: z.boolean(),
  rationale: z.string(),
  additional_steps: z.array(AdditionalStepSchema).optional(),
});

export interface AuditInput {
  question: string;
  plan: Plan;
  bundle: ResearchBundle;
}

export interface AuditOutput {
  sufficient: boolean;
  rationale: string;
  additional_steps?: PlanStep[];
}

export interface AuditorDeps {
  llm: LlmClient;
  knownActions: Set<string>;
}

function buildPrompt(input: AuditInput): string {
  return `You are JR's research auditor. Decide if JR can give a good answer to the user from what's been gathered, or whether more lookups are needed.

User question: ${JSON.stringify(input.question)}

Plan JR ran:
${JSON.stringify(input.plan, null, 2)}

Results gathered:
${serializeBundleForPrompt(input.bundle)}

Decide:
- sufficient=true if JR can answer well from what's here
- sufficient=false if there's an obvious gap (e.g., user asked for active projects, JR got the count but not the list)

If sufficient=false, propose up to 3 additional_steps using the same Firestore action catalog (firestoreCollections, firestoreKeys, firestoreGet, firestoreQuery, firestoreCount). DO NOT propose actions outside this catalog.

Return JSON only:
{ "sufficient": bool, "rationale": "short why", "additional_steps"?: [ { "action": "...", "args": { ... } } ] }`;
}

export class Auditor {
  constructor(private deps: AuditorDeps) {}

  async audit(input: AuditInput): Promise<AuditOutput> {
    let raw: string;
    try {
      raw = await this.deps.llm.complete(buildPrompt(input), {
        model: "gemini-flash",
        temperature: 0.1,
      });
    } catch (err) {
      return {
        sufficient: true,
        rationale: `audit failed; degraded to one-shot: ${(err as Error).message}`,
      };
    }

    let parsed: z.infer<typeof AuditResponseSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = AuditResponseSchema.parse(JSON.parse(stripped));
    } catch {
      return {
        sufficient: true,
        rationale: "audit returned malformed JSON; degraded to one-shot",
      };
    }

    if (parsed.sufficient) {
      return { sufficient: true, rationale: parsed.rationale };
    }

    const filtered = (parsed.additional_steps ?? [])
      .filter((s) => this.deps.knownActions.has(s.action))
      .slice(0, MAX_FOLLOWUP_STEPS)
      .map((s) => ({ action: s.action, args: s.args, rationale: s.rationale }));

    return {
      sufficient: false,
      rationale: parsed.rationale,
      additional_steps: filtered,
    };
  }
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/auditor.test.ts`
Expected: PASS — 6/6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/auditor.ts tests/triage/auditor.test.ts
git commit -m "feat(triage): Auditor module — gemini-flash decides if research is sufficient

After the Executor's initial pass, the Auditor reads (user question +
plan + bundle) and outputs { sufficient, rationale, additional_steps? }.
Hard-bounded to 3 additional steps and filters out any step referencing
an action not in the registry — defensive against LLM hallucinations.

Degrades to sufficient=true on LLM failure or malformed JSON so we
never block the response on the audit step."
```

---

## Task 12: Audit-replan loop in triage-bridge

**Files:**

- Modify: `/Users/vero/openclaw/src/slack/monitor/triage-bridge.ts`

Context: After the Executor's initial run, call the Auditor; if `sufficient=false` and there are valid `additional_steps`, run them via a second Executor pass (which appends to the bundle). Then proceed to `routeToChat` as before.

- [ ] **Step 1: Inspect current triage-bridge structure**

Run: `cd /Users/vero/openclaw && grep -nE "executor\.execute|Auditor|setFinalPlan|setTriageOracle|chatRagDeps" src/slack/monitor/triage-bridge.ts | head -20`

Locate where the Executor's `execute` is called and where the post-execution flow continues to the responder/chat handoff. (This may currently be inline in a helper or in `routeToChat`.)

- [ ] **Step 2: Add Auditor instantiation + helper**

Near the top of the file (alongside existing module-level singletons like `lazyPlanner`, `chatRagDeps`), add:

```ts
import { Auditor } from "../../triage/auditor.js";

let lazyAuditor: Auditor | null = null;
function getAuditor(): Auditor {
  if (!lazyAuditor) {
    lazyAuditor = new Auditor({
      llm: llmClient,
      knownActions: new Set(
        getRegistry()
          .list()
          .map((a) => a.name),
      ),
    });
  }
  return lazyAuditor;
}
```

(Use the existing `llmClient` / `getRegistry()` singletons already present in this file.)

- [ ] **Step 3: Wire the audit-replan loop**

Find the existing code path that calls `executor.execute(session.request_id)`. Immediately after that call returns (success path, before any code that responds to the user), add:

```ts
// Audit: was the data sufficient? If not, run up to one round of follow-up steps.
try {
  const auditor = getAuditor();
  const bundleAfter = getStore().getBundle(session.request_id);
  const plan = session.final_plan;
  if (plan) {
    const audit = await auditor.audit({
      question: event.text ?? "",
      plan,
      bundle: bundleAfter,
    });
    ctx.runtime.log(`[auditor] sufficient=${audit.sufficient} (${audit.rationale})`);
    if (!audit.sufficient && audit.additional_steps && audit.additional_steps.length > 0) {
      // Execute the follow-up steps as if they were a fresh mini-plan.
      // The Executor already appends results to the bundle, so the
      // responder will see both rounds.
      const followupPlan: Plan = {
        steps: audit.additional_steps,
        confidence: plan.confidence,
        summary: `follow-up: ${audit.rationale}`,
      };
      getStore().setFinalPlan(session.request_id, followupPlan);
      await executor.execute(session.request_id);
    }
  }
} catch (err) {
  ctx.runtime.log(`[auditor] error during audit-replan: ${(err as Error).message}`);
}
```

(`Plan` and `executor` should already be imported / in scope in this file; if not, add the imports.)

Then proceed with the existing post-execution flow (response generation / `routeToChat` etc.).

- [ ] **Step 4: Verify regression**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage tests/slack tests/sentinel 2>&1 | tail -5`
Expected: All tests pass.

Run typecheck:

Run: `cd /Users/vero/openclaw && npx tsc --noEmit 2>&1 | grep -v "synthesizer.ts:75" | head -10`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/slack/monitor/triage-bridge.ts
git commit -m "feat(slack): audit-replan loop after Executor's initial pass

Mirrors the setTriageOracle / chatRagDeps singleton pattern: a lazy
Auditor instance constructed once with the live action registry as its
knownActions allowlist. After the initial Executor pass, the auditor
reads (question + plan + bundle); if it says sufficient=false with
valid additional_steps, we run them as a follow-up mini-plan via the
same Executor (which appends to the same bundle).

Bounded at one follow-up round — no infinite loops. Audit errors are
swallowed and logged so a flaky Gemini call doesn't block the response."
```

---

## Task 13: Responder reads the research bundle

**Files:**

- Modify: `/Users/vero/openclaw/src/triage/chat/responder.ts`
- Modify: `/Users/vero/openclaw/src/triage/chat/index.ts`
- Modify: `/Users/vero/openclaw/src/slack/monitor/triage-bridge.ts`
- Test: extend `/Users/vero/openclaw/tests/triage/chat/index.test.ts`

Context: After the audit loop, the bundle has the full results. We pass it through the chat handler into the responder so the LLM that talks to the user can ground on real Firestore values (not just per-step excerpts).

- [ ] **Step 1: Inspect existing Responder shape**

Run: `cd /Users/vero/openclaw && cat src/triage/chat/responder.ts | head -120`

Identify the `respond()` input interface and the prompt-building function. You'll extend the input to accept an optional `researchBundle` and append a "Research results" block to the prompt when present.

- [ ] **Step 2: Add researchBundle to Responder input**

In `/Users/vero/openclaw/src/triage/chat/responder.ts`, add the import:

```ts
import { serializeBundleForPrompt, type ResearchBundle } from "../research-bundle.js";
```

Extend the `respond()` method's input interface (find the existing `respond({...})` signature) to add `researchBundle?: ResearchBundle`.

In the prompt-building section of `respond()`, just before the `OUTPUT FORMAT` block, conditionally insert:

```ts
const researchBlock =
  input.researchBundle && input.researchBundle.entries.length > 0
    ? `\n\nResearch results from this turn (SOURCE OF TRUTH — do not invent fields or values, cite these directly):\n${serializeBundleForPrompt(input.researchBundle)}\n`
    : "";
```

Splice `${researchBlock}` into the final prompt template the responder builds.

- [ ] **Step 3: Thread `researchBundle` through `ChatHandlerDeps` → handleChatMessage**

In `/Users/vero/openclaw/src/triage/chat/index.ts`, add to the `handleChatMessage` input (not deps — input, since it's per-message):

```ts
import type { ResearchBundle } from "../research-bundle.js";

// In the input type:
//   ...existing input fields...
//   researchBundle?: ResearchBundle;
```

In the call to `responder.respond({...})`, pass it through:

```ts
const reply = await responder.respond({
  userMessage: input.userMessage,
  findings: reasoned.findings,
  persona: loadPersona(),
  queuedActions,
  failedToQueue,
  conversationHistory: input.convoContext?.history,
  researchBundle: input.researchBundle,
});
```

- [ ] **Step 4: Pass the bundle from triage-bridge → routeToChat → handleChatMessage**

In `/Users/vero/openclaw/src/slack/monitor/triage-bridge.ts`, the audit-replan loop (Task 12) already ends with the bundle in `getStore().getBundle(session.request_id)`. Grab it once just before the chat handoff and pass it into the `handleChatMessage` input.

In `routeToChat`, change the `handleChatMessage(...)` call's input object to include `researchBundle`:

```ts
    {
      userMessage: event.text ?? "",
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      isDm,
      requesterUserId: event.user,
      convoContext: convoContext && convoContext.full !== "" ? convoContext : undefined,
      ...(researchBundle ? { researchBundle } : {}),
    },
```

Where `researchBundle` is read upstream (in the function that calls `routeToChat`) from `getStore().getBundle(session.request_id)`. If `routeToChat` isn't reached from a session-aware path (e.g., the empty-plan fallback), `researchBundle` stays undefined — the responder simply omits the block. Both branches must compile.

- [ ] **Step 5: Add test for responder-receives-bundle integration**

In `/Users/vero/openclaw/tests/triage/chat/index.test.ts`, add a new test in the existing "handleChatMessage — RAG context" describe block (or a new sibling describe):

```ts
it("includes researchBundle in the responder prompt when provided", async () => {
  const capturedPrompts: string[] = [];
  const llm: LlmClient = {
    complete: vi.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      if (prompt.includes("Conversation context:")) {
        return JSON.stringify({ findings: [], followups: [] });
      }
      return "reply text";
    }),
  };
  const slackPosts: Array<{ channel: string; text: string }> = [];
  await handleChatMessage(
    {
      userMessage: "how many projects?",
      channel: "D12345",
      isDm: true,
      researchBundle: {
        entries: [
          {
            step_idx: 0,
            action: "firestoreCount",
            args: { collection: "vero_projects" },
            status: "success",
            result: { collection: "vero_projects", count: 224 },
            invoked_at: 1,
          },
        ],
        truncated: false,
        total_bytes: 100,
      },
    },
    {
      llm,
      slackPost: async (p) => {
        slackPosts.push({ channel: p.channel, text: p.text });
      },
    },
  );
  expect(slackPosts).toHaveLength(1);
  // Responder prompt (second LLM call) should contain the bundle
  const responderPrompt = capturedPrompts.find((p) => p.includes("Research results"));
  expect(responderPrompt).toBeDefined();
  expect(responderPrompt).toContain("firestoreCount");
  expect(responderPrompt).toContain("vero_projects");
  expect(responderPrompt).toContain("224");
});
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage 2>&1 | tail -5`
Expected: All pass.

Run typecheck:

Run: `cd /Users/vero/openclaw && npx tsc --noEmit 2>&1 | grep -v "synthesizer.ts:75" | head -10`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/chat/responder.ts src/triage/chat/index.ts src/slack/monitor/triage-bridge.ts tests/triage/chat/index.test.ts
git commit -m "feat(triage): Responder grounds on research_bundle when provided

The bundle threads chat-handler-input → handleChatMessage → respond().
When non-empty, the responder prompt gets a 'Research results' block
flagged as SOURCE OF TRUTH (do not invent fields or values, cite
directly). Combined with the anti-hallucination guard from PR #12,
this is what makes JR cite real Firestore values in replies.

Bundle is optional — chat-only paths (no triage execution) work as
before, and the existing chat-v2 RAG (insights + oracle + observations)
remains the grounding source for non-triage flows."
```

---

## Task 14: Live smoke (operator-driven; do not run autonomously)

**Files:** none modified — verification only.

Context: Final acceptance. Restart JR, DM data-shaped questions, watch for: planner generating Firestore plans, executor running them without "unknown action" errors, auditor firing, bundle populated, responder citing specific values.

- [ ] **Step 1: Operator restarts JR**

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
```

Handle the zombie-gateway pattern if the prior process doesn't exit; manually `kill <pid>` if `lsof -ti:18789` still shows the old PID after 10s.

Wait for `[gateway] listening on ws://127.0.0.1:18789 (PID ...)` in `/Users/vero/openclaw.log`.

- [ ] **Step 2: Set up the live log tail**

```bash
tail -F /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log \
  | grep -E "rag-context|auditor|DIAG msg-handler|empty plan|unknown action|cycle failed|Error"
```

- [ ] **Step 3: Operator DMs JR data-shaped questions**

Pick from this menu — each targets a specific path:

| Prompt                                   | Path it exercises                    |
| ---------------------------------------- | ------------------------------------ |
| _"How many active projects do we have?"_ | firestoreCount with where            |
| _"What collections exist in Firestore?"_ | firestoreCollections                 |
| _"What fields are on vero_projects?"_    | firestoreKeys                        |
| _"Show me the 5 newest projects."_       | firestoreQuery with orderBy + limit  |
| _"Tell me about project <id>"_           | firestoreGet (pick an id from prior) |

- [ ] **Step 4: Verify expected log signals per DM**

For each DM, expect to see in order:

1. `[DIAG msg-handler] ts=... user=U07KRVD2867 text="..."`
2. Triage routes to planner; planner emits a Firestore plan (no `[triage] empty plan` and no `unknown action` errors)
3. Executor runs each step (no errors)
4. `[auditor] sufficient=true|false (...)`
5. If `sufficient=false`, a second round of Executor calls runs
6. JR's reply in Slack cites the actual values from the bundle (not a generic "I'd need to look that up")

- [ ] **Step 5: Spot-check the bundle persisted in sentinel.db**

```bash
sqlite3 -header -column ~/.openclaw/sentinel.db \
  "SELECT request_id, length(research_bundle) AS bundle_bytes, substr(research_bundle, 1, 200) AS preview
   FROM triage_sessions
   WHERE research_bundle IS NOT NULL
   ORDER BY updated_at DESC
   LIMIT 5;"
```

Expected: recent triage sessions have a populated `research_bundle` with the action results serialized as JSON.

- [ ] **Step 6: Open the PR**

```bash
cd /Users/vero/openclaw
git push -u origin feat/firestore-actions-deep-research
gh pr create --title "Firestore actions + deep-research bundle (read-only)" --body "..."
```

(Body summarizing the spec + live smoke results.)

---

## Self-review (controller did before handoff)

**Spec coverage check:**

| Spec section                                                                           | Task    |
| -------------------------------------------------------------------------------------- | ------- |
| Firestore client + FirestoreLike test seam                                             | Task 1  |
| Shared `_display` formatters                                                           | Task 2  |
| `firestoreCollections` action                                                          | Task 3  |
| `firestoreKeys` action                                                                 | Task 4  |
| `firestoreGet` action                                                                  | Task 5  |
| `firestoreQuery` action (with limit cap, default 10, max 50)                           | Task 6  |
| `firestoreCount` action (with optional where)                                          | Task 7  |
| Register all 5 actions + registry test update                                          | Task 8  |
| Research bundle module + 50KB cap + serialize                                          | Task 9  |
| Executor populates bundle alongside excerpt                                            | Task 10 |
| Auditor module (sufficient/insufficient, unknown-action filter, cap 3, degraded paths) | Task 11 |
| Audit-replan loop in triage-bridge                                                     | Task 12 |
| Responder reads bundle                                                                 | Task 13 |
| Operator-gated live smoke                                                              | Task 14 |

**Placeholder scan:** None. Each code step has complete code; each command shows expected output.

**Type consistency:**

- `FirestoreLike`, `Doc`, `BundleEntry`, `ResearchBundle`, `AuditInput/Output` all defined where first used and consumed consistently in later tasks.
- `CatalogAction<TArgs, TResult>` shape matched in all 5 action files.
- `PlanStep` from `types.ts` is what the Auditor returns and the Executor consumes (no shape mismatch).
- `_display` field convention matches the `pickExcerpt` helper introduced in PR #12 — the Executor's existing excerpt path keeps working.

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-06-24-firestore-actions-deep-research.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec + quality) between each.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`.

Which approach?
