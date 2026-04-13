import { Telegraf, Context } from "telegraf";
import {
  readHot,
  clearHot,
  appendHot,
  applyWikiUpdates,
  searchWiki,
  getWikiSummary,
  readWikiPage,
  writeWikiPage,
} from "./wiki";
import { vectorSearch } from "./embeddings";
import { chat } from "./claude";
import { transcribeVoice } from "./transcribe";
import { applyTaskUpdates, getTasksForDate, formatTasks, formatSummary, resolveDate } from "./planner";
import { applyReminderUpdates, checkReminders } from "./reminders";

const ALLOWED_USERS = (process.env.ALLOWED_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function isAllowed(ctx: Context): boolean {
  if (ALLOWED_USERS.length === 0) return true;
  const userId = ctx.from?.id?.toString();
  return !!userId && ALLOWED_USERS.includes(userId);
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // Block unauthorized users
  bot.use((ctx, next) => {
    if (!isAllowed(ctx)) {
      ctx.reply("Unauthorized.");
      return;
    }
    return next();
  });

  bot.command("start", (ctx) => {
    ctx.reply(
      "Hey! I'm Valera, your AI assistant with persistent memory.\n\n" +
        "Just chat with me normally. I'll remember important things in my wiki.\n\n" +
        "Commands:\n" +
        "/today - tasks for today\n" +
        "/tomorrow - tasks for tomorrow\n" +
        "/summary - end of day summary\n" +
        "/memory - session context\n" +
        "/forget - clear session\n" +
        "/wiki <query> - search wiki"
    );
  });

  bot.command("memory", async (ctx) => {
    const hot = await readHot();
    const trimmed = hot.length > 4000 ? hot.slice(-4000) + "\n...(truncated)" : hot;
    ctx.reply(trimmed || "No session context yet.");
  });

  bot.command("forget", async (ctx) => {
    await clearHot();
    ctx.reply("Session context cleared.");
  });

  bot.command("today", async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const tasks = await getTasksForDate("today");
    await ctx.reply(formatTasks(tasks, today));
  });

  bot.command("tomorrow", async (ctx) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrow = d.toISOString().slice(0, 10);
    const tasks = await getTasksForDate("tomorrow");
    await ctx.reply(formatTasks(tasks, tomorrow));
  });

  bot.command("summary", async (ctx) => {
    const dateArg = ctx.message.text.replace(/^\/summary\s*/, "").trim();
    const date = dateArg || new Date().toISOString().slice(0, 10);
    const tasks = await getTasksForDate(dateArg || "today");
    await ctx.reply(formatSummary(tasks, date));
  });

  bot.command("wiki", async (ctx) => {
    const query = ctx.message.text.replace(/^\/wiki\s*/, "").trim();
    if (!query) {
      const summary = await getWikiSummary();
      ctx.reply(summary);
      return;
    }

    // Try vector search first, fall back to keyword search
    let results: string[] = await vectorSearch(query, 5);
    const searchType = results.length > 0 ? "semantic" : "keyword";
    if (results.length === 0) {
      results = (await searchWiki(query)).slice(0, 5);
    }

    if (results.length === 0) {
      ctx.reply(`No wiki pages found for "${query}".`);
      return;
    }

    let response = `Found ${results.length} page(s) [${searchType} search]:\n\n`;
    for (const page of results) {
      const content = await readWikiPage(page);
      const preview = content
        ? content.replace(/---[\s\S]*?---/, "").trim().slice(0, 120)
        : "";
      response += `- ${page}\n  ${preview}...\n\n`;
    }
    ctx.reply(response);
  });

  bot.on("voice", async (ctx: Context) => {
    if (!ctx.message || !("voice" in ctx.message)) return;
    if (!process.env.OPENAI_API_KEY) {
      await ctx.reply("Voice messages require OPENAI_API_KEY to be set.");
      return;
    }
    try {
      await ctx.sendChatAction("typing");
      const voice = ctx.message.voice;
      const fileLink = await ctx.telegram.getFileLink(voice.file_id);
      const transcribed = await transcribeVoice(fileLink.href);
      if (!transcribed?.trim()) {
        await ctx.reply("Couldn't transcribe the voice message. Try again.");
        return;
      }
      await processMessage(ctx, `🎤 ${transcribed}`);
    } catch (err) {
      console.error("Error handling voice message:", err);
      await ctx.reply("Sorry, couldn't process the voice message.");
    }
  });

  bot.on("text", async (ctx: Context) => {
    if (!ctx.message || !("text" in ctx.message)) return;
    await processMessage(ctx, ctx.message.text);
  });

  async function processMessage(ctx: Context, userMessage: string) {
    try {
      await ctx.sendChatAction("typing");

      // Check for due reminders
      const dueReminders = await checkReminders();
      for (const reminder of dueReminders) {
        await ctx.reply(`Reminder: ${reminder}`);
      }

      const [hotContext, wikiSummary, todayTasks] = await Promise.all([
        readHot(),
        getWikiSummary(),
        getTasksForDate("today"),
      ]);

      // Inject today's tasks so Claude knows actual state
      const tasksContext = todayTasks.length > 0
        ? "\n\n[TODAY'S TASKS]:\n" +
          todayTasks.map((t) => `- [${t.done ? "DONE" : "TODO"}] ${t.project}: ${t.task}`).join("\n")
        : "\n\n[TODAY'S TASKS]: none";

      const enrichedHot = hotContext + tasksContext;

      // Vector search for relevant context; fall back to keyword search
      let relevantPages = await vectorSearch(userMessage, 5);
      if (relevantPages.length === 0) {
        const words = userMessage.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const keywordPages = new Set<string>();
        for (const word of words) {
          for (const page of await searchWiki(word)) {
            keywordPages.add(page);
          }
        }
        relevantPages = [...keywordPages].slice(0, 5);
      }

      const response = await chat(userMessage, enrichedHot, wikiSummary, relevantPages);

      if (response.wikiUpdates.length > 0) {
        await applyWikiUpdates(response.wikiUpdates);
        console.log(`Wiki updated: ${response.wikiUpdates.map((u) => u.path).join(", ")}`);
      }

      if (response.taskUpdates.length > 0) {
        await applyTaskUpdates(response.taskUpdates);
        console.log(`Tasks updated: ${response.taskUpdates.map((u) => `${u.action} ${u.project}:${u.task}`).join(", ")}`);

        // Log completed tasks to wiki so history is searchable
        const completed = response.taskUpdates.filter((u) => u.action === "complete");
        if (completed.length > 0) {
          const monthKey = new Date().toISOString().slice(0, 7);
          const logPath = `log/${monthKey}`;
          const today = new Date().toISOString().slice(0, 10);
          const existing = await readWikiPage(logPath)
            ?? `---\ntitle: Log ${monthKey}\nupdated: ${today}\ntags: [log]\n---\n`;
          const entries = completed
            .map((u) => `- ${resolveDate(u.date)} [DONE] ${u.project}: ${u.task}`)
            .join("\n");
          await writeWikiPage(logPath, existing.trimEnd() + "\n" + entries);
        }
      }

      if (response.reminderUpdates.length > 0) {
        await applyReminderUpdates(response.reminderUpdates);
        console.log(`Reminders added: ${response.reminderUpdates.map((r) => `${r.date}: ${r.message}`).join(", ")}`);
      }

      await appendHot(`User: ${userMessage.slice(0, 200)}`);
      await appendHot(`Bot: ${response.reply.slice(0, 200)}`);

      const reply = response.reply;
      if (reply.length <= 4096) {
        await ctx.reply(reply);
      } else {
        for (const chunk of splitMessage(reply, 4096)) {
          await ctx.reply(chunk);
        }
      }
    } catch (err) {
      console.error("Error handling message:", err);
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  }

  return bot;
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) {
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt === -1 || splitAt < maxLen / 2) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
