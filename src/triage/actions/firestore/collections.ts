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
    const collections = cols.map((c) => c.id).toSorted();
    return {
      collections,
      _display: formatCollections(collections),
    };
  },
};
