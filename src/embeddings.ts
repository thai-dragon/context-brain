import OpenAI from "openai";
import { getSupabase } from "./supabase";

const MODEL = "text-embedding-3-small";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function embedText(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: MODEL,
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

export async function indexPage(pagePath: string, content: string) {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    const embedding = await embedText(content);
    await getSupabase()
      .from("wiki_pages")
      .update({ embedding: embedding as unknown as string })
      .eq("path", pagePath);
  } catch (err) {
    console.error(`Failed to embed ${pagePath}:`, err);
  }
}

export async function vectorSearch(query: string, topK = 5): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];
  try {
    const embedding = await embedText(query);
    const { data } = await getSupabase().rpc("search_wiki", {
      query_embedding: embedding,
      match_count: topK,
    });
    return data?.map((r: { path: string }) => r.path) ?? [];
  } catch (err) {
    console.error("Vector search failed:", err);
    return [];
  }
}
