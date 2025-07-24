require("dotenv").config();
const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");
const express = require("express");

const bot = new Telegraf(process.env.BOT_TOKEN);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// MongoDB models
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

// /start handler
bot.start(async (ctx) => {
  if (await isBanned(ctx.from.id)) return;

  return ctx.reply(`👋 Welcome to ShareMyWallpaperBot!

📤 You can send 1 or more wallpapers directly here.
🖼️ Each will be shared anonymously to our channel: @ShareMyWallpaper

🚫 Please avoid low-quality, offensive, or non-wallpaper images.
❌ Promotions are not allowed. Violations will result in a ban.`);
});

// Media group handling
const mediaGroups = {};

bot.on("message", async (ctx) => {
  const msg = ctx.message;
  const userId = msg.from.id;
  const username = msg.from.username || "N/A";

  if (await isBanned(userId)) return;

  // Handle media group (albums)
  if (msg.media_group_id) {
    const groupId = msg.media_group_id;

    if (!mediaGroups[groupId]) {
      mediaGroups[groupId] = [];
    }

    const photo = msg.photo?.[msg.photo.length - 1];
    if (photo) {
      mediaGroups[groupId].push({
        type: "photo",
        media: photo.file_id,
      });
    }

    // Delay sending to wait for all images in group
    setTimeout(async () => {
      const items = mediaGroups[groupId];
      if (items && items.length > 0) {
        try {
          items[0].caption =
            "🖼️ Shared by the community\n#wallpapers #aesthetic #minimal #sharemywallpaper";

          await ctx.telegram.sendMediaGroup(process.env.CHANNEL_ID, items);

          await Submission.findOneAndUpdate(
            { userId },
            { $inc: { count: items.length }, username, date: new Date() },
            { upsert: true }
          );
        } catch (err) {
          console.error("❌ Media group send error:", err);
        }
      }

      delete mediaGroups[groupId];
    }, 1500);
  }

  // Handle single photo
  else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];

    try {
      await ctx.telegram.sendPhoto(process.env.CHANNEL_ID, photo.file_id, {
        caption:
          "🖼️ Shared by the community\n#wallpapers #aesthetic #minimal #sharemywallpaper",
      });

      await Submission.findOneAndUpdate(
        { userId },
        { $inc: { count: 1 }, username, date: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.error("❌ Single photo send error:", err);
    }
  }
});

// /ban command (admin only)
bot.command("ban", async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const parts = ctx.message.text.split(" ");
  const userId = parseInt(parts[1]);
  if (!userId) return ctx.reply("⚠️ Usage: /ban <user_id>");

  await BannedUser.updateOne({ userId }, {}, { upsert: true });
  ctx.reply(`🚫 User ${userId} has been banned.`);
});

// /unban command (admin only)
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

// Launch bot
bot.launch().then(() => {
  console.log("🤖 Bot is running");
});

// Dummy HTTP server for Render Web Service
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🤖 ShareMyWallpaperBot is alive.");
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});