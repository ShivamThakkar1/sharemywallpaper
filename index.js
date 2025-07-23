require("dotenv").config();
const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");

const bot = new Telegraf(process.env.BOT_TOKEN);

// MongoDB schema setup
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

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

// Handle /start
bot.start(async (ctx) => {
  const banned = await isBanned(ctx.from.id);
  if (banned) return;

  return ctx.reply(`👋 Welcome to ShareMyWallpaperBot!

📤 You can send 1 or more wallpapers directly here.
🖼️ Each will be shared anonymously to our channel: @ShareMyWallpaper

🚫 Please avoid low-quality, offensive, or non-wallpaper images.
❌ Promotions are not allowed. Violations will result in a ban.`);
});

// Handle photo(s)
bot.on("photo", async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || "N/A";
  const banned = await isBanned(userId);

  if (banned) return;

  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];

  try {
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

// Admin: ban a user
bot.command("ban", async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const parts = ctx.message.text.split(" ");
  const userId = parseInt(parts[1]);
  if (!userId) return ctx.reply("⚠️ Provide a valid user ID: /ban <user_id>");

  await BannedUser.updateOne({ userId }, {}, { upsert: true });
  ctx.reply(`🚫 User ${userId} has been banned.`);
});

bot.launch();
