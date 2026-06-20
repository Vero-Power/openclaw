import { describe, it, expect } from "vitest";
import {
  encodeEmbedding,
  decodeEmbedding,
  EMBEDDING_DIM,
} from "../../../src/sentinel/embeddings/blob-codec.js";

describe("blob-codec", () => {
  it("EMBEDDING_DIM is 768", () => {
    expect(EMBEDDING_DIM).toBe(768);
  });

  it("round-trips a Float32Array of length 768 byte-for-byte", () => {
    const original = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      original[i] = i * 0.001 - 0.5;
    }
    const buf = encodeEmbedding(original);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(EMBEDDING_DIM * 4);
    const restored = decodeEmbedding(buf);
    expect(restored).toBeInstanceOf(Float32Array);
    expect(restored.length).toBe(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(restored[i]).toBe(original[i]);
    }
  });

  it("rejects encode of a wrong-length vector", () => {
    const bad = new Float32Array(512);
    expect(() => encodeEmbedding(bad)).toThrow(/length/);
  });

  it("rejects decode of a wrong-length buffer", () => {
    const bad = Buffer.alloc(EMBEDDING_DIM * 4 - 4); // off by one float
    expect(() => decodeEmbedding(bad)).toThrow(/length/);
  });
});
