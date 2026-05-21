import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import fs from "fs";
import { logger } from "../lib/logger";
import { downloadQueue } from "./queue";
import {
  isInstagramUrl,
  searchSoundCloud,
  downloadAudio,
  getInstagramDirectUrl,
  downloadInstagramVideo,
  type SoundCloudTrack,
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
Qo'shiqchi yoki qo'shiq nomini yozing
_Masalan: Sardor Rahimxon yoki Shaxzoda_

Ro'yxatdan kerakli qo'shiqni tanlaysiz.

*Yordam:*
/help — ushbu xabar
`;

const LOADING_FRAMES = ["⏳ Yuklanmoqda", "⏳ Yuklanmoqda.", "⏳ Yuklanmoqda..", "⏳ Yuklanmoqda..."];

function startProgressUpdater(
  chatId: number,
  messageId: number,
  telegram: Telegraf["telegram"],
  label: string
): () => void {
  let frame = 0;
  let seconds = 0;
  const interval = setInterval(async () => {
    seconds += 5;
    frame = (frame + 1) % LOADING_FRAMES.length;
    try {
      await telegram.editMessageText(
        chatId, messageId, undefined,
        `${LOADING_FRAMES[frame]} (${seconds}s)\n📥 ${label}`
      );
    } catch {}
  }, 5000);
  return () => clearInterval(interval);
}

function isAdmin(id: number) {
  return id === ADMIN_ID;
}

function formatDuration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const searchCache = new Map<string, SoundCloudTrack[]>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheSearch(tracks: SoundCloudTrack[]): string {
  const id = Math.random().toString(36).slice(2, 10);
  searchCache.set(id, tracks);
  setTimeout(() => searchCache.delete(id), CACHE_TTL_MS);
  return id;
}

async function handleMusicSearch(ctx: any, query: string) {
  const statusMsg = await ctx.reply(`🔍 Qidirilmoqda: *${query}*...`, { parse_mode: "Markdown" });

  try {
    const tracks = await searchSoundCloud(query, 10);
    const cacheId = cacheSearch(tracks);

    const buttons = tracks.map((t, i) => {
      const dur = formatDuration(t.durationSec);
      let label = `${i + 1}. ${t.title}`;
      if (dur) label += ` • ${dur}`;
      if (label.length > 64) label = label.slice(0, 61) + "...";
      return [Markup.button.callback(label, `pick:${cacheId}:${i}`)];
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      `🎵 *${query}* — topildi ${tracks.length} ta qo'shiq:\nKerakligini tanlang 👇`,
      { parse_mode: "Markdown", reply_markup: Markup.inlineKeyboard(buttons).reply_markup }
    );
  } catch (err) {
    logger.error({ err, query }, "Music search failed");
    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      `❌ Topilmadi: *${query}*\nBoshqa nom bilan urinib ko'ring.`,
      { parse_mode: "Markdown" }
    ).catch(() => ctx.reply(`❌ Topilmadi: ${query}`));
  }
}

bot.action(/^pick:([a-z0-9]+):(\d+)$/, async (ctx) => {
  const cacheId = ctx.match[1];
  const index = parseInt(ctx.match[2], 10);
  const tracks = searchCache.get(cacheId);

  if (!tracks || !tracks[index]) {
    await ctx.answerCbQuery("❌ Ro'yxat eskirgan, qaytadan qidiring.").catch(() => {});
    return;
  }

  const track = tracks[index];
  await ctx.answerCbQuery(`Yuklanmoqda: ${track.title.slice(0, 50)}`).catch(() => {});

  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch {}

  const statusMsg = await ctx.reply(`⏳ Yuklanmoqda...\n📥 ${track.title}`);

  downloadQueue.add(`music_${ctx.from!.id}_${Date.now()}`, async () => {
    const stop = startProgressUpdater(
      statusMsg.chat.id, statusMsg.message_id, ctx.telegram, track.title
    );
    let result: { filePath: string; title: string; cleanup: () => void } | null = null;
    try {
      result = await downloadAudio(track.url);
      stop();

      await ctx.telegram.editMessageText(
        statusMsg.chat.id, statusMsg.message_id, undefined, "📤 Yuborilmoqda..."
      ).catch(() => {});

      await ctx.replyWithAudio(
        { source: fs.createReadStream(result.filePath) },
        {
          title: result.title,
          performer: track.user,
          duration: track.durationSec,
          caption: `🎵 ${result.title}`,
        }
      );

      await ctx.telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
    } catch (err) {
      stop();
      logger.error({ err, url: track.url }, "Audio download/send failed");
      await ctx.telegram.editMessageText(
        statusMsg.chat.id, statusMsg.message_id, undefined,
        `❌ Yuklab bo'lmadi: ${track.title}`
      ).catch(() => {});
    } finally {
      result?.cleanup();
    }
  });
});

