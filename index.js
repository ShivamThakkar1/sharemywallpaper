require("dotenv").config();
const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");
const express = require("express");

// === Init Bot ===
const bot = new Telegraf(process.env.BOT_TOKEN);

// === MongoDB Setup ===
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const Submission = mongoose.model("Submission", {
  userId: Number,
  username: String,
  date: Date,
  count: Number,
});

const BannedUser = mongoose.model("BannedUser", {
  userId: Number,
});

const isBanned = async (id) => {
  const user = await BannedUser.findOne({ userId: id });
  return !!user;
};

// === /start Handler ===
bot.start(async (ctx) => {
  if (await isBanned(ctx.from.id)) return;

  return ctx.reply(`👋 Welcome to ShareMyWallpaperBot!

📤 You can send 1 or more wallpapers directly here.
🖼️ Each will be shared anonymously to our channel: @ShareMyWallpaper

🚫 Please avoid low-quality, offensive, or non-wallpaper images.
❌ Promotions are not allowed. Violations will result in a ban.`);
});

// === Photo Handler (supports single or multiple images) ===
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || "N/A";

  if (await isBanned(userId)) return;

  const message = ctx.message;

  if (!message.photo && !message.media_group_id) return;

  try {
    // Multiple photos (album)
    if (message.media_group_id) {
      // Do nothing here – Telegram sends each image individually
      return;
    }

    // Single photo
    const photos = message.photo;
    if (!photos) return;

    const largest = photos[photos.length - 1];

    await ctx.telegram.sendPhoto(process.env.CHANNEL_ID, largest.file_id, {
      caption: "🖼️ Shared by the community\n#wallpapers #aesthetic #minimal #sharemywallpaper",
    });

    await Submission.findOneAndUpdate(
      { userId },
      { $inc: { count: 1 }, username, date: new Date() },
      { upsert: true }
    );
  } catch (err) {
    console.error("Send Error:", err);
  }
});

// === /ban Command (admin only) ===
bot.command("ban", async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const parts = ctx.message.text.split(" ");
  const userId = parseInt(parts[1]);
  if (!userId) return ctx.reply("⚠️ Usage: /ban <user_id>");

  await BannedUser.updateOne({ userId }, {}, { upsert: true });
  ctx.reply(`🚫 User ${userId} has been banned.`);
});

// === /unban Command (admin only) ===
bot.command("unban", async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const parts = ctx.message.text.split(" ");
  const userId = parseInt(parts[1]);
  if (!userId) return ctx.reply("⚠️ Usage: /unban <user_id>");

  const result = await BannedUser.deleteOne({ userId });

  if (result.deletedCount > 0) {
    ctx.reply(`✅ User ${userId} has been unbanned.`);
  } else {
    ctx.reply(`ℹ️ User ${userId} was not banned.`);
  }
});

// === Launch Bot ===
bot.launch().then(() => {
  console.log("🤖 Bot is running");
});

// === Dummy HTTP server for Render ===
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🤖 ShareMyWallpaperBot is alive.");
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});