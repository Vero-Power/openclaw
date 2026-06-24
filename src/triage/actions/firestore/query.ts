import { z } from "zod";
import type { CatalogAction } from "../types.js";
import {
  createDefaultFirestoreClient,
  type FirestoreLike,
  type FirestoreQueryRef,
} from "./client.js";
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
    "Filter + order + limit a Firestore collection. Args: { collection: string, where?: [{ field: string, op: '=='|'!='|'<'|'<='|'>'|'>='|'in'|'array-contains', value: any }], orderBy?: { field: string, direction?: 'asc'|'desc' }, limit?: number }. Each where entry MUST be an object with field/op/value keys, NOT a tuple/array. Use after firestoreKeys so the field names are real. limit defaults to 10, max 50.",
  args_schema: ArgsSchema,
  idempotent: true,
  external_effect: false,
  estimated_duration_ms: 800,
  invoke: async (args, ctx) => {
    const client = await resolveClient(ctx as { firestoreClientOverride?: FirestoreLike });
    let q: FirestoreQueryRef = client.collection(args.collection);
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
    const docs: Doc[] = snapshot.docs.map((d) => ({ _id: d.id, ...d.data() }));
    return {
      collection: args.collection,
      docs,
      total_returned: docs.length,
      _display: formatQueryDocs(args.collection, docs, docs.length),
    };
  },
};
