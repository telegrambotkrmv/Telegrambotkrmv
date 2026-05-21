# Video Downloader Telegram Bot

YouTube va Instagram videolarini yuklovchi va qo'shiqchi ismi orqali musiqa qidiruvchi Telegram bot.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server va botni ishga tushirish (port 8080)
- `pnpm run typecheck` — barcha paketlarni typecheck qilish
- `pnpm run build` — typecheck + build

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: Telegraf 4
- Video/Audio: yt-dlp + ffmpeg
- Queue: in-memory SimpleQueue (3 parallel download)

## Where things live

- `artifacts/api-server/src/bot/bot.ts` — Telegram bot logic
- `artifacts/api-server/src/bot/downloader.ts` — yt-dlp download wrapper
- `artifacts/api-server/src/bot/queue.ts` — In-memory queue (3 concurrent)
- `artifacts/api-server/src/index.ts` — Server entry point, bot start

## Bot Commands

- YouTube yoki Instagram linkini yuboring → video yuklanadi
- `/music <qo'shiqchi - qo'shiq>` → YouTube'dan qidiradi va MP3 yuboradi
- `/audio <YouTube link>` → faqat audio/MP3 formatda yuklaydi
- `/start`, `/help` → yo'riqnoma

## Architecture decisions

- yt-dlp system package ishlatiladi (Node.js wrapper emas) — eng ishonchli yondashuv
- 50 MB fayl limiti — Telegram Bot API cheklovi
- in-memory queue (Redis o'rniga) — Replit muhitida sodda va ishonchli
- Fayllar /tmp papkasiga yuklanadi va yuborilgach o'chiriladi — disk joy tejash

## User preferences

- Bot interfeysi O'zbek tilida

## Gotchas

- Telegram 50 MB dan katta fayllarni qabul qilmaydi
- Instagram ko'pincha IP bloklaydi — ba'zi videolar yuklanmasligi mumkin
- yt-dlp ni yangilab turish kerak: `nix shell nixpkgs#yt-dlp`
