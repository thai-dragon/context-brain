import { getSupabase } from "./supabase";
import { indexPage } from "./embeddings";

export interface WikiUpdate {
  path: string;
  content: string;
}

const MAX_HOT_LINES = 50;
const HOT_ID = "default";

// ── Hot context (short-term memory) ────────────────────────────────────────

export async function readHot(): Promise<string> {
  const { data } = await getSupabase()
    .from("hot_context")
    .select("content")
    .eq("id", HOT_ID)
    .single();
  return data?.content ?? "";
}

export async function writeHot(content: string) {
  const lines = content.split("\n");
  const trimmed = lines.slice(-MAX_HOT_LINES).join("\n");
  await getSupabase().from("hot_context").upsert({
    id: HOT_ID,
    content: trimmed,
    updated_at: new Date().toISOString(),
  });
}

export async function appendHot(entry: string) {
  const current = await readHot();
  const timestamp = new Date().toISOString().slice(0, 16);
  const newContent = current.trimEnd() + `\n\n[${timestamp}] ${entry}`;
  await writeHot(newContent);
}

export async function clearHot() {
  await writeHot("No recent context. Start chatting to build up context.");
}

// ── Wiki pages (long-term memory) ──────────────────────────────────────────

export async function readWikiPage(pagePath: string): Promise<string | null> {
  const { data } = await getSupabase()
    .from("wiki_pages")
    .select("content")
    .eq("path", normalizePath(pagePath))
    .single();
  return data?.content ?? null;
}

export async function writeWikiPage(pagePath: string, content: string) {
  const path = normalizePath(pagePath);
  const title = extractTitle(content);
  const tags = extractTags(content);

  await getSupabase().from("wiki_pages").upsert({
    path,
    title,
    content,
    tags,
    updated_at: new Date().toISOString(),
  });

  // Fire-and-forget embedding
  indexPage(path, content).catch((err) =>
    console.error(`Embedding failed for ${path}:`, err)
  );
}

export async function applyWikiUpdates(updates: WikiUpdate[]) {
  for (const update of updates) {
    await writeWikiPage(update.path, update.content);
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function searchWiki(query: string): Promise<string[]> {
  const { data } = await getSupabase()
    .from("wiki_pages")
    .select("path")
    .or(`content.ilike.%${query}%,title.ilike.%${query}%`);
  return data?.map((r) => r.path) ?? [];
}

export async function getWikiSummary(): Promise<string> {
  const { data } = await getSupabase()
    .from("wiki_pages")
    .select("path, title");
  if (!data || data.length === 0) return "Wiki is empty.";
  return `Wiki pages: ${data.map((r) => r.path).join(", ")}`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\.\./g, "").replace(/^\/+/, "").replace(/\.md$/, "");
}

function extractTitle(content: string): string {
  return content.match(/title:\s*(.+)/)?.[1]?.trim() ?? "";
}

function extractTags(content: string): string[] {
  const match = content.match(/tags:\s*\[([^\]]*)\]/);
  if (!match) return [];
  return match[1].split(",").map((t) => t.trim().replace(/['"]/g, "")).filter(Boolean);
}
