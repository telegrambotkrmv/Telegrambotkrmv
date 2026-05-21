import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "../lib/logger";

const execAsync = promisify(exec);

export type DownloadResult = {
  filePath: string;
  title: string;
  cleanup: () => void;
};

export type SoundCloudTrack = {
  title: string;
  url: string;
  user: string;
  durationSec: number;
};

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), "tgbot_downloads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isInstagramUrl(url: string): boolean {
  return /instagram\.com/.test(url);
}

let _scClientId: string | null = null;

async function getSoundCloudClientId(): Promise<string> {
  if (_scClientId) return _scClientId;

  const homeHtml = await fetch("https://soundcloud.com/").then((r) => r.text());
  const jsUrls = [...homeHtml.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/\d+-[a-f0-9]+\.js/g)].map((m) => m[0]);

  for (const jsUrl of jsUrls) {
    try {
      const js = await fetch(jsUrl).then((r) => r.text());
      const match = js.match(/client_id:"([^"]+)"/);
      if (match) {
        _scClientId = match[1];
        logger.info({ clientId: _scClientId }, "SoundCloud client_id found");
        return _scClientId;
      }
    } catch {}
  }
  throw new Error("SoundCloud client_id topilmadi");
}

export async function searchSoundCloud(query: string, limit = 10): Promise<SoundCloudTrack[]> {
  const clientId = await getSoundCloudClientId();
  const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    _scClientId = null;
    throw new Error(`SoundCloud API xatosi: ${res.status}`);
  }

  const data = await res.json() as {
    collection: Array<{
      title: string;
      permalink_url: string;
      duration: number;
      user: { username: string };
    }>;
  };

  if (!data.collection || data.collection.length === 0) {
    throw new Error("Qo'shiq topilmadi");
  }

  return data.collection.slice(0, limit).map((t) => ({
    title: t.title,
    url: t.permalink_url,
    user: t.user?.username ?? "",
    durationSec: Math.round((t.duration ?? 0) / 1000),
  }));
}

export async function downloadAudio(url: string): Promise<DownloadResult> {
  const tmpDir = getTempDir();
  const outputTemplate = path.join(tmpDir, "%(title)s.%(ext)s");

  logger.info({ url }, "Downloading audio");

  const { stdout } = await execAsync(
    `yt-dlp --no-playlist --format "bestaudio" -x --audio-format mp3 --audio-quality 5 --no-warnings -N 4 -o "${outputTemplate}" "${url}"`,
    { timeout: 120000 }
  );

  const destMatch = stdout.match(/\[ExtractAudio\] Destination: (.+\.mp3)/);
  const dlMatch = stdout.match(/\[download\] Destination: (.+)/);

  let filePath = "";
  if (destMatch) {
    filePath = destMatch[1].trim();
  } else if (dlMatch) {
    filePath = dlMatch[1].trim().replace(/\.[^.]+$/, "") + ".mp3";
  }

  if (!filePath || !fs.existsSync(filePath)) {
    const files = fs.readdirSync(tmpDir)
      .filter((f) => f.endsWith(".mp3"))
      .map((f) => ({ name: f, time: fs.statSync(path.join(tmpDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (!files.length) throw new Error("Audio fayl topilmadi");
    filePath = path.join(tmpDir, files[0].name);
  }

  const title = path.basename(filePath, ".mp3");
  return {
    filePath,
    title,
    cleanup: () => { try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {} },
  };
}

export async function getInstagramDirectUrl(url: string): Promise<{ videoUrl: string; title: string } | null> {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --get-url --get-title --no-playlist --no-warnings --format "best[ext=mp4]/best" "${url}"`,
      { timeout: 20000 }
    );
    const lines = stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      return { title: lines[0], videoUrl: lines[lines.length - 1] };
    }
    if (lines.length === 1 && lines[0].startsWith("http")) {
      return { title: "Instagram video", videoUrl: lines[0] };
    }
  } catch (err) {
    logger.warn({ err }, "getInstagramDirectUrl failed, will fall back to file download");
  }
  return null;
}

export async function downloadInstagramVideo(url: string): Promise<DownloadResult> {
  const tmpDir = getTempDir();
  const outputTemplate = path.join(tmpDir, "ig_%(id)s.%(ext)s");

  logger.info({ url }, "Downloading Instagram video as file");

  const { stdout } = await execAsync(
    `yt-dlp --no-playlist --max-filesize 50m --format "best[ext=mp4]/best" --merge-output-format mp4 --no-warnings --concurrent-fragments 8 -o "${outputTemplate}" "${url}"`,
    { timeout: 90000 }
  );

  const mergeMatch = stdout.match(/\[Merger\] Merging formats into "(.+)"/);
  const dlMatch = stdout.match(/\[download\] Destination: (.+)/);

  let filePath = "";
  if (mergeMatch) filePath = mergeMatch[1].trim();
  else if (dlMatch) filePath = dlMatch[1].trim();

  if (!filePath || !fs.existsSync(filePath)) {
    const files = fs.readdirSync(tmpDir)
      .filter((f) => f.startsWith("ig_") && f.endsWith(".mp4"))
      .map((f) => ({ name: f, time: fs.statSync(path.join(tmpDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (!files.length) throw new Error("Video fayl topilmadi");
    filePath = path.join(tmpDir, files[0].name);
  }

  const title = "Instagram video";
  return {
    filePath,
    title,
    cleanup: () => { try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {} },
  };
}
