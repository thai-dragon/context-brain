import fs from "fs";
import path from "path";
import { indexPage } from "./embeddings";

const WIKI_DIR = path.join(process.cwd(), "wiki");
const HOT_PATH = path.join(WIKI_DIR, "hot.md");
const INDEX_PATH = path.join(WIKI_DIR, "index.md");
const MAX_HOT_LINES = 50;

export interface WikiUpdate {
  path: string;
  content: string;
}

interface WikiPage {
  title: string;
  updated: string;
  tags: string[];
  body: string;
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseFrontmatter(raw: string): WikiPage {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { title: "", updated: "", tags: [], body: raw };
  }
  const frontmatter = match[1];
  const body = match[2];
  const title = frontmatter.match(/title:\s*(.+)/)?.[1]?.trim() ?? "";
  const updated = frontmatter.match(/updated:\s*(.+)/)?.[1]?.trim() ?? "";
  const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, "")).filter(Boolean)
    : [];
  return { title, updated, tags, body };
}

function formatPage(page: WikiPage): string {
  const tags = page.tags.map((t) => t).join(", ");
  return `---
title: ${page.title}
updated: ${page.updated}
tags: [${tags}]
---
${page.body}`;
}

export function readHot(): string {
  if (!fs.existsSync(HOT_PATH)) return "";
  return fs.readFileSync(HOT_PATH, "utf-8");
}

export function writeHot(content: string) {
  const lines = content.split("\n");
  const trimmed = lines.slice(-MAX_HOT_LINES).join("\n");
  fs.writeFileSync(HOT_PATH, trimmed, "utf-8");
}

export function appendHot(entry: string) {
  const current = readHot();
  const timestamp = new Date().toISOString().slice(0, 16);
  const newContent = current.trimEnd() + `\n\n[${timestamp}] ${entry}`;
  writeHot(newContent);
}

export function clearHot() {
  const fresh = formatPage({
    title: "Session Context",
    updated: new Date().toISOString().slice(0, 10),
    tags: ["session", "context"],
    body: "\nNo recent context. Start chatting to build up context.\n",
  });
  fs.writeFileSync(HOT_PATH, fresh, "utf-8");
}

export function readWikiPage(pagePath: string): string | null {
  const fullPath = resolveWikiPath(pagePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

export function writeWikiPage(pagePath: string, content: string) {
  const fullPath = resolveWikiPath(pagePath);
  ensureDir(fullPath);
  fs.writeFileSync(fullPath, content, "utf-8");
  updateIndex(pagePath, content);
  // Fire-and-forget embedding — non-blocking
  indexPage(pagePath, content).catch((err) =>
    console.error(`Embedding failed for ${pagePath}:`, err)
  );
}

export async function applyWikiUpdates(updates: WikiUpdate[]) {
  for (const update of updates) {
    writeWikiPage(update.path, update.content);
  }
}

function resolveWikiPath(pagePath: string): string {
  const sanitized = pagePath.replace(/\.\./g, "").replace(/^\/+/, "");
  if (!sanitized.endsWith(".md")) {
    return path.join(WIKI_DIR, sanitized + ".md");
  }
  return path.join(WIKI_DIR, sanitized);
}

function updateIndex(pagePath: string, content: string) {
  const page = parseFrontmatter(content);
  const title = page.title || path.basename(pagePath, ".md");
  const indexContent = fs.existsSync(INDEX_PATH)
    ? fs.readFileSync(INDEX_PATH, "utf-8")
    : "";

  const linkPattern = `[[${pagePath.replace(/\.md$/, "")}]]`;
  if (indexContent.includes(linkPattern)) return;

  const entry = `- ${linkPattern} - ${title}`;
  const updated = indexContent.trimEnd() + "\n" + entry + "\n";
  fs.writeFileSync(INDEX_PATH, updated, "utf-8");
}

export function searchWiki(query: string): string[] {
  const results: string[] = [];
  const lowerQuery = query.toLowerCase();

  function walkDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const content = fs.readFileSync(fullPath, "utf-8").toLowerCase();
        const relativePath = path.relative(WIKI_DIR, fullPath);
        if (
          content.includes(lowerQuery) ||
          entry.name.toLowerCase().includes(lowerQuery)
        ) {
          results.push(relativePath);
        }
      }
    }
  }

  walkDir(WIKI_DIR);
  return results;
}

export function getWikiSummary(): string {
  const pages: string[] = [];

  function walkDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith(".md") && entry.name !== "hot.md") {
        const relativePath = path.relative(WIKI_DIR, fullPath);
        pages.push(relativePath);
      }
    }
  }

  walkDir(WIKI_DIR);
  return pages.length > 0
    ? `Wiki pages: ${pages.join(", ")}`
    : "Wiki is empty.";
}
