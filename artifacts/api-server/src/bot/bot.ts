import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import fs from "fs";
import { logger } from "../lib/logger";
import { downloadQueue } from "./queue";
import {
  isSupportedUrl,
  isYouTubeUrl,
  downloadVideo,
  downloadAudio,
  searchAndDownloadMusic,
} from "./downloader";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN muhit o'zgaruvchisi kerak");
}

export const bot = new Telegraf(token);

const HELP_TEXT = `
🎬 *Video va Musiqa Yuklovchi Bot*

*Video yuklash:*
YouTube yoki Instagram linkini yuboring

*Musiqa qidirish:*
/music <qo'shiqchi ismi - qo'shiq nomi>
Masalan: /music Sardor Rahimxon - Orzular

*YouTube audio:*
/audio <YouTube link>

*Yordam:*
/help — ushbu xabar
`;

bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `Salom, ${ctx.from.first_name}! 👋\n` + HELP_TEXT
  );
});

bot.help((ctx) => {
  ctx.replyWithMarkdown(HELP_TEXT);
});

bot.command("music", async (ctx) => {
  const query = ctx.message.text.replace(/^\/music\s*/i, "").trim();
  if (!query) {
    await ctx.reply(
      "❌ Qo'shiq nomini kiriting\nMasalan: /music Sardor Rahimxon - Orzular"
    );
    return;
  }

  const statusMsg = await ctx.reply(`🔍 Qidirilmoqda: *${query}*...`, {
    parse_mode: "Markdown",
  });

  downloadQueue.add(`music_${ctx.from.id}_${Date.now()}`, async () => {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `⬇️ Yuklanmoqda: *${query}*...`,
        { parse_mode: "Markdown" }
      );

      const result = await searchAndDownloadMusic(query);

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `📤 Yuborilmoqda...`
      );

      await ctx.replyWithAudio(
        { source: fs.createReadStream(result.filePath) },
        {
          title: result.title,
          performer: query.split(" - ")[0] ?? query,
          caption: `🎵 ${result.title}`,
        }
      );

      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      result.cleanup();
    } catch (err) {
      logger.error({ err, query }, "Music download failed");
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `❌ Topilmadi yoki yuklab bo'lmadi: *${query}*\nBoshqa nom bilan urinib ko'ring.`,
          { parse_mode: "Markdown" }
        )
        .catch(() =>
          ctx.reply(`❌ Topilmadi yoki yuklab bo'lmadi: ${query}`)
        );
    }
  });
});

bot.command("audio", async (ctx) => {
  const url = ctx.message.text.replace(/^\/audio\s*/i, "").trim();
  if (!url || !isYouTubeUrl(url)) {
    await ctx.reply("❌ YouTube linkini kiriting\nMasalan: /audio https://youtube.com/watch?v=...");
    return;
  }

  const statusMsg = await ctx.reply("⬇️ Audio yuklanmoqda...");

  downloadQueue.add(`audio_${ctx.from.id}_${Date.now()}`, async () => {
    try {
      const result = await downloadAudio(url);

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        "📤 Yuborilmoqda..."
      );

      await ctx.replyWithAudio(
        { source: fs.createReadStream(result.filePath) },
        {
          title: result.title,
          caption: `🎵 ${result.title}`,
        }
      );

      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      result.cleanup();
    } catch (err) {
      logger.error({ err, url }, "Audio download failed");
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          "❌ Yuklab bo'lmadi. Link to'g'riligini tekshiring."
        )
        .catch(() => ctx.reply("❌ Yuklab bo'lmadi."));
    }
  });
});

bot.on(message("text"), async (ctx) => {
  const text = ctx.message.text.trim();

  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return;

  const url = urlMatch[0];

  if (!isSupportedUrl(url)) {
    await ctx.reply(
      "❌ Faqat YouTube va Instagram linklari qo'llab-quvvatlanadi.\n\nMusiqa qidirish uchun: /music <qo'shiq nomi>"
    );
    return;
  }

  const statusMsg = await ctx.reply("⬇️ Video yuklanmoqda, iltimos kuting...");

  downloadQueue.add(`video_${ctx.from.id}_${Date.now()}`, async () => {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        "⬇️ Yuklanmoqda... (1-2 daqiqa ketishi mumkin)"
      );

      const result = await downloadVideo(url);

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        "📤 Yuborilmoqda..."
      );

      const stat = await fs.promises.stat(result.filePath);
      const sizeMb = stat.size / (1024 * 1024);

      if (sizeMb > 50) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `❌ Video juda katta (${sizeMb.toFixed(0)} MB). Telegram 50 MB gacha ruxsat beradi.`
        );
        result.cleanup();
        return;
      }

      await ctx.replyWithVideo(
        { source: fs.createReadStream(result.filePath) },
        { caption: `🎬 ${result.title}` }
      );

      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      result.cleanup();
    } catch (err) {
      logger.error({ err, url }, "Video download failed");
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `❌ Yuklab bo'lmadi.\n${errMsg.includes("Unsupported URL") ? "Bu link qo'llab-quvvatlanmaydi." : "Link xato yoki video mavjud emas."}`
        )
        .catch(() => ctx.reply("❌ Yuklab bo'lmadi."));
    }
  });
});

bot.catch((err, ctx) => {
  logger.error({ err, updateType: ctx.updateType }, "Bot error");
});

export function startBot() {
  bot.launch({ dropPendingUpdates: true });
  logger.info("Telegram bot ishga tushdi");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
