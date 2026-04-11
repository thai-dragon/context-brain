import "dotenv/config";
import { createBot } from "./bot";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = parseInt(process.env.PORT || "3000", 10);

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

const bot = createBot(TOKEN);

async function start() {
  if (WEBHOOK_URL) {
    // Production: webhook mode
    const webhookPath = `/webhook/${TOKEN}`;
    await bot.launch({
      webhook: {
        domain: WEBHOOK_URL,
        path: webhookPath,
        port: PORT,
        host: "0.0.0.0",
      },
    });
    console.log(`Bot running in webhook mode on port ${PORT}`);
  } else {
    // Development: polling mode
    await bot.launch();
    console.log("Bot running in polling mode");
  }
}

start().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
