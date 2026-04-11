import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { WikiUpdate, readWikiPage } from "./wiki";
// fs/path still used for WIKI.md

const client = new Anthropic();

const WIKI_RULES = fs.existsSync(path.join(process.cwd(), "WIKI.md"))
  ? fs.readFileSync(path.join(process.cwd(), "WIKI.md"), "utf-8")
  : "";

export interface ClaudeResponse {
  reply: string;
  wikiUpdates: WikiUpdate[];
}

function buildSystemPrompt(hotContext: string, wikiSummary: string): string {
  return `You are Valera, a personal AI assistant with persistent wiki memory.

You maintain a knowledge wiki stored as markdown files. After every response, you decide what (if anything) to save to the wiki.

## Your Wiki

### Current session context (hot.md):
${hotContext}

### Available wiki pages:
${wikiSummary}

## Wiki Rules
${WIKI_RULES}

## Response Format

You MUST respond with valid JSON only. No text outside the JSON.

{
  "reply": "your conversational response to the user",
  "wiki_updates": [
    {
      "path": "entities/some-topic.md",
      "content": "---\\ntitle: Some Topic\\nupdated: YYYY-MM-DD\\ntags: [tag1, tag2]\\n---\\n\\nContent here with [[wikilinks]] to related pages."
    }
  ]
}

Rules for wiki_updates:
- Use "entities/" for people, tools, projects, organizations
- Use "concepts/" for ideas, decisions, patterns, learnings
- Always include frontmatter with title, updated (today's date), and tags
- Use [[wikilinks]] to link between pages
- Only update wiki when there's genuinely new or changed information worth remembering
- Keep wiki entries concise and factual
- Return empty wiki_updates array [] when nothing needs saving
- Merge new info into existing pages rather than creating duplicates`;
}

export async function chat(
  userMessage: string,
  hotContext: string,
  wikiSummary: string,
  relevantPages: string[]
): Promise<ClaudeResponse> {
  const systemPrompt = buildSystemPrompt(hotContext, wikiSummary);

  let contextBlock = "";
  if (relevantPages.length > 0) {
    contextBlock = "\n\n## Relevant wiki pages:\n";
    for (const page of relevantPages) {
      const content = await readWikiPage(page);
      if (content) contextBlock += `\n### ${page}\n${content}\n`;
    }
  }

  const fullSystem = systemPrompt + contextBlock;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: fullSystem,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  return parseResponse(text);
}

function parseResponse(text: string): ClaudeResponse {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { reply: text, wikiUpdates: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const reply = parsed.reply || text;
    const wikiUpdates: WikiUpdate[] = (parsed.wiki_updates || []).map(
      (u: { path: string; content: string }) => ({
        path: u.path,
        content: u.content,
      })
    );

    return { reply, wikiUpdates };
  } catch {
    return { reply: text, wikiUpdates: [] };
  }
}
