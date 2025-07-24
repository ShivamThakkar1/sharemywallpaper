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

// Models
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

// Check if user has joined the channel
const hasJoinedChannel = async (userId) => {
  try {
    const member = await bot.telegram.getChatMember(process.env.CHANNEL_ID, userId);
    return ["member", "creator", "administrator"].includes(member.status);
  } catch (e) {
    console.error("❌ Error checking membership:", e.message);
    return false;
  }
};

// Store pending messages
const pendingSubmissions = new Map();
const mediaGroups = {};

// Helper: Send Join Prompt with Buttons
function sendChannelJoinMessage(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "📲 Join Channel", url: "https://t.me/ShareMyWallpaper" },
        { text: "✅ I've Joined", callback_data: "check_join" }
      ]
    ]
  };

  bot.telegram.sendMessage(
    chatId,
    `🔒 To submit wallpapers, please join our community channel first!\n\n` +
    `📢 Channel: @ShareMyWallpaper\n\n` +
    `Once you've joined, click *I've Joined* to continue.`,
    {
      reply_markup: keyboard,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    }
  );
}

// Start command
bot.start(async (ctx) => {
  if (await isBanned(ctx.from.id)) return;

  return ctx.reply(`👋 Welcome to *ShareMyWallpaperBot*!

📤 You can send one or more wallpapers directly here.
🖼️ All submissions are shared anonymously to our channel: @ShareMyWallpaper

📌 *Rules & Guidelines*:
• Only high-quality wallpapers (aesthetic, minimal, creative, etc.)
• No promotions, advertisements, or unrelated content
• Please *avoid religious content* (quotes, images, or messages) — this helps us keep the focus entirely on wallpapers for a broad audience
• Repeated violations may lead to a ban

✅ If you're ready, simply send your wallpapers now!`, {
    parse_mode: "Markdown",
  });
});

// Main handler for image submissions and rejections
bot.on("message", async (ctx) => {
  const msg = ctx.message;
  const userId = msg.from.id;

  if (await isBanned(userId)) return;

  const joined = await hasJoinedChannel(userId);
  if (!joined) {
    pendingSubmissions.set(userId, msg);
    return sendChannelJoinMessage(ctx.chat.id);
  }

  // Accept only photo or media group
  if (msg.photo || msg.media_group_id) {
    return await handleSubmission(ctx, msg);
  }

  // Reject unsupported content types
  if (
    msg.video ||
    msg.document ||
    msg.voice ||
    msg.audio ||
    msg.sticker
  ) {
    return ctx.reply(
      `❌ Sorry, only *photo wallpapers* are accepted.\n\n` +
      `Please avoid videos, documents, stickers, voice notes, or unsupported formats.`,
      { parse_mode: "Markdown" }
    );
  }

  // Catch-all rejection for any other unknown types
  return ctx.reply(
    `❌ Unsupported format detected. Please only send image wallpapers.`,
    { parse_mode: "Markdown" }
  );
});

// Handle "✅ I've Joined" button
bot.action("check_join", async (ctx) => {
  const userId = ctx.from.id;

  const joined = await hasJoinedChannel(userId);
  if (!joined) {
    return ctx.answerCbQuery("❌ You haven't joined yet!", { show_alert: true });
  }

  const msg = pendingSubmissions.get(userId);
  if (!msg) {
    return ctx.answerCbQuery("✅ Already checked or expired.");
  }

  const fakeCtx = Object.assign({}, ctx, { message: msg });

  if (msg.photo || msg.media_group_id) {
    await handleSubmission(fakeCtx, msg);
  } else {
    await ctx.telegram.sendMessage(userId, `❌ Only photo wallpapers are accepted. Please send a valid wallpaper image.`);
  }

  pendingSubmissions.delete(userId);

  return ctx.answerCbQuery("✅ Thanks! Your wallpapers have been submitted.");
});

// Process photo submissions
async function handleSubmission(ctx, msg) {
  const userId = msg.from.id;
  const username = msg.from.username || "N/A";

  // Album
  if (msg.media_group_id) {
    const groupId = msg.media_group_id;

    if (!mediaGroups[groupId]) {
      mediaGroups[groupId] = { items: [] };
    }

    const photo = msg.photo?.[msg.photo.length - 1];
    if (photo) {
      mediaGroups[groupId].items.push({
        type: "photo",
        media: photo.file_id,
      });
    }

    if (!mediaGroups[groupId].timeout) {
      mediaGroups[groupId].timeout = setTimeout(async () => {
        const group = mediaGroups[groupId];
        const items = group.items;

        if (items.length > 0) {
          items[0].caption =
            "🖼️ Shared by the community\n#wallpapers #aesthetic #minimal #sharemywallpaper";

          try {
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
  }

  // Single photo
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
}

// /ban <user_id>
bot.command("ban", async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const parts = ctx.message.text.split(" ");
  const userId = parseInt(parts[1]);
  if (!userId) return ctx.reply("⚠️ Usage: /ban <user_id>");

  await BannedUser.updateOne({ userId }, {}, { upsert: true });
  ctx.reply(`🚫 User ${userId} has been banned.`);
});

// /unban <user_id>
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

// Start bot
bot.launch().then(() => {
  console.log("🤖 Bot is running");
});

// Dummy HTTP server for Render (keeps it alive)
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🤖 ShareMyWallpaperBot is alive.");
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});