import { Telegraf, Context } from "telegraf";
import {
  readHot,
  clearHot,
  appendHot,
  applyWikiUpdates,
  searchWiki,
  getWikiSummary,
  readWikiPage,
} from "./wiki";
import { vectorSearch } from "./embeddings";
import { chat } from "./claude";
import { transcribeVoice } from "./transcribe";

const ALLOWED_USERS = (process.env.ALLOWED_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function isAllowed(ctx: Context): boolean {
  if (ALLOWED_USERS.length === 0) return true; // open if not configured
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
        "/memory - show current session context\n" +
        "/forget - clear session context\n" +
        "/wiki <query> - search wiki pages"
    );
  });

  bot.command("memory", (ctx) => {
    const hot = readHot();
    const trimmed = hot.length > 4000 ? hot.slice(-4000) + "\n...(truncated)" : hot;
    ctx.reply(trimmed || "No session context yet.");
  });

  bot.command("forget", (ctx) => {
    clearHot();
    ctx.reply("Session context cleared.");
  });

  bot.command("wiki", async (ctx) => {
    const query = ctx.message.text.replace(/^\/wiki\s*/, "").trim();
    if (!query) {
      const summary = getWikiSummary();
      ctx.reply(summary);
      return;
    }

    // Try vector search first, fall back to keyword search
    let results: string[] = await vectorSearch(query, 5);
    const searchType = results.length > 0 ? "semantic" : "keyword";
    if (results.length === 0) {
      results = searchWiki(query).slice(0, 5);
    }

    if (results.length === 0) {
      ctx.reply(`No wiki pages found for "${query}".`);
      return;
    }

    let response = `Found ${results.length} page(s) [${searchType} search]:\n\n`;
    for (const page of results) {
      const content = readWikiPage(page);
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

      const hotContext = readHot();
      const wikiSummary = getWikiSummary();

      // Vector search for relevant context; fall back to keyword search
      let relevantPages = await vectorSearch(userMessage, 5);
      if (relevantPages.length === 0) {
        const words = userMessage.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const keywordPages = new Set<string>();
        for (const word of words) {
          for (const page of searchWiki(word)) {
            keywordPages.add(page);
          }
        }
        relevantPages = [...keywordPages].slice(0, 5);
      }

      const response = await chat(userMessage, hotContext, wikiSummary, relevantPages);

      if (response.wikiUpdates.length > 0) {
        await applyWikiUpdates(response.wikiUpdates);
        console.log(`Wiki updated: ${response.wikiUpdates.map((u) => u.path).join(", ")}`);
      }

      appendHot(`User: ${userMessage.slice(0, 200)}`);
      appendHot(`Bot: ${response.reply.slice(0, 200)}`);

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
