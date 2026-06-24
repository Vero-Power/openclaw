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
    const doc: Doc | null = snapshot.exists ? { _id: snapshot.id, ...snapshot.data() } : null;
    return {
      collection: args.collection,
      id: args.id,
      doc,
      _display: formatDoc(args.collection, args.id, doc),
    };
  },
};
