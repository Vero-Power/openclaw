import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../../../src/sentinel/embeddings/cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6);
  });

  it("ranks similar vectors above dissimilar ones", () => {
    const a = new Float32Array([1, 0, 0]);
    const close = new Float32Array([0.9, 0.1, 0]);
    const far = new Float32Array([0.1, 0.9, 0]);
    expect(cosineSimilarity(a, close)).toBeGreaterThan(cosineSimilarity(a, far));
  });

  it("returns 0 when either input has zero magnitude", () => {
    const z = new Float32Array([0, 0, 0]);
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(z, a)).toBe(0);
    expect(cosineSimilarity(a, z)).toBe(0);
  });

  it("throws on length mismatch", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow(/length/);
  });
});
