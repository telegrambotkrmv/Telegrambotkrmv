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

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), "tgbot_downloads");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

export function isInstagramUrl(url: string): boolean {
  return /instagram\.com/.test(url);
}

export function isSupportedUrl(url: string): boolean {
  return isYouTubeUrl(url) || isInstagramUrl(url);
}

export async function downloadVideo(url: string): Promise<DownloadResult> {
  const tmpDir = getTempDir();
  const outputTemplate = path.join(tmpDir, "%(title)s.%(ext)s");

  logger.info({ url }, "Starting video download");

  const ytdlpArgs = [
    `"${url}"`,
    `-o "${outputTemplate}"`,
    "--no-playlist",
    "--max-filesize 50m",
    "--format bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format mp4",
    "--no-warnings",
    "--socket-timeout 30",
  ].join(" ");

  const { stdout, stderr } = await execAsync(`yt-dlp ${ytdlpArgs}`, {
    timeout: 120000,
  });

  logger.info({ stdout }, "yt-dlp output");
  if (stderr) logger.warn({ stderr }, "yt-dlp stderr");

  const titleMatch = stdout.match(/\[download\] Destination: (.+)/);
  const mergeMatch = stdout.match(/\[Merger\] Merging formats into "(.+)"/);
  const alreadyMatch = stdout.match(/\[download\] (.+) has already been downloaded/);

  let filePath = "";
  if (mergeMatch) {
    filePath = mergeMatch[1].trim();
  } else if (titleMatch) {
    filePath = titleMatch[1].trim();
  } else if (alreadyMatch) {
    filePath = alreadyMatch[1].trim();
  } else {
    const files = fs.readdirSync(tmpDir)
      .map(f => ({ name: f, time: fs.statSync(path.join(tmpDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length === 0) throw new Error("Fayl topilmadi");
    filePath = path.join(tmpDir, files[0].name);
  }

  if (!fs.existsSync(filePath)) {
    const files = fs.readdirSync(tmpDir)
      .map(f => ({ name: f, time: fs.statSync(path.join(tmpDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length === 0) throw new Error("Fayl topilmadi");
    filePath = path.join(tmpDir, files[0].name);
  }

  const title = path.basename(filePath, path.extname(filePath));

  return {
    filePath,
    title,
    cleanup: () => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    },
  };
}

export async function downloadAudio(url: string): Promise<DownloadResult> {
  const tmpDir = getTempDir();
  const outputTemplate = path.join(tmpDir, "%(title)s.%(ext)s");

  logger.info({ url }, "Starting audio download");

  const ytdlpArgs = [
    `"${url}"`,
    `-o "${outputTemplate}"`,
    "--no-playlist",
    "--max-filesize 50m",
    "--format bestaudio",
    "--extract-audio",
    "--audio-format mp3",
    "--audio-quality 0",
    "--no-warnings",
    "--socket-timeout 30",
  ].join(" ");

  const { stdout, stderr } = await execAsync(`yt-dlp ${ytdlpArgs}`, {
    timeout: 120000,
  });

  logger.info({ stdout }, "yt-dlp audio output");
  if (stderr) logger.warn({ stderr }, "yt-dlp stderr");

  const destMatch = stdout.match(/\[ExtractAudio\] Destination: (.+\.mp3)/);
  const titleMatch = stdout.match(/\[download\] Destination: (.+)/);

  let filePath = "";
  if (destMatch) {
    filePath = destMatch[1].trim();
  } else if (titleMatch) {
    const base = titleMatch[1].trim().replace(/\.[^/.]+$/, "") + ".mp3";
    filePath = base;
  } else {
    const files = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith(".mp3"))
      .map(f => ({ name: f, time: fs.statSync(path.join(tmpDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length === 0) throw new Error("Audio fayl topilmadi");
    filePath = path.join(tmpDir, files[0].name);
  }

  if (!fs.existsSync(filePath)) {
    const files = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith(".mp3"))
      .map(f => ({ name: f, time: fs.statSync(path.join(tmpDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length === 0) throw new Error("Audio fayl topilmadi");
    filePath = path.join(tmpDir, files[0].name);
  }

  const title = path.basename(filePath, ".mp3");

  return {
    filePath,
    title,
    cleanup: () => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    },
  };
}

export async function searchAndDownloadMusic(query: string): Promise<DownloadResult> {
  const searchUrl = `ytsearch1:${query}`;
  logger.info({ query }, "Searching music on YouTube");
  return downloadAudio(searchUrl);
}
