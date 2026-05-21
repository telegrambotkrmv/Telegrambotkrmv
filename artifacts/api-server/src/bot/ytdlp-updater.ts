import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../lib/logger";

const execAsync = promisify(exec);

const YTDLP_PATH = process.env.YTDLP_PATH || "/home/runner/workspace/bin/yt-dlp";
const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function downloadLatest(): Promise<void> {
  const dir = path.dirname(YTDLP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = `${YTDLP_PATH}.new`;
  await execAsync(`curl -sSL -o "${tmp}" "${YTDLP_URL}"`, { timeout: 60000 });
  fs.chmodSync(tmp, 0o755);

  await execAsync(`"${tmp}" --version`, { timeout: 10000 });

  fs.renameSync(tmp, YTDLP_PATH);
}

export async function updateYtDlp(force = false): Promise<void> {
  try {
    const exists = fs.existsSync(YTDLP_PATH);

    if (!exists) {
      logger.info("yt-dlp not found, downloading latest");
      await downloadLatest();
      const { stdout } = await execAsync(`"${YTDLP_PATH}" --version`, { timeout: 10000 });
      logger.info({ version: stdout.trim() }, "yt-dlp installed");
      return;
    }

    if (!force) {
      const stat = fs.statSync(YTDLP_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < UPDATE_INTERVAL_MS) {
        logger.info({ ageHours: Math.round(ageMs / 3600000) }, "yt-dlp recent, skipping update");
        return;
      }
    }

    logger.info("Checking yt-dlp for updates");
    await downloadLatest();
    const { stdout } = await execAsync(`"${YTDLP_PATH}" --version`, { timeout: 10000 });
    logger.info({ version: stdout.trim() }, "yt-dlp updated");
  } catch (err) {
    logger.warn({ err }, "yt-dlp update failed, continuing with existing version");
  }
}

export function startYtDlpAutoUpdate(): void {
  void updateYtDlp(false);
  setInterval(() => {
    void updateYtDlp(true);
  }, UPDATE_INTERVAL_MS);
}
