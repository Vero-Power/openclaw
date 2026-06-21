export const EMBEDDING_DIM = 768;

export function encodeEmbedding(v: Float32Array): Buffer {
  if (v.length !== EMBEDDING_DIM) {
    throw new Error(
      `encodeEmbedding: expected Float32Array of length ${EMBEDDING_DIM}, got ${v.length}`,
    );
  }
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function decodeEmbedding(buf: Buffer): Float32Array {
  if (buf.length !== EMBEDDING_DIM * 4) {
    throw new Error(
      `decodeEmbedding: expected buffer of length ${EMBEDDING_DIM * 4}, got ${buf.length}`,
    );
  }
  // Copy into a fresh ArrayBuffer so the Float32Array isn't aliased to the
  // pooled Node Buffer slab (which may be reused under us by downstream code).
  const ab = new ArrayBuffer(buf.length);
  Buffer.from(ab).set(buf);
  return new Float32Array(ab);
}