bot.start((ctx) => {
  registerUser(ctx.from.id);
  ctx.replyWithMarkdown(`Salom, ${ctx.from.first_name}! 👋\n` + HELP_TEXT);
});

bot.help((ctx) => {
  registerUser(ctx.from.id);
  ctx.replyWithMarkdown(HELP_TEXT);
});

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Sizda bu buyruqni ishlatish huquqi yo'q.");
    return;
  }
  const text = ctx.message.text.replace(/^\/broadcast\s*/i, "").trim();
  if (!text) {
    await ctx.reply("📢 Ishlatish: /broadcast <xabar matni>");
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
    `✅ Broadcast yakunlandi!\n\n📊 Yuborildi: ${success}\n❌ Xato: ${failed}\n👥 Jami: ${userIds.length}`
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

    if (!isInstagramUrl(url)) {
      await ctx.reply("❌ Faqat Instagram linklari qo'llab-quvvatlanadi.\n\nMusiqa uchun qo'shiq nomini yozing.");
      return;
    }

    const statusMsg = await ctx.reply("⏳ Yuklanmoqda...\n📥 Instagram video");

    downloadQueue.add(`insta_${ctx.from.id}_${Date.now()}`, async () => {
      const stop = startProgressUpdater(
        ctx.chat.id, statusMsg.message_id, ctx.telegram, "Instagram video"
      );
      let result: { filePath: string; title: string; cleanup: () => void } | null = null;
      try {
        let sentViaUrl = false;
        const direct = await getInstagramDirectUrl(url);

        if (direct) {
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id, statusMsg.message_id, undefined, "📤 Yuborilmoqda..."
            ).catch(() => {});
            await ctx.replyWithVideo(direct.videoUrl, { caption: `🎬 ${direct.title}` });
            sentViaUrl = true;
          } catch (err) {
            logger.warn({ err }, "Telegram rejected direct URL, falling back to file");
          }
        }

        if (!sentViaUrl) {
          await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, undefined,
            "⏳ Yuklanmoqda...\n📥 Instagram video (fayl orqali)"
          ).catch(() => {});

          result = await downloadInstagramVideo(url);
          const stat = await fs.promises.stat(result.filePath);
          const sizeMb = stat.size / (1024 * 1024);
          if (sizeMb > 50) {
            stop();
            await ctx.telegram.editMessageText(
              ctx.chat.id, statusMsg.message_id, undefined,
              `❌ Video juda katta (${sizeMb.toFixed(0)} MB). Telegram 50 MB gacha ruxsat beradi.`
            ).catch(() => {});
            return;
          }

          await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, undefined, "📤 Yuborilmoqda..."
          ).catch(() => {});
          await ctx.replyWithVideo(
            { source: fs.createReadStream(result.filePath) },
            { caption: `🎬 ${result.title}` }
          );
        }

        stop();
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      } catch (err) {
        stop();
        logger.error({ err, url }, "Instagram download failed");
        await ctx.telegram.editMessageText(
          ctx.chat.id, statusMsg.message_id, undefined,
          "❌ Yuklab bo'lmadi.\nReel yopiq, o'chirilgan yoki Instagram bloklagan bo'lishi mumkin."
        ).catch(() => ctx.reply("❌ Yuklab bo'lmadi."));
      } finally {
        result?.cleanup();
      }
    });
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
