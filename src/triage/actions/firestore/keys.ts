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
    const sample_docs: Doc[] = snapshot.docs.map((d) => ({ _id: d.id, ...d.data() }));
    const keys = Array.from(
      new Set(sample_docs.flatMap((d) => Object.keys(d).filter((k) => k !== "_id"))),
    ).toSorted();
    return {
      collection: args.collection,
      keys,
      sample_docs,
      _display: formatKeys(args.collection, keys, sample_docs),
    };
  },
};
