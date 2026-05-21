import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import fs from "fs";
import { logger } from "../lib/logger";
import { downloadQueue } from "./queue";
import {
  isInstagramUrl,
  isSupportedUrl,
  searchAndDownloadMusic,
  downloadAudio,
  getInstagramDirectUrl,
  downloadInstagramVideo,
} from "./downloader";
import { registerUser, getAllUsers, getUserCount } from "./users";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN muhit o'zgaruvchisi kerak");

const ADMIN_ID = 6199569947;

export const bot = new Telegraf(token);

const HELP_TEXT = `
🎬 *Video va Musiqa Yuklovchi Bot*

*Instagram video:*
Instagram linkini yuboring

*Musiqa qidirish:*
Qo'shiq yoki qo'shiqchi nomini yozing
Masalan: _Sardor Rahimxon_ yoki _Shaxzoda Baxtim_

*Yordam:*
/help — ushbu xabar
`;

function isAdmin(id: number) {
  return id === ADMIN_ID;
}

async function handleMusicSearch(ctx: any, query: string) {
  const statusMsg = await ctx.reply(`🔍 Qidirilmoqda: *${query}*...`, {
    parse_mode: "Markdown",
  });

  downloadQueue.add(`music_${ctx.from.id}_${Date.now()}`, async () => {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined,
        `⬇️ Yuklanmoqda: *${query}*...`,
        { parse_mode: "Markdown" }
      );

      const result = await searchAndDownloadMusic(query);

      await ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined, "📤 Yuborilmoqda..."
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
      logger.error({ err, query }, "Music search failed");
      await ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined,
        `❌ Topilmadi: *${query}*\nBoshqa nom bilan urinib ko'ring.`,
        { parse_mode: "Markdown" }
      ).catch(() => ctx.reply(`❌ Topilmadi: ${query}`));
    }
  });
}

bot.start((ctx) => {
  registerUser(ctx.from.id);
  ctx.replyWithMarkdown(`Salom, ${ctx.from.first_name}! 👋\n` + HELP_TEXT);
});

bot.help((ctx) => {
  registerUser(ctx.from.id);
  ctx.replyWithMarkdown(HELP_TEXT);
});

bot.command("audio", async (ctx) => {
  registerUser(ctx.from.id);
  const url = ctx.message.text.replace(/^\/audio\s*/i, "").trim();
  if (!url) {
    await ctx.reply("❌ Link kiriting\nMasalan: /audio https://soundcloud.com/...");
    return;
  }

  const statusMsg = await ctx.reply("⬇️ Audio yuklanmoqda...");

  downloadQueue.add(`audio_${ctx.from.id}_${Date.now()}`, async () => {
    try {
      const result = await downloadAudio(url);

      await ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined, "📤 Yuborilmoqda..."
      );

      await ctx.replyWithAudio(
        { source: fs.createReadStream(result.filePath) },
        { title: result.title, caption: `🎵 ${result.title}` }
      );

      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      result.cleanup();
    } catch (err) {
      logger.error({ err, url }, "Audio download failed");
      await ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined,
        "❌ Yuklab bo'lmadi. Link to'g'riligini tekshiring."
      ).catch(() => ctx.reply("❌ Yuklab bo'lmadi."));
    }
  });
});

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Sizda bu buyruqni ishlatish huquqi yo'q.");
    return;
  }

  const text = ctx.message.text.replace(/^\/broadcast\s*/i, "").trim();
  if (!text) {
    await ctx.reply(
      "📢 *Broadcast yuborish:*\n/broadcast <xabar matni>",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const userIds = getAllUsers();
  const statusMsg = await ctx.reply(`📤 Yuborilmoqda... (${userIds.length} ta foydalanuvchi)`);

  let success = 0, failed = 0;
  for (const userId of userIds) {
    try {
      await ctx.telegram.sendMessage(userId, text);
      success++;
      await new Promise((r) => setTimeout(r, 50));
    } catch { failed++; }
  }

  await ctx.telegram.editMessageText(
    ctx.chat.id, statusMsg.message_id, undefined,
    `✅ Broadcast yakunlandi!\n\n📊 Natija:\n• Yuborildi: ${success}\n• Xato: ${failed}\n• Jami: ${userIds.length}`
  );
});

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Sizda bu buyruqni ishlatish huquqi yo'q.");
    return;
  }
  await ctx.reply(
    `📊 *Bot statistikasi*\n\n👥 Foydalanuvchilar: ${getUserCount()} ta`,
    { parse_mode: "Markdown" }
  );
});

bot.on(message("text"), async (ctx) => {
  registerUser(ctx.from.id);
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return;

  const urlMatch = text.match(/https?:\/\/[^\s]+/);

  if (urlMatch) {
    const url = urlMatch[0];

    if (!isSupportedUrl(url)) {
      await ctx.reply(
        "❌ Faqat Instagram linklari qo'llab-quvvatlanadi.\n\nMusiqa qidirish uchun qo'shiq nomini yozing."
      );
      return;
    }

    if (isInstagramUrl(url)) {
      const statusMsg = await ctx.reply("⬇️ Yuklanmoqda...");

      downloadQueue.add(`insta_${ctx.from.id}_${Date.now()}`, async () => {
        try {
          const direct = await getInstagramDirectUrl(url);

          if (direct) {
            await ctx.telegram.editMessageText(
              ctx.chat.id, statusMsg.message_id, undefined, "📤 Yuborilmoqda..."
            );
            await ctx.replyWithVideo(direct.videoUrl, { caption: `🎬 ${direct.title}` });
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
          } else {
            await ctx.telegram.editMessageText(
              ctx.chat.id, statusMsg.message_id, undefined,
              "⬇️ Yuklanmoqda... (bir oz kuting)"
            );
            const result = await downloadInstagramVideo(url);
            const stat = await fs.promises.stat(result.filePath);
            const sizeMb = stat.size / (1024 * 1024);
            if (sizeMb > 50) {
              await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsg.message_id, undefined,
                `❌ Video juda katta (${sizeMb.toFixed(0)} MB). Telegram 50 MB gacha ruxsat beradi.`
              );
              result.cleanup();
              return;
            }
            await ctx.telegram.editMessageText(
              ctx.chat.id, statusMsg.message_id, undefined, "📤 Yuborilmoqda..."
            );
            await ctx.replyWithVideo(
              { source: fs.createReadStream(result.filePath) },
              { caption: `🎬 ${result.title}` }
            );
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
            result.cleanup();
          }
        } catch (err) {
          logger.error({ err, url }, "Instagram download failed");
          await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, undefined,
            "❌ Yuklab bo'lmadi.\nBu reel yopiq yoki mavjud emas bo'lishi mumkin."
          ).catch(() => ctx.reply("❌ Yuklab bo'lmadi."));
        }
      });
    }
    return;
  }

  await handleMusicSearch(ctx, text);
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
