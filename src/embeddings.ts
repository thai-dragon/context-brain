import OpenAI from "openai";
import fs from "fs";
import path from "path";

const EMBEDDINGS_PATH = path.join(process.cwd(), "wiki", "embeddings.json");
const MODEL = "text-embedding-3-small";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

type EmbeddingsStore = Record<string, number[]>;

function loadStore(): EmbeddingsStore {
  if (!fs.existsSync(EMBEDDINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveStore(store: EmbeddingsStore) {
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(store), "utf-8");
}

export async function embedText(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: MODEL,
    input: text.slice(0, 8000), // stay well within token limit
  });
  return response.data[0].embedding;
}

export async function indexPage(pagePath: string, content: string) {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    const embedding = await embedText(content);
    const store = loadStore();
    store[pagePath] = embedding;
    saveStore(store);
  } catch (err) {
    console.error(`Failed to embed ${pagePath}:`, err);
  }
}

export async function removePageIndex(pagePath: string) {
  const store = loadStore();
  delete store[pagePath];
  saveStore(store);
}

export async function vectorSearch(
  query: string,
  topK = 5
): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];

  const store = loadStore();
  const entries = Object.entries(store);
  if (entries.length === 0) return [];

  const queryEmbedding = await embedText(query);

  const scored = entries.map(([pagePath, embedding]) => ({
    pagePath,
    score: cosineSimilarity(queryEmbedding, embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((r) => r.pagePath);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
