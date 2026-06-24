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
    let q = client.collection(args.collection);
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
