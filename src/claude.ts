import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { WikiUpdate, readWikiPage } from "./wiki";
import { TaskUpdate } from "./planner";
import { ReminderUpdate } from "./reminders";
// fs/path still used for WIKI.md

const client = new Anthropic();

const WIKI_RULES = fs.existsSync(path.join(process.cwd(), "WIKI.md"))
  ? fs.readFileSync(path.join(process.cwd(), "WIKI.md"), "utf-8")
  : "";

export interface ClaudeResponse {
  reply: string;
  wikiUpdates: WikiUpdate[];
  taskUpdates: TaskUpdate[];
  reminderUpdates: ReminderUpdate[];
}

function buildSystemPrompt(hotContext: string, wikiSummary: string): string {
  return `You are Valera, a personal AI assistant with persistent wiki memory.

You maintain a knowledge wiki stored as markdown files. After every response, you decide what (if anything) to save to the wiki.

Today's date: ${new Date().toISOString().slice(0, 10)}

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
  ],
  "task_updates": [
    { "action": "add", "date": "today", "project": "INV", "task": "get task from manager", "points": 1 },
    { "action": "complete", "date": "today", "project": "INV", "task": "get task" },
    { "action": "remove", "date": "today", "project": "INV", "task": "get task" }
  ],
  "reminder_updates": [
    { "date": "2026-04-23", "message": "Last testosterone dose" }
  ]
}

Rules for reminder_updates:
- Use when user says "напомни", "remind me", "не забыть" + a specific date
- "date" MUST be YYYY-MM-DD format (not "today" or "tomorrow" — convert to actual date)
- Today's date is provided in the session context
- Return empty reminder_updates array [] when no reminders needed

Rules for task_updates:
- Use when the user mentions tasks, plans, todos, or completing work
- "date" can be "today", "tomorrow", or "YYYY-MM-DD"
- "project" is an uppercase short name (INV, REM, KB, etc.)
- "action": "add" creates a new task, "complete" marks it done, "remove" deletes it
- "points" defaults to 1, only set for "add" action
- When user says "завтра надо сделать X, Y, Z" → add tasks with date "tomorrow"
- When user says "сделал X" or "завершил X" → complete that task
- To remove ALL tasks for a date: { "action": "remove", "date": "today", "project": "ALL", "task": "all" }
- To remove one task: match the task text partially
- Return empty task_updates array [] when no task changes needed

Rules for wiki_updates:
- Use "entities/" for people, tools, projects, organizations
- Use "concepts/" for ideas, decisions, patterns, learnings
- Always include frontmatter with title, updated (today's date), and tags
- Use [[wikilinks]] to link between pages
- Only update wiki when there's genuinely new or changed information worth remembering
- Keep wiki entries SHORT and factual — max 300 words per page
- Return empty wiki_updates array [] when nothing needs saving
- Merge new info into existing pages rather than creating duplicates
- CRITICAL: keep your total JSON response under 4000 characters. Prefer a shorter reply and fewer wiki_updates over a truncated response`;
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
    max_tokens: 8192,
    system: fullSystem,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  return parseResponse(text);
}

function parseResponse(text: string): ClaudeResponse {
  try {
    // Strip markdown code blocks if Claude wrapped JSON in ```json ... ```
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { reply: text, wikiUpdates: [], taskUpdates: [], reminderUpdates: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const reply = parsed.reply || text;
    const wikiUpdates: WikiUpdate[] = (parsed.wiki_updates || []).map(
      (u: { path: string; content: string }) => ({
        path: u.path,
        content: u.content,
      })
    );
    const taskUpdates: TaskUpdate[] = (parsed.task_updates || []).map(
      (u: { action: string; date: string; project: string; task: string; points?: number }) => ({
        action: u.action as "add" | "complete" | "remove",
        date: u.date,
        project: u.project,
        task: u.task,
        points: u.points,
      })
    );
    const reminderUpdates: ReminderUpdate[] = (parsed.reminder_updates || []).map(
      (u: { date: string; message: string }) => ({
        date: u.date,
        message: u.message,
      })
    );

    return { reply, wikiUpdates, taskUpdates, reminderUpdates };
  } catch (err) {
    console.error("JSON parse failed, extracting reply field:", err);

    // Try to extract just the "reply" field even from broken JSON
    const replyMatch = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (replyMatch) {
      const reply = replyMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      return { reply, wikiUpdates: [], taskUpdates: [], reminderUpdates: [] };
    }

    return { reply: "Sorry, I had trouble processing that. Please try again.", wikiUpdates: [], taskUpdates: [], reminderUpdates: [] };
  }
}
