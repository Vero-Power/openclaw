import { describe, it, expect } from "vitest";
import { createGeminiAdapterFromClient } from "../../../src/sentinel/embeddings/gemini-adapter.js";

describe("gemini-adapter", () => {
  it("delegates to client.models.embedContent and returns the 768-dim vector", async () => {
    const captured: Array<{ model: string; contents: unknown }> = [];
    const fakeClient = {
      models: {
        async embedContent(req: { model: string; contents: unknown }) {
          captured.push(req);
          const values = Array.from({ length: 768 }).map((_, i) => i / 768);
          return { embeddings: [{ values }] };
        },
      },
    };
    const adapter = createGeminiAdapterFromClient(fakeClient as never);
    const v = await adapter.embed("hello world");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(768);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[767]).toBeCloseTo(767 / 768, 6);
    expect(captured).toHaveLength(1);
    expect(captured[0].model).toBe("text-embedding-004");
  });

  it("throws when the response is missing values", async () => {
    const fakeClient = {
      models: {
        async embedContent() {
          return { embeddings: [{ values: undefined }] };
        },
      },
    };
    const adapter = createGeminiAdapterFromClient(fakeClient as never);
    await expect(adapter.embed("anything")).rejects.toThrow(/values/);
  });

  it("throws when the response vector is the wrong length", async () => {
    const fakeClient = {
      models: {
        async embedContent() {
          return { embeddings: [{ values: [1, 2, 3] }] };
        },
      },
    };
    const adapter = createGeminiAdapterFromClient(fakeClient as never);
    await expect(adapter.embed("anything")).rejects.toThrow(/expected 768/);
  });
});
