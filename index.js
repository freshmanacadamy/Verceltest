import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Telegram Bot Token from Vercel environment variables
const TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// Webhook endpoint
app.post(`/webhook/${TOKEN}`, async (req, res) => {
  try {
    const message = req.body.message;
    if (message && message.text) {
      const chatId = message.chat.id;
      const text = message.text;

      // Echo back the same message
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `You said: ${text}`,
        }),
      });
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// Root endpoint to check if bot is running
app.get("/", (req, res) => {
  res.send("🤖 Echo Bot is running!");
});

export default app;
