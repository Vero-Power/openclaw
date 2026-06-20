import { EMBEDDING_DIM } from "./blob-codec.js";

export interface GeminiEmbeddingAdapter {
  embed(text: string): Promise<Float32Array>;
}

// Minimum surface we need from @google/genai. Typed loosely so test fakes
// can supply just this shape without depending on the full SDK type tree.
interface MinimalGenAIClient {
  models: {
    embedContent(req: {
      model: string;
      contents: unknown;
    }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
  };
}

const EMBEDDING_MODEL = "text-embedding-004";

export function createGeminiAdapterFromClient(client: MinimalGenAIClient): GeminiEmbeddingAdapter {
  return {
    async embed(text: string): Promise<Float32Array> {
      const resp = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
      });
      const values = resp.embeddings?.[0]?.values;
      if (!Array.isArray(values)) {
        throw new Error("gemini-adapter: response missing embeddings[0].values");
      }
      if (values.length !== EMBEDDING_DIM) {
        throw new Error(`gemini-adapter: expected ${EMBEDDING_DIM} values, got ${values.length}`);
      }
      return Float32Array.from(values);
    },
  };
}

export async function createDefaultGeminiAdapter(): Promise<GeminiEmbeddingAdapter> {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set; cannot construct default Gemini embedding adapter");
  }
  const client = new GoogleGenAI({ apiKey });
  return createGeminiAdapterFromClient(client as unknown as MinimalGenAIClient);
}
