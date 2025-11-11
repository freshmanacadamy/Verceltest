import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const TOKEN = process.env.BOT_TOKEN; // Set this in Vercel environment
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// Webhook endpoint
app.post(`/webhook/${TOKEN}`, async (req, res) => {
  const message = req.body?.message;
  if (message && message.text) {
    const chatId = message.chat.id;
    const text = message.text;

    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `You said: ${text}` }),
    });
  }
  res.sendStatus(200);
});

// Test endpoint
app.get("/", (req, res) => {
  res.send("🤖 Telegram Bot is running!");
});

export default app;
