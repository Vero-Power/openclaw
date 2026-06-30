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
